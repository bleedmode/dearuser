// audit-detectors — run the 4 detectors on an audit graph and return findings.
//
// Each detector is conservative about severity. A noisy audit gets ignored,
// so we'd rather miss a finding than report a false one.

import { existsSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type {
  AuditArtifact,
  AuditEdge,
  AuditFinding,
  AuditGraph,
  GapSeverity,
} from '../types.js';

/**
 * Paths that are "terminal" — user-facing endpoints where it's fine for data
 * to land without a programmatic consumer. Writing to these doesn't count as
 * an orphan.
 */
const TERMINAL_PATH_PATTERNS: RegExp[] = [
  /CLAUDE\.md$/,
  /\.claude\/memory/,
  /\.dearuser\//,
  /\.pvs\/dashboard/,
  /stdout|stderr/i,
  /\.log$/, // logs are read by humans, not programs — usually fine
];

function isTerminalPath(path: string): boolean {
  return TERMINAL_PATH_PATTERNS.some(p => p.test(path));
}

/** Deterministic, readable id for a finding so we can feedback-track it. */
function findingId(type: string, parts: string[]): string {
  return `${type}:${parts.filter(Boolean).join(':').toLowerCase().replace(/[^\w:]+/g, '-')}`;
}

/**
 * Some scheduled tasks have legitimate consumers that aren't files in the user's
 * stack — they push to chat notifications, create PVS tasks via CLI, or write to
 * external DBs. The audit graph can't see these, but the task's own prompt usually
 * documents them. This function checks for those prose-level signals so we don't
 * false-positive jobs that actually have a downstream consumer.
 */
function detectImplicitConsumer(task: AuditArtifact): string | null {
  const text = `${task.description}\n${task.prompt}`;

  // Pattern 1 — sends a notification or report. Consumer = the user reading chat.
  const notifyPatterns: RegExp[] = [
    /\bnotif(ic|ier|y|ication)/i,
    /\bvarsel\b/i,
    /\bpåmind/i,
    /\bnotifyoncompletion\b/i,
    /\brapport(?:er|ér|ering)\b/i,
    /\bbesked til (jarl|brugeren|user)\b/i,
  ];
  if (notifyPatterns.some(p => p.test(text))) {
    return 'sends notification to the user';
  }

  // Pattern 2 — creates a PVS task. Consumer = the PVS triage pipeline.
  const pvsTaskPatterns: RegExp[] = [
    /pvs(\.sh)?\s+task\s+create/i,
    /\bopret(?:ter)?\s+(?:en\s+)?pvs[\s-]task/i,
    /\bauto-(?:monitor|sec|build|scan)\b/i, // task tags consumed by triage
  ];
  if (pvsTaskPatterns.some(p => p.test(text))) {
    return 'creates PVS task (consumed by triage pipeline)';
  }

  // Pattern 3 — writes to an external system (DB, API, runs log).
  const externalPatterns: RegExp[] = [
    /pvs(\.sh)?\s+runs\s+(start|finish)/i,
    /pvs(\.sh)?\s+research\s+(save|register)/i,
    /pvs(\.sh)?\s+source\s+add/i,
    /\binsert\s+into\b/i,
    /\bupdate\s+\w+\s+set\b/i,
    /supabase\.co\/rest/i,
  ];
  if (externalPatterns.some(p => p.test(text))) {
    return 'writes to external system (DB/API)';
  }

  // Pattern 4 — short one-off reminder (no recurring infrastructure needed).
  // Consumer is implicit: the user on the reminder date.
  if (task.prompt.length <= 500) {
    const reminderPatterns: RegExp[] = [
      /\bpåmind/i,
      /\bhusk\b/i,
      /\bremind/i,
      /\breminder\b/i,
    ];
    if (reminderPatterns.some(p => p.test(text))) {
      return 'one-off reminder (consumer = user on the reminder date)';
    }
  }

  return null;
}

// ============================================================================
// Detector 1 — orphan scheduled jobs
// ============================================================================

/**
 * A scheduled task whose *work product* has no downstream consumer.
 *
 * We look at two levels of orphaning:
 *
 *   Level A (file-level) — task writes to path X, no one reads X.
 *   Level B (artifact-level) — task is never referenced by any other artifact
 *     AND has no named consumer in prose. This catches scheduled jobs whose
 *     "output" is side-effects (DB writes via CLI, notifications) that we
 *     can't edge-extract, but which nobody else in the stack depends on.
 *
 * A scheduled task is an orphan if:
 *   - It has no produces-edge with a consumer, AND
 *   - No other artifact references it by name, AND
 *   - No skill/task mentions its name in prose.
 *
 * This is conservative. We'd rather miss a real orphan than flag a job that
 * has a documented consumer relationship in prose.
 */
function detectOrphanJobs(graph: AuditGraph): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const consumedPaths = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'consumes') consumedPaths.add(edge.to);
  }

  // Which artifacts are referenced by other artifacts?
  const referencedIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'references') referencedIds.add(edge.to);
  }

  // Produces-edges grouped by producer — so we can report per-task
  const producesByArtifact = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (edge.type !== 'produces') continue;
    const list = producesByArtifact.get(edge.from) || [];
    list.push(edge);
    producesByArtifact.set(edge.from, list);
  }

  const allPrompts = graph.nodes.map(n => n.prompt).join('\n');

  for (const task of graph.nodes) {
    if (task.type !== 'scheduled_task') continue;

    // Artifact-level consumer check — if anyone references it by name, it has a known consumer
    if (referencedIds.has(task.id)) continue;

    // Also check prose mentions of the task name (outside its own prompt)
    const ownPrompt = task.prompt;
    const otherPrompts = graph.nodes.filter(n => n.id !== task.id).map(n => n.prompt).join('\n');
    if (task.name.length >= 4) {
      const re = new RegExp(`\\b${task.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(otherPrompts)) continue;
    }

    // Implicit consumer check — task's own prompt documents its consumer relationship
    // (notifications, PVS tasks, external DB writes, one-off reminders).
    if (detectImplicitConsumer(task)) continue;

    // Check each produces-edge from this task
    const produces = producesByArtifact.get(task.id) || [];
    const orphanedPaths: string[] = [];
    for (const edge of produces) {
      if (isTerminalPath(edge.to)) continue;
      if (consumedPaths.has(edge.to)) continue;
      let matched = false;
      for (const cp of consumedPaths) {
        if (edge.to.includes(cp) || cp.includes(edge.to)) { matched = true; break; }
      }
      if (matched) continue;
      orphanedPaths.push(edge.to);
    }

    // If the task has no produces-edges AND no consumer-references, it's an "effect-orphan"
    // — its side-effects aren't documented anywhere. Still worth flagging.
    const isEffectOrphan = produces.length === 0;

    if (orphanedPaths.length === 0 && !isEffectOrphan) continue;

    const hasDataPath = orphanedPaths.some(p => /\.(json|jsonl|csv|tsv|sqlite|db)$/i.test(p)
      || /\/(data|findings|results|reports?)\b/i.test(p));
    const severity: GapSeverity = hasDataPath ? 'critical' : 'recommended';

    const title = orphanedPaths.length > 0
      ? `Scheduled task "${task.name}" produces output nothing reads`
      : `Scheduled task "${task.name}" has no documented consumer`;

    const description = orphanedPaths.length > 0
      ? `The task writes to ${orphanedPaths.map(p => `\`${p}\``).join(', ')} — no skill, task, or command reads those paths, and the task is never referenced by name elsewhere.`
      : `The task has no file-level outputs we can trace, and no other artifact in your stack references "${task.name}". If it fails tomorrow, nothing downstream will notice.`;

    const evidence: AuditFinding['evidence'] = orphanedPaths.length > 0
      ? orphanedPaths.map(p => ({ source: task.path, excerpt: `writes to ${p}`, kind: 'path' as const }))
      : [{ source: task.path, excerpt: `No references to "${task.name}" in other artifacts.`, kind: 'stat' as const }];

    findings.push({
      id: findingId('orphan_job', [task.name, orphanedPaths[0] || 'no-consumer']),
      type: 'orphan_job',
      severity,
      title,
      description,
      affectedArtifacts: [task.id],
      evidence,
      recommendation: `Either (a) add a downstream consumer (a skill reads the output, a briefing includes it), (b) document the intended consumer in the task prompt so it's traceable, or (c) add a failure-notification so you'd know if the task stops working.`,
      why: 'Scheduled jobs with no documented consumer fail silently. You find out weeks later that data stopped flowing — when a dashboard is empty or a downstream task breaks.',
    });
  }

  return findings;
}

// ============================================================================
// Detector 2 — overlap
// ============================================================================

/**
 * Two artifacts look like they do similar work. Evidence can be:
 *   (a) high description similarity (similar_to edge), or
 *   (b) they produce the same output path, or
 *   (c) both — critical overlap.
 */
function detectOverlap(graph: AuditGraph): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const seen = new Set<string>(); // dedupe A↔B and B↔A

  // Group produces-edges by target path
  const producersByPath = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== 'produces') continue;
    const list = producersByPath.get(edge.to) || [];
    list.push(edge.from);
    producersByPath.set(edge.to, list);
  }

  // (b) Same-output overlap
  for (const [path, producers] of producersByPath) {
    if (producers.length < 2) continue;
    const uniqueProducers = Array.from(new Set(producers));
    if (uniqueProducers.length < 2) continue;
    for (let i = 0; i < uniqueProducers.length; i++) {
      for (let j = i + 1; j < uniqueProducers.length; j++) {
        const a = graph.nodes.find(n => n.id === uniqueProducers[i]);
        const b = graph.nodes.find(n => n.id === uniqueProducers[j]);
        if (!a || !b) continue;
        const key = [a.id, b.id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        findings.push({
          id: findingId('overlap', [a.name, b.name]),
          type: 'overlap',
          severity: 'recommended',
          title: `"${a.name}" and "${b.name}" both write to ${path}`,
          description: `Two artifacts target the same output path. At best this is redundant work; at worst they overwrite each other.`,
          affectedArtifacts: [a.id, b.id],
          evidence: [
            { source: a.path, excerpt: `${a.name} writes to ${path}`, kind: 'path' },
            { source: b.path, excerpt: `${b.name} writes to ${path}`, kind: 'path' },
          ],
          recommendation: `Pick one producer. If both are needed for different reasons, use distinct output paths so you can tell them apart.`,
          why: 'Two producers on one path is a race condition waiting to happen. Whichever runs last wins, silently.',
        });
      }
    }
  }

  // (a) Description-similarity overlap
  for (const edge of graph.edges) {
    if (edge.type !== 'similar_to') continue;
    const a = graph.nodes.find(n => n.id === edge.from);
    const b = graph.nodes.find(n => n.id === edge.to);
    if (!a || !b) continue;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const simMatch = edge.evidence.match(/[\d.]+/);
    const sim = simMatch ? parseFloat(simMatch[0]) : 0;

    const severity: GapSeverity = sim >= 0.6 ? 'recommended' : 'nice_to_have';

    // Contextual recommendation based on artifact types and similarity level
    const isSkillTaskPair =
      (a.type === 'skill' && b.type === 'scheduled_task') ||
      (a.type === 'scheduled_task' && b.type === 'skill');

    let recommendation: string;
    let why: string;
    if (isSkillTaskPair && sim >= 0.85) {
      recommendation = `These are likely a manual trigger and an automatic schedule for the same job. Keep both, but update them together when you make changes — if one drifts, agents may produce different results depending on how they're invoked.`;
      why = 'A manual skill and its scheduled twin should stay in sync. When they drift, the same job gives different results depending on whether it was triggered manually or ran automatically.';
    } else if (sim < 0.6) {
      recommendation = `Low similarity — likely different tools that happen to share some vocabulary. Safe to ignore unless you've noticed the wrong one getting invoked.`;
      why = 'Marginal similarity rarely causes real problems. This is flagged so you can check, not because it needs action.';
    } else {
      recommendation = `Compare the two and decide: keep both (different enough), merge, or deprecate one. Near-duplicates are where drift lives.`;
      why = 'Similar artifacts fragment your instructions. Agents end up invoking one when you meant the other, and rules drift between them.';
    }

    findings.push({
      id: findingId('overlap', [a.name, b.name]),
      type: 'overlap',
      severity,
      title: `"${a.name}" and "${b.name}" appear to do similar work`,
      description: `Description/prompt similarity is ${sim.toFixed(2)} (Jaccard). They may be duplicates, or one could be folded into the other.`,
      affectedArtifacts: [a.id, b.id],
      evidence: [
        { source: a.path, excerpt: a.description, kind: 'quote' },
        { source: b.path, excerpt: b.description, kind: 'quote' },
      ],
      recommendation,
      why,
    });
  }

  return findings;
}

