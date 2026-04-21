// audit tool — system coherence analysis (vs analyze which looks at language).
//
// Pipeline:
//   1. scanArtifacts() — discover skills, scheduled tasks, commands, hooks,
//      MCP servers, memory files
//   2. buildGraph() — extract produces/consumes/references/similar_to edges
//   3. runDetectors() — apply 4 detectors (orphan, overlap, closure, substrate)
//   4. reconcileFindings() — persist to ~/.dearuser/audit-findings.json and
//      compute the feedback summary (pending/fixed/dismissed since last run)

import { scanArtifacts } from '../engine/audit-scanner.js';
import { buildGraph } from '../engine/audit-graph.js';
import { runDetectors, type DetectorOptions } from '../engine/audit-detectors.js';
import { reconcileFindings } from '../engine/audit-feedback.js';
import { insertAgentRun } from '../engine/db.js';
import { scoreSystemHealth } from '../engine/system-health-scorer.js';
import type {
  AuditArtifact,
  AuditArtifactType,
  AuditFinding,
  AuditFindingType,
  AuditReport,
  Scope,
  ScoreCeiling,
} from '../types.js';

export interface AuditOptions extends DetectorOptions {
  scope?: Scope;
  projectRoot?: string;
}

function emptyTypeCounts(): Record<AuditArtifactType, number> {
  return {
    skill: 0,
    command: 0,
    scheduled_task: 0,
    hook: 0,
    mcp_server: 0,
    memory_file: 0,
  };
}

function emptyFindingCounts(): Record<AuditFindingType, number> {
  return {
    orphan_job: 0,
    overlap: 0,
    missing_closure: 0,
    substrate_mismatch: 0,
    unregistered_mcp_tool: 0,
    unbacked_up_substrate: 0,
    stale_schedule: 0,
  };
}

function countByType(artifacts: AuditArtifact[]): Record<AuditArtifactType, number> {
  const counts = emptyTypeCounts();
  for (const a of artifacts) counts[a.type] += 1;
  return counts;
}

function countFindingsByType(findings: AuditFinding[]): Record<AuditFindingType, number> {
  const counts = emptyFindingCounts();
  for (const f of findings) counts[f.type] += 1;
  return counts;
}

/** Share of produces-edges that have a matching consumes-edge (any path overlap). */
function computeClosureRate(edges: ReturnType<typeof buildGraph>['edges']): number | null {
  const produces = edges.filter(e => e.type === 'produces');
  if (produces.length === 0) return null;

  const consumedPaths = new Set(edges.filter(e => e.type === 'consumes').map(e => e.to));
  let closed = 0;
  for (const p of produces) {
    if (consumedPaths.has(p.to)) { closed++; continue; }
    // Substring match for path drift
    let matched = false;
    for (const cp of consumedPaths) {
      if (p.to.includes(cp) || cp.includes(p.to)) { matched = true; break; }
    }
    if (matched) closed++;
  }
  return produces.length === 0 ? null : Math.round((closed / produces.length) * 100) / 100;
}

