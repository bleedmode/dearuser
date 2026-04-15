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
import type {
  AuditArtifact,
  AuditArtifactType,
  AuditFinding,
  AuditFindingType,
  AuditReport,
  Scope,
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
  const findings = runDetectors(graph, options);

  // 4. Feedback
  const feedback = reconcileFindings(findings);

  return {
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
    summary: {
      critical: findings.filter(f => f.severity === 'critical').length,
      recommended: findings.filter(f => f.severity === 'recommended').length,
      niceToHave: findings.filter(f => f.severity === 'nice_to_have').length,
      byType: countFindingsByType(findings),
    },
    feedback,
  };
}

/** Format an AuditReport as the markdown string we return to the MCP client. */
export function formatAuditReport(report: AuditReport): string {
  const lines: string[] = [
    `# Dear User — System Audit`,
    ``,
    `*Scanned: ${report.graph.nodeCount} artifacts, ${report.graph.edgeCount} edges` +
      (report.graph.closureRate !== null
        ? ` · Closure rate: ${Math.round(report.graph.closureRate * 100)}% of produced outputs have a consumer*`
        : `*`),
    ``,
    `## Summary`,
    `- 🔴 **${report.summary.critical}** critical`,
    `- 🟡 **${report.summary.recommended}** recommended`,
    `- 🟢 **${report.summary.niceToHave}** nice-to-have`,
  ];

  const byType = report.summary.byType;
  const typeLabels: Array<[AuditFindingType, string]> = [
    ['orphan_job', 'Orphan scheduled jobs'],
    ['overlap', 'Overlap'],
    ['missing_closure', 'Missing closure'],
    ['substrate_mismatch', 'Substrate mismatch'],
  ];
  const typeBreakdown = typeLabels
    .filter(([t]) => byType[t] > 0)
    .map(([t, label]) => `${label}: ${byType[t]}`)
    .join(' · ');
  if (typeBreakdown) {
    lines.push(``, `*${typeBreakdown}*`);
  }

  // Findings grouped by severity
  const severityHeaders: Array<[AuditFinding['severity'], string]> = [
    ['critical', '## 🔴 Critical Findings'],
    ['recommended', '## 🟡 Recommended'],
    ['nice_to_have', '## 🟢 Nice to have'],
  ];

  for (const [sev, header] of severityHeaders) {
    const group = report.findings.filter(f => f.severity === sev);
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