// ============================================================================
// Detector 3 — missing closure (generalised orphan, for non-scheduled producers)
// ============================================================================

/**
 * Any producer (not just scheduled task) whose output lands on a non-terminal
 * path with no consumer. Helpful for hooks/skills that write data we lose track of.
 */
function detectMissingClosure(graph: AuditGraph): AuditFinding[] {
  const findings: AuditFinding[] = [];

  const consumedPaths = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'consumes') consumedPaths.add(edge.to);
  }
  const allPrompts = graph.nodes.map(n => n.prompt).join('\n');

  for (const edge of graph.edges) {
    if (edge.type !== 'produces') continue;
    const producer = graph.nodes.find(n => n.id === edge.from);
    if (!producer) continue;
    // Skip scheduled tasks — they get their own orphan_job finding
    if (producer.type === 'scheduled_task') continue;
    if (isTerminalPath(edge.to)) continue;

    const targetPath = edge.to;
    if (consumedPaths.has(targetPath)) continue;

    let hasConsumer = false;
    for (const cp of consumedPaths) {
      if (targetPath.includes(cp) || cp.includes(targetPath)) {
        hasConsumer = true;
        break;
      }
    }
    if (hasConsumer) continue;

    const tokens = targetPath.split(/[\/.\s]+/).filter(t => t.length >= 4);
    const key = tokens[tokens.length - 1] || targetPath;
    const mentions = allPrompts.split(key).length - 1;
    if (mentions >= 2) continue;

    findings.push({
      id: findingId('missing_closure', [producer.name, targetPath]),
      type: 'missing_closure',
      severity: 'nice_to_have',
      title: `"${producer.name}" writes to ${targetPath} — no reader found`,
      description: `The artifact produces output at a non-terminal path, but no other artifact reads it. If that was the intent, ignore. If not, you have a dangling data flow.`,
      affectedArtifacts: [producer.id],
      evidence: [
        { source: producer.path, excerpt: edge.evidence, kind: 'path' },
      ],
      recommendation: `Verify the output is still needed. If yes, document the consumer (could be a human reading the file). If no, remove the write.`,
      why: 'Dangling outputs accumulate. Six months later you have a folder of files and no idea which are still load-bearing.',
    });
  }

  return findings;
}

