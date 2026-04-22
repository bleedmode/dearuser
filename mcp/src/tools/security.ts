// security tool — orchestrates scanners across two tiers:
//
// Tier A — agent setup (what only Dear User can do):
//   1. secret-scanner   → leaked credentials in CLAUDE.md, memory, skills, settings
//   2. injection-detector → hooks/skills using user input unsafely
//   3. rule-conflict-detector → CLAUDE.md rules vs hook/skill behavior divergence
//
// Tier B — platform advisors (orchestration, not reimplementation):
//   4. Supabase Advisor  → RLS, policies, function search_path
//   (future: GitHub Dependabot, npm audit, Vercel)
//
// Philosophy: platform advisors own their domain. We aggregate their output
// into one unified report so users have a single security pane.

import * as path from 'node:path';
import * as os from 'node:os';
import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { scanArtifacts } from '../engine/audit-scanner.js';
import { scanSecrets } from '../engine/secret-scanner.js';
import { detectInjection } from '../engine/injection-detector.js';
import { detectRuleConflicts } from '../engine/rule-conflict-detector.js';
import { checkCves } from '../engine/cve-checker.js';
import { runSupabaseAdvisor } from '../engine/supabase-advisor.js';
import { runGitHubAdvisor } from '../engine/github-advisor.js';
import { runNpmAdvisor } from '../engine/npm-advisor.js';
import { runVercelAdvisor } from '../engine/vercel-advisor.js';
import { loadConfig } from '../engine/config.js';
import { insertAgentRun } from '../engine/db.js';
import { trackFindingsAsRecommendations } from '../engine/feedback-tracker.js';
import {
  upsertFinding,
  finalizeScanScope,
  computeFindingHash,
  reopenExpiredDismissals,
} from '../engine/findings-ledger.js';
import { scoreSecurity } from '../engine/security-scorer.js';
import type { ScoreCeiling } from '../types.js';
import type {
  Scope,
  SecurityReport,
  SecretFinding,
  InjectionFinding,
  RuleConflict,
  GapSeverity,
  PlatformAdvisorFinding,
  PlatformAdvisorStatus,
  OwaspAgenticCategory,
  CveFinding,
} from '../types.js';

// OWASP Agentic AI Top 10 (2025/2026) labels
const OWASP_LABELS: Record<OwaspAgenticCategory, string> = {
  'ASI-01': 'Agent Goal Hijack',
  'ASI-02': 'Insecure Tool Design',
  'ASI-03': 'Identity & Privilege Abuse',
  'ASI-04': 'Insecure Supply Chain',
  'ASI-05': 'Tool Misuse',
  'ASI-06': 'Memory & Context Poisoning',
  'ASI-07': 'Insecure Inter-Agent Communication',
  'ASI-08': 'Cascading Failures',
  'ASI-09': 'Human-Agent Trust Exploitation',
  'ASI-10': 'Rogue Agents',
};

export interface SecurityOptions {
  projectRoot?: string;
  scope?: Scope;
  /** Root directories to scan for projects with platform credentials (e.g. ~/dev, ~/projects). Defaults to common dev folders from config. */
  projectSearchRoots?: string[];
  /** Skip platform advisor tier entirely (faster, agent-setup only). */
  skipPlatformAdvisors?: boolean;
}

