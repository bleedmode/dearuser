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
  /** Root directories to scan for projects with platform credentials (e.g. ~/clawd). Defaults to [~/clawd]. */
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

  // Persist agent run to SQLite
  let agentRunId: string | undefined;
  try {
    agentRunId = insertAgentRun({
      toolName: 'security',
      summary: `${critical + recommended + niceToHave} findings (${critical} critical, ${secrets.length} secrets, ${cveFindings.length} CVEs)`,
      status: 'success',
    });
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
    summary: { critical, recommended, niceToHave },
    owaspSummary,
  };
}

/** Format a SecurityReport as markdown for the MCP client. */
export function formatSecurityReport(report: SecurityReport): string {
  const lines: string[] = [
    `# Dear User — Security Audit`,
    ``,
    `*Unified security pane: agent setup + platform advisors (Supabase, etc).*`,
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
  ];

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