// ============================================================================
// Detector 4 — substrate mismatch
// ============================================================================

/**
 * Memory files that look like databases — many structured entries, possibly
 * updated frequently. Markdown is a poor fit for queryable data.
 */
function detectSubstrateMismatch(artifacts: AuditArtifact[]): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const artifact of artifacts) {
    if (artifact.type !== 'memory_file') continue;
    const { entryCount, structuredEntries, size, lastModified } = artifact.metadata;
    if (!structuredEntries) continue;
    if (!entryCount || entryCount < 5) continue;

    // Recent modification + reasonable size = actively written-to "database"
    const recentlyModified = lastModified
      ? (Date.now() - lastModified.getTime()) < 30 * 24 * 60 * 60 * 1000 // 30 days
      : false;

    const largeFile = size > 3000;

    if (!recentlyModified && !largeFile && entryCount < 10) continue;

    const severity: GapSeverity = entryCount >= 20
      ? 'recommended'
      : 'nice_to_have';

    findings.push({
      id: findingId('substrate_mismatch', [artifact.name]),
      type: 'substrate_mismatch',
      severity,
      title: `"${artifact.name}" looks like a database in disguise`,
      description: `This memory file has ${entryCount} structured entries and is actively maintained. Markdown is fine for narrative memories but poor for queryable data — you can't filter, sort, or count without parsing.`,
      affectedArtifacts: [artifact.id],
      evidence: [
        { source: artifact.path, excerpt: `${entryCount} structured entries, ${size} bytes`, kind: 'stat' },
      ],
      recommendation: `Migrate to SQLite or JSONL. Keep a summary in the memory file (+ link) so agents still surface the context. Query-able substrate = better tooling, dedup, and analysis.`,
      why: 'A markdown file with 20 entries is a poor database. You can\'t query it, agents can\'t efficiently reason over it, and it grows until it\'s too noisy to load into context.',
    });
  }

  return findings;
}

