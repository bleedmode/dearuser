// security tool — orchestrates three scanners:
//   1. secret-scanner   → leaked credentials in CLAUDE.md, memory, skills, settings
//   2. injection-detector (reused from analyze) → hooks/skills using user input unsafely
//   3. rule-conflict-detector → CLAUDE.md rules vs hook/skill behavior divergence

import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { scanArtifacts } from '../engine/audit-scanner.js';
import { scanSecrets } from '../engine/secret-scanner.js';
import { detectInjection } from '../engine/injection-detector.js';
import { detectRuleConflicts } from '../engine/rule-conflict-detector.js';
import type {
  Scope,
  SecurityReport,
  SecretFinding,
  InjectionFinding,
  RuleConflict,
  GapSeverity,
} from '../types.js';

export interface SecurityOptions {
  projectRoot?: string;
  scope?: Scope;
}

export function runSecurity(options: SecurityOptions = {}): SecurityReport {
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

  // 4. Summary counts (across all three finding types)
  const allFindings: Array<{ severity: GapSeverity }> = [
    ...secrets,
    ...injection,
    ...ruleConflicts,
  ];
  const critical = allFindings.filter(f => f.severity === 'critical').length;
  const recommended = allFindings.filter(f => f.severity === 'recommended').length;
  const niceToHave = allFindings.filter(f => f.severity === 'nice_to_have').length;

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    scope,
    secrets,
    injection,
    ruleConflicts,
    summary: { critical, recommended, niceToHave },
  };
}

/** Format a SecurityReport as markdown for the MCP client. */
export function formatSecurityReport(report: SecurityReport): string {
  const lines: string[] = [
    `# Dear User — Security Audit`,
    ``,
    `*Scanned secrets, prompt-injection surfaces, and rule conflicts across your setup.*`,
    ``,
    `## Summary`,
    `- 🔴 **${report.summary.critical}** critical`,
    `- 🟡 **${report.summary.recommended}** recommended`,
    `- 🟢 **${report.summary.niceToHave}** nice-to-have`,
    ``,
    `- Secrets: ${report.secrets.length}`,
    `- Injection surfaces: ${report.injection.length}`,
    `- Rule conflicts: ${report.ruleConflicts.length}`,
  ];

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

  // Empty state
  if (report.secrets.length === 0 && report.injection.length === 0 && report.ruleConflicts.length === 0) {
    lines.push(
      ``,
      `## No findings`,
      `No leaked secrets, no high-severity injection surfaces, no rule conflicts detected. Your security posture on these axes looks clean.`,
      ``,
      `*(Absence of findings isn't proof of security. The scanner catches well-known patterns; custom risks still need manual review.)*`,
    );
  }

  return lines.join('\n');
}
