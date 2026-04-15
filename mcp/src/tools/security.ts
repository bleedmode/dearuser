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
import { runSupabaseAdvisor } from '../engine/supabase-advisor.js';
import { runGitHubAdvisor } from '../engine/github-advisor.js';
import { runNpmAdvisor } from '../engine/npm-advisor.js';
import { runVercelAdvisor } from '../engine/vercel-advisor.js';
import { loadConfig } from '../engine/config.js';
import type {
  Scope,
  SecurityReport,
  SecretFinding,
  InjectionFinding,
  RuleConflict,
  GapSeverity,
  PlatformAdvisorFinding,
  PlatformAdvisorStatus,
} from '../types.js';

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
  const allFindings: Array<{ severity: GapSeverity }> = [
    ...secrets,
    ...injection,
    ...ruleConflicts,
    ...platformFindings,
  ];
  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const recommended = allFindings.filter(f => f.severity === 'recommended').length;
  const niceToHave = allFindings.filter(f => f.severity === 'nice_to_have').length;

  return {
    version: '1.1',
    generatedAt: new Date().toISOString(),
    scope,
    secrets,
    injection,
    ruleConflicts,
    platformFindings,
    platformStatus,
    summary: { critical, recommended, niceToHave },
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
    ``,
    `**Platform advisors:**`,
    `- ${report.platformFindings.length} findings across ${report.platformStatus.length} platform(s)`,
  ];

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
      lines.push(``, `**Why it matters:** ${c.why}`);
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
  const totalFindings = report.secrets.length + report.injection.length + report.ruleConflicts.length + report.platformFindings.length;
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