export async function runSecurity(options: SecurityOptions = {}): Promise<SecurityReport> {
  const scope = options.scope || 'global';
  const projectRoot = options.projectRoot || process.cwd();

  // 1. Base scan + parse for CLAUDE.md and settings files (re-using analyze's pipeline)
  const scanResult = scan(projectRoot, scope);
  const parsed = parse(scanResult);

  // 2. Artifact discovery (shared with audit + analyze)
  const artifacts = scanArtifacts();

  // 3. Assemble CLAUDE.md + memory + settings as text sources for secret scanning
  const claudeMdFiles = [scanResult.globalClaudeMd, scanResult.projectClaudeMd]
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const memoryAsFiles = scanResult.memoryFiles;
  const allTextFiles = [...claudeMdFiles, ...memoryAsFiles];

  const secrets = scanSecrets(artifacts, allTextFiles, scanResult.settingsFiles);
  const injection = detectInjection(artifacts);
  const ruleConflicts = detectRuleConflicts(parsed.rules, artifacts);
  const cveFindings = checkCves(scanResult.settingsFiles, scope === 'project' ? projectRoot : null);

  // 4. Platform advisor tier — orchestrate external sources of truth
  const platformFindings: PlatformAdvisorFinding[] = [];
  const platformStatus: PlatformAdvisorStatus[] = [];

  if (!options.skipPlatformAdvisors) {
    const config = loadConfig();
    const searchRoots = options.projectSearchRoots || config.searchRoots;
    const disabled = new Set(config.disabledAdvisors);

    // Each advisor: either run it, or mark as "disabled by config" in status.
    type Advisor = { name: 'supabase' | 'github' | 'npm' | 'vercel'; run: () => Promise<{ findings: PlatformAdvisorFinding[]; status: PlatformAdvisorStatus }> };
    const advisors: Advisor[] = [
      { name: 'supabase', run: () => runSupabaseAdvisor(searchRoots) },
      { name: 'github',   run: () => runGitHubAdvisor(searchRoots) },
      { name: 'npm',      run: () => runNpmAdvisor(searchRoots) },
      { name: 'vercel',   run: () => runVercelAdvisor(searchRoots) },
    ];

    const advisorResults = await Promise.allSettled(
      advisors.map(a =>
        disabled.has(a.name)
          ? Promise.resolve({
              findings: [],
              status: { platform: a.name, status: 'skipped' as const, projectsScanned: 0, reason: 'Disabled in ~/.dearuser/config.json' },
            })
          : a.run()
      )
    );

    advisorResults.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        platformFindings.push(...result.value.findings);
        platformStatus.push(result.value.status);
      } else {
        platformStatus.push({
          platform: advisors[i].name,
          status: 'error',
          projectsScanned: 0,
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    });
  }

  // 5. Summary counts (across all finding types + platform findings)
  const allFindings: Array<{ severity: GapSeverity; owaspCategory?: string }> = [
    ...secrets,
    ...injection,
    ...ruleConflicts,
    ...cveFindings,
    ...platformFindings,
  ];
  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const recommended = allFindings.filter(f => f.severity === 'recommended').length;
  const niceToHave = allFindings.filter(f => f.severity === 'nice_to_have').length;

  // 6. OWASP summary — count findings per category
  const owaspSummary: Partial<Record<OwaspAgenticCategory, number>> = {};
  for (const f of allFindings) {
    if (f.owaspCategory) {
      const cat = f.owaspCategory as OwaspAgenticCategory;
      owaspSummary[cat] = (owaspSummary[cat] || 0) + 1;
    }
  }

  // 7. Score — turn findings into a 0-100 number with category breakdown.
  //    Mirrors collaboration scoring so the dashboard can render both under
  //    the same visual language.
  const { categories, securityScore } = scoreSecurity({
    secrets,
    injection,
    ruleConflicts,
    cveFindings,
    platformFindings,
    platformStatus,
  });

  // 8. Ceiling — every current finding has a recommendation to fix it, so
  //    fixing them all takes each category to 100 (except platformCompliance
  //    when advisors aren't reachable — that needs setup, not a fix).
  const platformCovered = platformStatus.some(s => s.status === 'ok' && s.projectsScanned > 0);
  const byCategory: ScoreCeiling['byCategory'] = {};
  let ceilingWeightedSum = 0;
  const unreachable: string[] = [];
  for (const [id, cat] of Object.entries(categories)) {
    const ceiling = id === 'platformCompliance' && !platformCovered ? 0 : 100;
    byCategory[id] = { current: cat.score, ceiling, delta: ceiling - cat.score };
    ceilingWeightedSum += ceiling * cat.weight;
  }
  if (!platformCovered) {
    unreachable.push('Platform advisors not reachable — Platform Compliance can\'t score until 1Password tokens are configured. See ~/.dearuser/config.json.');
  }
  const ceilingScore = Math.round(ceilingWeightedSum);
  const scoreCeiling: ScoreCeiling = {
    currentScore: securityScore,
    ceilingScore,
    delta: ceilingScore - securityScore,
    byCategory,
    unreachable,
    summary: ceilingScore === securityScore
      ? `Already at your security ceiling. New findings from future scans may move this number.`
      : ceilingScore === 100
        ? `Fixing every finding in this report lifts your security score to 100.`
        : `Fixing every finding lifts your score from ${securityScore} to ${ceilingScore}. ${unreachable.length > 0 ? 'The gap to 100 needs one-time setup (see below).' : ''}`.trim(),
  };

  // Persist agent run to SQLite
  let agentRunId: string | undefined;
  try {
    agentRunId = insertAgentRun({
      toolName: 'security',
      summary: `${critical + recommended + niceToHave} findings (${critical} critical, ${recommended} recommended, ${niceToHave} nice-to-have)`,
      score: securityScore,
      status: 'success',
    });
    trackFindingsAsRecommendations(
      [...secrets, ...injection, ...ruleConflicts, ...cveFindings, ...platformFindings],
      securityScore,
      agentRunId,
    );

    // Upsert every observed finding into the ledger and close out-of-scope
    // findings the scan didn't see. This is the close-loop mechanism —
    // findings only transition to 'closed' when a scan covers their scope
    // and stops reporting them.
    const runId = agentRunId ?? null;
    const observedByScope = new Map<string, Set<string>>();
    const scopeKey = (platform: string, subject: string | null): string =>
      subject ? `${platform}:${subject}` : platform;

    const allFindings = [...secrets, ...injection, ...ruleConflicts, ...cveFindings, ...platformFindings];
    for (const f of allFindings) {
      try {
        const { hash, platform, subject } = computeFindingHash(f as any);
        // Attach hash to the finding so downstream consumers (scheduled
        // agents, dashboard, PVS task dedup) can reference the ledger entry
        // without re-deriving the hash.
        (f as any).findingHash = hash;
        upsertFinding(f as any, runId);
        const key = scopeKey(platform, subject);
        if (!observedByScope.has(key)) observedByScope.set(key, new Set());
        observedByScope.get(key)!.add(hash);
      } catch {
        // Unrecognized shapes shouldn't break the scan
      }
    }

    // Agent-setup scans always cover the whole agent scope in one shot.
    // Close any agent-level findings that didn't come back this run.
    const agentHashes = observedByScope.get('agent') ?? new Set<string>();
    // Secret/injection/rule_conflict all live under subject!=null (file paths),
    // but from the ledger's perspective they're still platform='agent'. A
    // full agent-setup scan is a scope-wide sweep, so we close any open
    // agent-level finding not seen this run.
    if (!options.skipPlatformAdvisors || scope === 'global') {
      const agentWideHashes = new Set<string>();
      for (const [key, hashes] of observedByScope) {
        if (key === 'agent' || key.startsWith('agent:')) {
          for (const h of hashes) agentWideHashes.add(h);
        }
      }
      finalizeScanScope({ platform: 'agent' }, agentWideHashes, runId);
    }

    // Platform advisors: only close within the subject scope we actually
    // scanned. A Supabase scan of "safedish" shouldn't close findings for
    // "other-project" just because we didn't see them this run.
    for (const status of platformStatus) {
      if (status.status !== 'ok') continue;
      // Collect per-subject scopes for this platform from the observed map
      for (const [key, hashes] of observedByScope) {
        if (!key.startsWith(`${status.platform}:`)) continue;
        const subject = key.slice(status.platform.length + 1);
        finalizeScanScope(
          { platform: status.platform, subject },
          hashes,
          runId,
        );
      }
    }

    // Reopen any dismissals that expired
    reopenExpiredDismissals(runId);
  } catch {
    // DB write failure should never break the security scan
  }

  return {
    _agentRunId: agentRunId,
    version: '1.2',
    generatedAt: new Date().toISOString(),
    scope,
    secrets,
    injection,
    ruleConflicts,
    cveFindings,
    platformFindings,
    platformStatus,
    securityScore,
    categories,
    scoreCeiling,
    summary: { critical, recommended, niceToHave },
    owaspSummary,
  };
}