// ============================================================================
// Detector 5 — unregistered MCP tool references
// ============================================================================

/**
 * Skills, tasks, commands, and hooks that call `mcp__<server>__<tool>` tools
 * belonging to MCP servers that aren't registered in ~/.claude/mcp.json or
 * ~/.claude/settings.json.
 *
 * This catches the classic silent failure: you build a local MCP server,
 * update skills to use it, but forget to register it — skills then call
 * non-existent tools and fail silently at every invocation.
 *
 * Built-in server prefixes (claude_code, ccd_*, anthropic-*) are ignored
 * because they're provided by the harness, not user configuration.
 */
const BUILTIN_MCP_PREFIXES = [
  'claude_code',
  'claude_in_chrome',
  'claude_preview',
  'ccd_',
  'computer-use',
  'computer_use',
  'anthropic-',
  'anthropic_',
  'scheduled-tasks',
  'scheduled_tasks',
  'mcp-registry',
  'mcp_registry',
];

function isBuiltinMcpServer(serverName: string): boolean {
  const lower = serverName.toLowerCase();
  return BUILTIN_MCP_PREFIXES.some(p => lower === p || lower.startsWith(p));
}

function detectUnregisteredMcpTools(graph: AuditGraph): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Registered MCP servers (lowercased names)
  const registered = new Set<string>();
  for (const node of graph.nodes) {
    if (node.type === 'mcp_server') registered.add(node.name.toLowerCase());
  }

  // Group unregistered references by (caller, server) so one skill calling 5 tools
  // from the same missing server becomes one finding.
  type Ref = { caller: AuditArtifact; server: string; tools: Set<string>; excerpts: string[] };
  const refs = new Map<string, Ref>();

  const pattern = /mcp__([\w-]+)__([\w-]+)/g;

  for (const node of graph.nodes) {
    // Only user-authored artifacts reference tools — mcp_server and memory_file don't.
    if (node.type === 'mcp_server' || node.type === 'memory_file') continue;

    for (const m of node.prompt.matchAll(pattern)) {
      const server = m[1];
      const tool = m[2];
      const serverLower = server.toLowerCase();

      if (isBuiltinMcpServer(serverLower)) continue;
      if (registered.has(serverLower)) continue;

      const key = `${node.id}|${serverLower}`;
      let ref = refs.get(key);
      if (!ref) {
        ref = { caller: node, server, tools: new Set(), excerpts: [] };
        refs.set(key, ref);
      }
      ref.tools.add(tool);
      if (ref.excerpts.length < 3) ref.excerpts.push(m[0]);
    }
  }

  for (const { caller, server, tools, excerpts } of refs.values()) {
    const toolList = Array.from(tools).slice(0, 5);
    const toolStr = toolList.map(t => `\`mcp__${server}__${t}\``).join(', ');
    const more = tools.size > toolList.length ? ` (+${tools.size - toolList.length} more)` : '';

    findings.push({
      id: findingId('unregistered_mcp_tool', [caller.name, server]),
      type: 'unregistered_mcp_tool',
      severity: 'critical',
      title: `"${caller.name}" calls tools from unregistered MCP server "${server}"`,
      description: `The ${caller.type.replace('_', ' ')} references ${toolStr}${more} — but no MCP server named "${server}" is registered in \`~/.claude/mcp.json\` or \`~/.claude/settings.json\`. Every invocation fails silently.`,
      affectedArtifacts: [caller.id],
      evidence: excerpts.map(e => ({
        source: caller.path,
        excerpt: e,
        kind: 'quote' as const,
      })),
      recommendation: `Either (a) register the MCP server in \`~/.claude/mcp.json\` if it exists on disk, (b) remove the tool references if the server was abandoned, or (c) rename to the correct server if you renamed it.`,
      why: 'Unregistered MCP tool calls fail silently on every invocation. Skills appear to run but produce no effect — the exact class of failure that cost you 24 hours when pvs-mcp was built but never registered.',
    });
  }

  return findings;
}