export function runAudit(options: AuditOptions = {}): AuditReport {
  // 1. Scan
  const artifacts = scanArtifacts();

  // 2. Graph
  const graph = buildGraph(artifacts);

  // 3. Detect
  //    Always run ALL detectors regardless of `focus`. The persisted report
  //    and dashboard render the complete picture; `focus` only narrows what
  //    the agent's text output highlights (applied later in formatAuditReport).
  //    If focus filtered the stored findings, the dashboard would render the
  //    letter with "no findings" while the score still reflected the full set
  //    — an impossible contradiction for a user refreshing the browser.
  const findings = runDetectors(graph, { ...options, focus: 'all' });

  // 4. Feedback
  const feedback = reconcileFindings(findings);

  // 5. Score — turn findings into a 0-100 number with category breakdown.
  //    Same shape as collaboration and security scores so the dashboard can
  //    render all three under one visual language.
  const { categories, systemHealthScore } = scoreSystemHealth(findings);

  // 6. Ceiling — fixing every finding takes each category to 100.
  const byCategory: ScoreCeiling['byCategory'] = {};
  let ceilingWeightedSum = 0;
  for (const [id, cat] of Object.entries(categories)) {
    const ceiling = 100;
    byCategory[id] = { current: cat.score, ceiling, delta: ceiling - cat.score };
    ceilingWeightedSum += ceiling * cat.weight;
  }
  const ceilingScore = Math.round(ceilingWeightedSum);
  const scoreCeiling: ScoreCeiling = {
    currentScore: systemHealthScore,
    ceilingScore,
    delta: ceilingScore - systemHealthScore,
    byCategory,
    unreachable: [],
    summary: ceilingScore === systemHealthScore
      ? `Already at 100 — system-sundhed is clean.`
      : `Fixing every finding in this report lifts your system-sundhed score from ${systemHealthScore} to ${ceilingScore}.`,
  };

  // Persist agent run to SQLite
  let agentRunId: string | undefined;
  try {
    agentRunId = insertAgentRun({
      toolName: 'health',
      summary: `System-sundhed: ${systemHealthScore}/100 — ${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical)`,
      score: systemHealthScore,
      status: 'success',
    });
  } catch {
    // DB write failure should never break the audit
  }

  return {
    _agentRunId: agentRunId,
    version: '1.0',
    generatedAt: new Date().toISOString(),
    scope: options.scope || 'global',
    scanRoots: [/* global by default; project scope not yet differentiated */],
    graph: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      byType: countByType(graph.nodes),
      closureRate: computeClosureRate(graph.edges),
    },
    findings,
    systemHealthScore,
    categories,
    scoreCeiling,
    summary: {
      critical: findings.filter(f => f.severity === 'critical').length,
      recommended: findings.filter(f => f.severity === 'recommended').length,
      niceToHave: findings.filter(f => f.severity === 'nice_to_have').length,
      byType: countFindingsByType(findings),
    },
    feedback,
  };
}

// ============================================================================
// Overlap clustering — group related overlap findings into clusters
// ============================================================================

interface OverlapCluster {
  findings: AuditFinding[];
  artifactIds: Set<string>;
}

/**
 * Group overlap findings into connected components via shared artifact IDs.
 * E.g., if finding A covers {x,y} and finding B covers {y,z}, they belong
 * to the same cluster because they share artifact y.
 */
function clusterOverlapFindings(findings: AuditFinding[]): OverlapCluster[] {
  const overlapFindings = findings.filter(f => f.type === 'overlap');
  if (overlapFindings.length === 0) return [];

  // Union-Find
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    let root = parent.get(x)!;
    while (root !== parent.get(root)!) root = parent.get(root)!;
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = parent.get(curr)!;
      parent.set(curr, root);
      curr = next;
    }
    return root;
  }
  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Connect all artifact IDs within each finding
  for (const f of overlapFindings) {
    const ids = f.affectedArtifacts;
    for (let i = 1; i < ids.length; i++) {
      union(ids[0], ids[i]);
    }
    // Also connect across findings that share an artifact
  }
  // Connect findings that share artifacts
  const artifactToFinding = new Map<string, AuditFinding[]>();
  for (const f of overlapFindings) {
    for (const id of f.affectedArtifacts) {
      const list = artifactToFinding.get(id) || [];
      list.push(f);
      artifactToFinding.set(id, list);
    }
  }
  for (const [, fList] of artifactToFinding) {
    if (fList.length < 2) continue;
    const allIds = fList.flatMap(f => f.affectedArtifacts);
    for (let i = 1; i < allIds.length; i++) {
      union(allIds[0], allIds[i]);
    }
  }

  // Group findings by cluster root
  const clusters = new Map<string, OverlapCluster>();
  for (const f of overlapFindings) {
    const root = find(f.affectedArtifacts[0]);
    let cluster = clusters.get(root);
    if (!cluster) {
      cluster = { findings: [], artifactIds: new Set() };
      clusters.set(root, cluster);
    }
    cluster.findings.push(f);
    for (const id of f.affectedArtifacts) cluster.artifactIds.add(id);
  }

  return Array.from(clusters.values());
}

/**
 * Detect a shared name prefix among artifact IDs in a cluster.
 * E.g., ["skill:dearuser-collab", "skill:dearuser-health", ...] → "dearuser"
 */