/** Format a SecurityReport as markdown for the MCP client. */
export function formatSecurityReport(report: SecurityReport): string {
  const c = report.scoreCeiling;
  const ceilingLine = c && c.delta > 0
    ? `**Reachable ceiling: ${c.ceilingScore}/100** (+${c.delta} if you fix every finding below).`
    : c && c.ceilingScore === 100
      ? `**Reachable ceiling: 100/100** — fixing every finding takes you all the way.`
      : `**Reachable ceiling: ${c?.ceilingScore ?? report.securityScore}/100.**`;

  const lines: string[] = [
    `# Dear User — Security`,
    ``,
    `*Unified security pane: agent setup + platform advisors (Supabase, GitHub, npm, Vercel).*`,
    ``,
    `## Security Score: ${report.securityScore}/100`,
    ``,
    ceilingLine,
  ];

  if (c && c.unreachable.length > 0) {
    lines.push(``, `*Why not 100:*`);
    for (const reason of c.unreachable) lines.push(`- ${reason}`);
  }

  // Category breakdown — same shape as the analyze report
  lines.push(``, `### Category Scores`);
  const catConfig: Array<[keyof typeof report.categories, string]> = [
    ['secretSafety', 'Secret Safety'],
    ['injectionResistance', 'Injection Resistance'],
    ['ruleIntegrity', 'Rule Integrity'],
    ['dependencySafety', 'Dependency Safety'],
    ['platformCompliance', 'Platform Compliance'],
  ];
  for (const [key, name] of catConfig) {
    const cat = report.categories[key];
    const bar = '█'.repeat(Math.round(cat.score / 10)) + '░'.repeat(10 - Math.round(cat.score / 10));
    const status = cat.score >= 85 ? 'Strong'
      : cat.score >= 70 ? 'Good'
      : cat.score >= 50 ? 'Needs work'
      : cat.score > 0 ? 'Weak — action needed'
      : 'Not measured';
    lines.push(`- **${name}**: ${bar} ${cat.score}/100 — *${status}*`);
    for (const sig of cat.signalsPresent.slice(0, 1)) lines.push(`  - ✓ ${sig}`);
    for (const sig of cat.signalsMissing.slice(0, 2)) lines.push(`  - → ${sig}`);
  }

  lines.push(
    ``,
    `## Summary`,
    `- 🔴 **${report.summary.critical}** critical`,
    `- 🟡 **${report.summary.recommended}** recommended`,
    `- 🟢 **${report.summary.niceToHave}** nice-to-have`,
    ``,
    `**Agent setup:**`,
    `- Secrets: ${report.secrets.length}`,
    `- Injection surfaces: ${report.injection.length}`,
    `- Rule conflicts: ${report.ruleConflicts.length}`,
    `- CVE checks: ${report.cveFindings.length}`,
    ``,
    `**Platform advisors:**`,
    `- ${report.platformFindings.length} findings across ${report.platformStatus.length} platform(s)`,
  );

  // --- OWASP Agentic AI Top 10 summary ---
  const owaspEntries = Object.entries(report.owaspSummary) as Array<[OwaspAgenticCategory, number]>;
  if (owaspEntries.length > 0) {
    lines.push(``, `### OWASP Agentic AI Top 10 Coverage`, ``);
    lines.push(`| Category | Findings |`);
    lines.push(`|----------|----------|`);
    for (const [cat, count] of owaspEntries.sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`| ${cat} — ${OWASP_LABELS[cat]} | ${count} |`);
    }
    lines.push(``, `*Mapped to [OWASP Agentic AI Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/). Categories without findings omitted.*`);
  }

  // --- Platform status transparency ---
  if (report.platformStatus.length > 0) {
    lines.push(``, `### Platform coverage`, ``);
    for (const s of report.platformStatus) {
      const icon = s.status === 'ok' ? '✅' : s.status === 'skipped' ? '⏭️' : '❌';
      const detail = s.status === 'ok'
        ? `scanned ${s.projectsScanned} project(s)`
        : s.reason || s.status;
      lines.push(`- ${icon} **${s.platform}** — ${detail}`);
    }
  }

  // --- Secrets section — highest priority ---
  if (report.secrets.length > 0) {
    lines.push(``, `## 🔐 Leaked Secrets`, ``);
    lines.push(`**These are credentials in plaintext. Rotate immediately if any were ever committed to git or shared.**`, ``);
    for (const s of report.secrets) {
      const marker = s.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`### ${marker} ${s.title}`);
      lines.push(`**Where:** \`${s.location}\`${s.lineNumber ? ` (line ${s.lineNumber})` : ''}`);
      lines.push(`**Preview:** \`${s.excerpt}\``);
      lines.push(`**Category:** ${s.category.replace(/_/g, ' ')}`);
      if (s.owaspCategory) lines.push(`**OWASP:** ${s.owaspCategory} — ${OWASP_LABELS[s.owaspCategory]}`);
      lines.push(``, `**Fix:** ${s.recommendation}`);
      lines.push(``, `---`, ``);
    }
  }

  // --- Injection section ---
  if (report.injection.length > 0) {
    lines.push(``, `## 🛡️ Prompt-Injection Surfaces`, ``);
    lines.push(`*Static pattern matching — false positives possible. Worth a manual review.*`, ``);
    for (const i of report.injection.filter(x => x.severity !== 'nice_to_have').slice(0, 10)) {
      const marker = i.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`### ${marker} ${i.title}`);
      lines.push(`**Where:** \`${i.artifactPath}\``);
      if (i.owaspCategory) lines.push(`**OWASP:** ${i.owaspCategory} — ${OWASP_LABELS[i.owaspCategory]}`);
      lines.push(`**Why:** ${i.why}`);
      lines.push(``, '```');
      lines.push(i.excerpt);
      lines.push('```');
      lines.push(``, `**Fix:** ${i.recommendation}`);
      lines.push(``, `---`, ``);
    }
    const niceCount = report.injection.filter(x => x.severity === 'nice_to_have').length;
    if (niceCount > 0) {
      lines.push(`*Plus ${niceCount} low-severity injection findings — run \`audit\` with focus on injection for details.*`);
    }
  }

  // --- Rule conflicts ---
  if (report.ruleConflicts.length > 0) {
    lines.push(``, `## ⚠️ Rule Conflicts`, ``);
    lines.push(`*Where CLAUDE.md says one thing but a hook/skill does another. The most damaging kind of drift — the agent and you disagree about reality without knowing it.*`, ``);
    for (const c of report.ruleConflicts) {
      const marker = c.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`### ${marker} ${c.title}`);
      lines.push(`**CLAUDE.md says:** *"${c.claudeMdRule.slice(0, 160)}${c.claudeMdRule.length > 160 ? '…' : ''}"*`);
      lines.push(`**Source:** \`${c.claudeMdSource}\``);
      lines.push(`**Conflicting artifact:** \`${c.conflictingPath}\``);
      lines.push(`**Excerpt:** \`${c.excerpt.slice(0, 140)}\``);
      if (c.owaspCategory) lines.push(`**OWASP:** ${c.owaspCategory} — ${OWASP_LABELS[c.owaspCategory]}`);
      lines.push(``, `**Why it matters:** ${c.why}`);
      lines.push(``, `**Fix:** ${c.recommendation}`);
      lines.push(``, `---`, ``);
    }
  }

  // --- CVE checks ---
  if (report.cveFindings.length > 0) {
    lines.push(``, `## 🚨 Known CVE Checks`, ``);
    lines.push(`*Checks for known Claude Code vulnerabilities with assigned CVE identifiers.*`, ``);
    for (const c of report.cveFindings) {
      const marker = c.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`### ${marker} ${c.cveId} (CVSS ${c.cvssScore})`);
      lines.push(`**${c.title}**`);
      lines.push(`**Where:** \`${c.location}\``);
      lines.push(`**Excerpt:** \`${c.excerpt.slice(0, 140)}\``);
      lines.push(`**OWASP:** ${c.owaspCategory} — ${OWASP_LABELS[c.owaspCategory]}`);
      lines.push(``, c.description);
      lines.push(``, `**Fix:** ${c.recommendation}`);
      lines.push(``, `---`, ``);
    }
  }

  // --- Platform findings section — grouped by platform + project ---
  if (report.platformFindings.length > 0) {
    lines.push(``, `## 🌐 Platform Advisor Findings`, ``);
    lines.push(`*Reported directly by the platforms themselves (Supabase Advisor, etc.) — these are authoritative, not grep-based heuristics.*`, ``);

    // Group by platform then by project
    const byPlatform = new Map<string, PlatformAdvisorFinding[]>();
    for (const f of report.platformFindings) {
      if (!byPlatform.has(f.platform)) byPlatform.set(f.platform, []);
      byPlatform.get(f.platform)!.push(f);
    }

    for (const [platform, items] of byPlatform) {
      lines.push(`### ${platform.charAt(0).toUpperCase() + platform.slice(1)}`, ``);
      // severity sort: critical → recommended → nice_to_have
      const sorted = [...items].sort((a, b) => {
        const sev = (s: GapSeverity) => s === 'critical' ? 0 : s === 'recommended' ? 1 : 2;
        return sev(a.severity) - sev(b.severity);
      });
      for (const f of sorted.slice(0, 20)) {
        const marker = f.severity === 'critical' ? '🔴' : f.severity === 'recommended' ? '🟡' : '🟢';
        lines.push(`- ${marker} **[${f.projectName}]** ${f.title} — \`${f.category}\``);
        if (f.detail) lines.push(`  - ${f.detail}`);
        if (f.fixUrl) lines.push(`  - Fix: ${f.fixUrl}`);
      }
      if (items.length > 20) {
        lines.push(`- *…plus ${items.length - 20} more — see platform dashboard for full list.*`);
      }
      lines.push(``);
    }
  }

  // Empty state
  const totalFindings = report.secrets.length + report.injection.length + report.ruleConflicts.length + report.cveFindings.length + report.platformFindings.length;
  if (totalFindings === 0) {
    lines.push(
      ``,
      `## No findings`,
      `No leaked secrets, injection surfaces, rule conflicts, or platform advisor issues detected. Your security posture looks clean.`,
      ``,
      `*(Absence of findings isn't proof of security. The scanner catches well-known patterns; custom risks still need manual review.)*`,
    );
  }

  return lines.join('\n');
}