// ============================================================================
// Detector 6 — unbacked-up substrate (~/.claude/ not in version control)
// ============================================================================

/**
 * If the user's AI stack (~/.claude/skills, scheduled-tasks, memory, commands)
 * is actively maintained but not tracked in any git repo or backup, flag it.
 * Single-point-of-failure: mac dies, entire agent brain is gone.
 *
 * We detect this by checking whether the artifact's path is inside a git-tracked
 * directory. We walk up from the artifact path looking for a `.git/` directory.
 * If we reach $HOME without finding one, it's unbacked.
 *
 * Severity:
 *   - critical if >= 10 recent artifacts (within 30 days) are unbacked
 *   - recommended if >= 3
 *   - otherwise skipped
 */
function detectUnbackedUpSubstrate(artifacts: AuditArtifact[]): AuditFinding[] {
  // Cache git-repo lookups per directory so we don't stat the same ancestors 50 times.
  const home = homedir();
  const repoCache = new Map<string, boolean>();

  function isInsideGitRepo(filePath: string): boolean {
    // Resolve symlinks first — ~/.claude/skills is often a symlink into a
    // separate git-tracked directory (e.g. pvs/agents/skills).
    let resolved: string;
    try {
      resolved = realpathSync(filePath);
    } catch {
      resolved = filePath;
    }
    let dir = dirname(resolved);
    const checked: string[] = [];
    while (dir && dir !== '/' && dir !== home) {
      const cached = repoCache.get(dir);
      if (cached !== undefined) {
        for (const d of checked) repoCache.set(d, cached);
        return cached;
      }
      checked.push(dir);
      if (existsSync(join(dir, '.git'))) {
        for (const d of checked) repoCache.set(d, true);
        return true;
      }
      dir = dirname(dir);
    }
    for (const d of checked) repoCache.set(d, false);
    return false;
  }

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  interface Unbacked {
    artifact: AuditArtifact;
    ageMs: number;
  }
  const unbacked: Unbacked[] = [];

  for (const a of artifacts) {
    // Only flag user-authored artifacts inside ~/.claude/, not memory_file noise from project dirs
    if (a.type === 'mcp_server') continue;
    if (!a.path.startsWith(join(home, '.claude'))) continue;

    const lastMod = a.metadata.lastModified?.getTime() ?? 0;
    const ageMs = now - lastMod;
    // Only count artifacts touched in the last 30 days — stale ones are low-value to back up
    if (ageMs > thirtyDaysMs) continue;

    if (isInsideGitRepo(a.path)) continue;
    unbacked.push({ artifact: a, ageMs });
  }

  if (unbacked.length < 3) return [];

  const severity: GapSeverity = unbacked.length >= 10 ? 'critical' : 'recommended';

  // Group by type for a compact summary
  const byType = new Map<string, number>();
  for (const u of unbacked) {
    byType.set(u.artifact.type, (byType.get(u.artifact.type) || 0) + 1);
  }
  const typeSummary = Array.from(byType.entries())
    .map(([t, n]) => `${n} ${t.replace('_', ' ')}${n === 1 ? '' : 's'}`)
    .join(', ');

  // Sample the 3 most recently modified unbacked artifacts as evidence
  const evidenceSample = unbacked
    .slice()
    .sort((a, b) => a.ageMs - b.ageMs)
    .slice(0, 3);

  return [{
    id: findingId('unbacked_up_substrate', ['home-claude']),
    type: 'unbacked_up_substrate',
    severity,
    title: `${unbacked.length} recently-modified artifacts in ~/.claude/ are not version-controlled`,
    description: `Your AI stack is actively maintained (${typeSummary} touched in the last 30 days) but \`~/.claude/\` is not inside a git repository. If this machine dies, the entire agent brain is gone.`,
    affectedArtifacts: unbacked.map(u => u.artifact.id),
    evidence: evidenceSample.map(u => ({
      source: u.artifact.path,
      excerpt: `modified ${Math.round(u.ageMs / (24 * 60 * 60 * 1000))} days ago, not in git`,
      kind: 'stat' as const,
    })),
    recommendation: `Turn \`~/.claude/\` (or at minimum \`~/.claude/skills/\`, \`~/.claude/scheduled-tasks/\`, and \`~/.claude/projects/*/memory/\`) into a git repository and push to a private remote. A nightly \`git add -A && git commit -m "snapshot"\` cron is a cheap start.`,
    why: 'High-churn config directories without backup are a classic single point of failure. When it goes, it goes with months of accumulated skills, memory, and scheduled tasks — none of which are reproducible from scratch.',
  }];
}