function detectClusterPrefix(artifactIds: Set<string>): string | null {
  // Extract the name part after the type prefix (e.g., "skill:foo" → "foo")
  const names = Array.from(artifactIds).map(id => {
    const colonIdx = id.indexOf(':');
    return colonIdx >= 0 ? id.slice(colonIdx + 1) : id;
  });

  if (names.length < 3) return null;

  // Try common separators: hyphen, colon, underscore (e.g., "dearuser-collab" → "dearuser")
  for (const sep of ['-', ':', '_']) {
    const prefixes = names
      .map(n => n.split(sep)[0])
      .filter(p => p.length >= 3);
    const prefixCounts = new Map<string, number>();
    for (const p of prefixes) {
      prefixCounts.set(p, (prefixCounts.get(p) || 0) + 1);
    }
    for (const [prefix, count] of prefixCounts) {
      if (count >= 3 && count >= names.length * 0.6) return prefix;
    }
  }

  return null;
}

// ============================================================================
// Assessment generator — "What to do" section
// ============================================================================

function generateAssessment(
  report: AuditReport,
  clusters: OverlapCluster[],
): string[] {
  const lines: string[] = [];

  // Compute actionable findings: critical + recommended NOT in large clusters (3+ findings)
  const largeClusters = clusters.filter(c => c.findings.length >= 3);
  const largeClustedFindingIds = new Set(largeClusters.flatMap(c => c.findings.map(f => f.id)));

  const actionable = report.findings.filter(
    f => (f.severity === 'critical' || f.severity === 'recommended')
      && !largeClustedFindingIds.has(f.id),
  );

  lines.push(`## What to do`, ``);

  if (actionable.length === 0) {
    // Binary: nothing to do
    lines.push(`✅ **Du behøver ikke gøre noget.**`);
    lines.push(``);
    const benignCount = largeClusters.reduce((sum, c) => sum + c.findings.length, 0)
      + report.findings.filter(f => f.severity === 'nice_to_have' && !largeClustedFindingIds.has(f.id)).length;
    if (benignCount > 0) {
      lines.push(
        `Dit setup er sundt. De ${benignCount} findings er enten forventet overlap mellem relaterede tools eller lav-prioritet polering — ingen handling nødvendig.`,
      );
    } else {
      lines.push(`Dit setup er rent.`);
    }
  } else {
    // Binary: user needs to act
    const n = actionable.length;
    lines.push(`⚠️ **Du skal gøre ${n} ${n === 1 ? 'ting' : 'ting'}:**`);
    lines.push(``);

    // Numbered list with file paths when available
    actionable.slice(0, 5).forEach((f, i) => {
      lines.push(`${i + 1}. **${f.title}**`);
      lines.push(`   ${f.recommendation}`);
      // Extract file paths from evidence (source or excerpt containing absolute paths)
      const paths = (f.evidence || [])
        .map(e => {
          const text = `${e.source} ${e.excerpt}`;
          const match = text.match(/(\/[^\s`]+\.(md|json|ts|js|yaml|yml|sh))/);
          return match ? match[1] : null;
        })
        .filter((p): p is string => p !== null);
      if (paths.length > 0) {
        lines.push(`   → ${paths.join(' + ')}`);
      }
    });

    if (actionable.length > 5) {
      lines.push(``, `...og ${actionable.length - 5} mere (se details ovenfor).`);
    }
  }

  return lines;
}

// ============================================================================
// Report formatter
// ============================================================================

/**
 * Map a `focus` option to the set of finding types it should surface in text
 * output. runAudit always returns all findings for persistence; this filter
 * only narrows what the agent sees in the chat response.
 */
const FOCUS_TO_TYPES: Record<string, AuditFindingType[]> = {
  orphan: ['orphan_job'],
  overlap: ['overlap'],
  closure: ['missing_closure'],
  substrate: ['substrate_mismatch'],
  mcp_refs: ['unregistered_mcp_tool'],
  backup: ['unbacked_up_substrate'],
  stale_schedule: ['stale_schedule'],
};

/** Format an AuditReport as the markdown string we return to the MCP client. */
export function formatAuditReport(report: AuditReport, focus?: string): string {
  const focusTypes = focus && focus !== 'all' ? FOCUS_TO_TYPES[focus] : undefined;
  const textFindings = focusTypes
    ? report.findings.filter(f => focusTypes.includes(f.type))
    : report.findings;
  const clusters = clusterOverlapFindings(textFindings);
  const largeClusters = clusters.filter(c => c.findings.length >= 3);
  const largeClustedFindingIds = new Set(
    largeClusters.flatMap(c => c.findings.map(f => f.id)),
  );

  const c = report.scoreCeiling;
  const ceilingLine = c.delta > 0
    ? `**Reachable ceiling: ${c.ceilingScore}/100** (+${c.delta} if you fix every finding below).`
    : `**Reachable ceiling: ${c.ceilingScore}/100** — already there.`;

  const lines: string[] = [
    `# Dear User — System-sundhed`,
    ``,
    `*Scanned: ${report.graph.nodeCount} artifacts, ${report.graph.edgeCount} edges` +
      (report.graph.closureRate !== null
        ? ` · Closure rate: ${Math.round(report.graph.closureRate * 100)}% of produced outputs have a consumer*`
        : `*`),
    ``,
    `## System-sundhed Score: ${report.systemHealthScore}/100`,
    ``,
    ceilingLine,
    ``,
    `### Category Scores`,
  ];

  const catConfig: Array<[keyof typeof report.categories, string]> = [
    ['jobIntegrity', 'Job Integrity'],
    ['artifactOverlap', 'Artifact Overlap'],
    ['dataClosure', 'Data Closure'],
    ['configHealth', 'Config Health'],
    ['substrateHealth', 'Substrate Health'],
  ];
  for (const [key, name] of catConfig) {
    const cat = report.categories[key];
    const bar = '█'.repeat(Math.round(cat.score / 10)) + '░'.repeat(10 - Math.round(cat.score / 10));
    const status = cat.score >= 85 ? 'Strong'
      : cat.score >= 70 ? 'Good'
      : cat.score >= 50 ? 'Needs work'
      : 'Weak — action needed';
    lines.push(`- **${name}**: ${bar} ${cat.score}/100 — *${status}*`);
    for (const sig of cat.signalsPresent.slice(0, 1)) lines.push(`  - ✓ ${sig}`);
    for (const sig of cat.signalsMissing.slice(0, 2)) lines.push(`  - → ${sig}`);
  }

  const textCritical = textFindings.filter(f => f.severity === 'critical').length;
  const textRecommended = textFindings.filter(f => f.severity === 'recommended').length;
  const textNiceToHave = textFindings.filter(f => f.severity === 'nice_to_have').length;

  lines.push(
    ``,
    focusTypes ? `## Findings (focus: ${focus})` : `## Findings`,
    `- 🔴 **${textCritical}** critical`,
    `- 🟡 **${textRecommended}** recommended`,
    `- 🟢 **${textNiceToHave}** nice-to-have`,
  );

  if (focusTypes) {
    const hiddenTotal = report.findings.length - textFindings.length;
    if (hiddenTotal > 0) {
      lines.push(`- _(${hiddenTotal} more in other categories — omit \`focus\` to see all)_`);
    }
  }

  const byType = report.summary.byType;
  const typeLabels: Array<[AuditFindingType, string]> = [
    ['orphan_job', 'Orphan scheduled jobs'],
    ['overlap', 'Overlap'],
    ['missing_closure', 'Missing closure'],
    ['substrate_mismatch', 'Substrate mismatch'],
    ['unregistered_mcp_tool', 'Unregistered MCP tools'],
    ['unbacked_up_substrate', 'Unbacked-up substrate'],
    ['stale_schedule', 'Stale schedules'],
  ];
  const typeBreakdown = typeLabels
    .filter(([t]) => byType[t] > 0)
    .map(([t, label]) => `${label}: ${byType[t]}`)
    .join(' · ');
  if (typeBreakdown) {
    lines.push(``, `*${typeBreakdown}*`);
  }

  // Render large clusters as collapsed summaries
  if (largeClusters.length > 0) {
    for (const cluster of largeClusters) {
      const prefix = detectClusterPrefix(cluster.artifactIds);
      const count = cluster.artifactIds.size;
      const maxSev = cluster.findings.some(f => f.severity === 'critical')
        ? 'critical'
        : cluster.findings.some(f => f.severity === 'recommended')
          ? 'recommended'
          : 'nice_to_have';
      const sevEmoji = maxSev === 'critical' ? '🔴' : maxSev === 'recommended' ? '🟡' : '🟢';
      const sevLabel = maxSev === 'critical' ? 'Critical' : maxSev === 'recommended' ? 'Recommended' : 'Nice to have';

      if (prefix) {
        lines.push(
          ``,
          `### ${sevEmoji} [overlap] ${count} "${prefix}" tools overlap with each other (${cluster.findings.length} findings)`,
          `These are separate tools in the same product suite that share vocabulary. Expected — not duplicates.`,
          ``,
          `**Artifacts:** ${Array.from(cluster.artifactIds).map(id => `\`${id}\``).join(', ')}`,
          ``,
          `**Recommendation:** Safe to ignore unless you've noticed the wrong tool getting invoked. If you change one, check the others still make sense.`,
          ``,
          `---`,
        );
      } else {
        lines.push(
          ``,
          `### ${sevEmoji} [overlap] ${cluster.findings.length} overlap findings between ${count} related artifacts`,
          `Multiple artifacts in your stack have similar descriptions. They may be related tools or intentional variants.`,
          ``,
          `**Artifacts:** ${Array.from(cluster.artifactIds).map(id => `\`${id}\``).join(', ')}`,
          ``,
          `**Recommendation:** Review whether these are intentionally separate. If so, no action needed.`,
          ``,
          `---`,
        );
      }
    }
  }

  // Findings grouped by severity — excluding clustered overlap findings
  const severityHeaders: Array<[AuditFinding['severity'], string]> = [
    ['critical', '## 🔴 Critical Findings'],
    ['recommended', '## 🟡 Recommended'],
    ['nice_to_have', '## 🟢 Nice to have'],
  ];

  for (const [sev, header] of severityHeaders) {
    const group = textFindings.filter(
      f => f.severity === sev && !largeClustedFindingIds.has(f.id),
    );
    if (group.length === 0) continue;
    lines.push(``, header, ``);
    for (const f of group) {
      lines.push(`### [${f.type}] ${f.title}`);
      lines.push(f.description);
      if (f.evidence.length > 0) {
        lines.push(``, `**Evidence:**`);
        for (const ev of f.evidence) {
          const prefix = ev.kind === 'path' ? '📍' : ev.kind === 'quote' ? '💬' : '📊';
          lines.push(`- ${prefix} \`${ev.source}\` — ${ev.excerpt}`);
        }
      }
      lines.push(``, `**Why it matters:** ${f.why}`);
      lines.push(``, `**Recommendation:** ${f.recommendation}`);
      lines.push(``, `*Finding id (to dismiss): \`${f.id}\`*`);
      lines.push(``, `---`);
    }
  }

  if (report.findings.length === 0) {
    lines.push(
      ``,
      `## No findings`,
      `Your setup looks coherent on the signals we check — no orphan jobs, no overlapping artifacts, no missing data-flow closure, no markdown-as-database drift.`,
      ``,
      `*(Audit is conservative to keep the noise level low. Absence of findings isn't a proof of coherence — it's a sign no obvious red flags are present.)*`,
    );
  }

  // What to do — assessment section
  lines.push(``, ...generateAssessment(report, clusters));

  // Graph overview
  lines.push(
    ``,
    `## Stack Overview`,
    `- **${report.graph.byType.skill}** skills`,
    `- **${report.graph.byType.scheduled_task}** scheduled tasks`,
    `- **${report.graph.byType.command}** commands`,
    `- **${report.graph.byType.hook}** hooks`,
    `- **${report.graph.byType.mcp_server}** MCP servers`,
    `- **${report.graph.byType.memory_file}** memory files`,
  );

  // Feedback loop
  if (report.feedback.totalTracked > 0) {
    lines.push(
      ``,
      `## Progress since last audit`,
      `- **${report.feedback.pending}** pending, **${report.feedback.fixed}** fixed, **${report.feedback.dismissed}** dismissed`,
    );
    const recentFixed = report.feedback.history.filter(h => h.status === 'fixed').slice(0, 3);
    if (recentFixed.length > 0) {
      lines.push(``, `**Recently fixed:**`);
      for (const h of recentFixed) {
        lines.push(`- ✅ ${h.title}`);
      }
    }
  }

  return lines.join('\n');
}