// ============================================================================
// Detector 7 — stale schedule (scheduled task hasn't run in expected window)
// ============================================================================

/**
 * Estimate the maximum expected gap between runs for a 5-field cron expression.
 * Returns null if the expression is unrecognised — caller should skip flagging.
 *
 * This is intentionally coarse: we just want an upper bound so we can say
 * "this task was supposed to run within N hours and hasn't".
 */
function expectedIntervalMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, domField, _monthField, dowField] = parts;
  const isAny = (f: string) => f === '*' || f === '?';
  const hasList = (f: string) => /[,/-]/.test(f);

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  // Specific day-of-week (e.g. `1` for Monday) → weekly
  if (!isAny(dowField) && !hasList(dowField)) return 7 * DAY_MS;
  // Specific day-of-month → monthly (approx 31 days upper bound)
  if (!isAny(domField) && !hasList(domField)) return 31 * DAY_MS;
  // Specific hour → daily
  if (!isAny(hourField) && !hasList(hourField)) return DAY_MS;
  // `*/N` on hour → N hours
  const stepHour = hourField.match(/^\*\/(\d+)$/);
  if (stepHour) return Number(stepHour[1]) * HOUR_MS;
  // Hour-of-day list (e.g. `0,12`) → roughly spacing-based, assume daily upper bound
  if (hourField.includes(',') || hourField.includes('-')) return DAY_MS;
  // `*` on hour → hourly or sub-hourly
  if (isAny(hourField)) {
    if (!isAny(minuteField) && !hasList(minuteField)) return HOUR_MS; // once per hour
    const stepMinute = minuteField.match(/^\*\/(\d+)$/);
    if (stepMinute) return Number(stepMinute[1]) * 60 * 1000;
    return HOUR_MS; // default floor: one hour
  }
  return null;
}

/**
 * A scheduled task whose `lastRunAt` is older than ~2× its expected interval.
 *
 * This catches the silent-failure class where a cron job is still registered
 * and "enabled" but has stopped firing — the exact class of bug that caused
 * the security-check-has-not-run-for-5-days situation.
 *
 * We skip tasks without state (can't confirm anything), manual-only tasks
 * (no cron to compare against), and disabled tasks (intentional pause).
 */
function detectStaleSchedule(graph: AuditGraph): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const now = Date.now();

  for (const task of graph.nodes) {
    if (task.type !== 'scheduled_task') continue;
    const { lastRunAt, cronExpression, scheduledEnabled, scheduledCreatedAt } = task.metadata;
    if (scheduledEnabled === false) continue;     // user paused it on purpose
    if (!cronExpression) continue;                // manual-only, no schedule to miss
    const interval = expectedIntervalMs(cronExpression);
    if (!interval) continue;                      // unrecognised cron — don't guess

    const graceMs = interval * 2;
    const ageMs = lastRunAt ? now - lastRunAt.getTime() : Infinity;
    if (ageMs <= graceMs) continue;

    // Newly-created task that hasn't reached its first scheduled fire-time yet.
    // `lastRunAt=never` is expected here and not a silent-failure signal.
    if (!lastRunAt && scheduledCreatedAt && now - scheduledCreatedAt.getTime() < graceMs) {
      continue;
    }

    // Pretty-format the gap so users don't have to do the math
    const humanAge = lastRunAt
      ? (ageMs >= 2 * 24 * 60 * 60 * 1000
          ? `${Math.floor(ageMs / (24 * 60 * 60 * 1000))} days ago`
          : `${Math.floor(ageMs / (60 * 60 * 1000))} hours ago`)
      : 'never';
    const humanInterval = interval >= 24 * 60 * 60 * 1000
      ? `${Math.round(interval / (24 * 60 * 60 * 1000))}d`
      : `${Math.round(interval / (60 * 60 * 1000))}h`;

    // Severity scales with how overdue it is.
    // - Never run at all → critical regardless of interval
    // - More than 5× interval overdue → critical
    // - Otherwise recommended
    const severity: GapSeverity =
      !lastRunAt || ageMs > 5 * interval ? 'critical' : 'recommended';

    findings.push({
      id: findingId('stale_schedule', [task.name]),
      type: 'stale_schedule',
      severity,
      title: `Scheduled task "${task.name}" hasn't run when it should have`,
      description: lastRunAt
        ? `Last successful run was ${humanAge}, but this task is scheduled to run every ${humanInterval} (cron: \`${cronExpression}\`). It's still marked enabled, so something is failing silently — the scheduler didn't fire, the run crashed before logging, or the session it's pinned to is gone.`
        : `This task is enabled with cron \`${cronExpression}\` but has never successfully run. Either it was just created, or every run so far has failed before it could record completion.`,
      affectedArtifacts: [task.id],
      evidence: [
        {
          source: task.path,
          excerpt: lastRunAt
            ? `lastRunAt=${lastRunAt.toISOString()}, expected every ${humanInterval}`
            : `lastRunAt=never, expected every ${humanInterval}`,
          kind: 'stat',
        },
      ],
      recommendation: `Open this task and check: (a) is the session it's pinned to still alive? (b) does the task's own prompt still work when run manually? (c) if the schedule is no longer needed, disable it explicitly rather than leaving it in a broken state. Don't close a "task X hasn't run" finding without verifying X actually runs now.`,
      why: 'A scheduled task that stops firing silently is the worst kind of failure — it looks like everything is fine until you notice that whatever the task was supposed to do simply stopped happening. Security checks, backups, and monitoring jobs all fail this way.',
    });
  }

  return findings;
}

// ============================================================================
// Orchestration
// ============================================================================

export interface DetectorOptions {
  focus?: 'orphan' | 'overlap' | 'closure' | 'substrate' | 'mcp_refs' | 'backup' | 'stale_schedule' | 'all';
}

export function runDetectors(
  graph: AuditGraph,
  options: DetectorOptions = {},
): AuditFinding[] {
  const focus = options.focus || 'all';
  const findings: AuditFinding[] = [];

  if (focus === 'all' || focus === 'orphan') {
    findings.push(...detectOrphanJobs(graph));
  }
  if (focus === 'all' || focus === 'overlap') {
    findings.push(...detectOverlap(graph));
  }
  if (focus === 'all' || focus === 'closure') {
    findings.push(...detectMissingClosure(graph));
  }
  if (focus === 'all' || focus === 'substrate') {
    findings.push(...detectSubstrateMismatch(graph.nodes));
  }
  if (focus === 'all' || focus === 'mcp_refs') {
    findings.push(...detectUnregisteredMcpTools(graph));
  }
  if (focus === 'all' || focus === 'backup') {
    findings.push(...detectUnbackedUpSubstrate(graph.nodes));
  }
  if (focus === 'all' || focus === 'stale_schedule') {
    findings.push(...detectStaleSchedule(graph));
  }

  // Dedupe by id — one physical issue shouldn't surface twice
  const seen = new Set<string>();
  const unique: AuditFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  // Sort: critical → recommended → nice_to_have, then by type
  const severityOrder: Record<GapSeverity, number> = {
    critical: 0,
    recommended: 1,
    nice_to_have: 2,
  };
  unique.sort((a, b) => {
    const s = severityOrder[a.severity] - severityOrder[b.severity];
    if (s !== 0) return s;
    return a.type.localeCompare(b.type);
  });

  return unique;
}
