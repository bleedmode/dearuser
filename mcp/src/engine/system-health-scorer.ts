// system-health-scorer — turns audit findings into a 0-100 score with the
// same category/ceiling shape as the collaboration + security scorers.
//
// "Audit" is being renamed to "system health" (Danish: system-sundhed) — the
// word "audit" implies compliance paperwork; what this actually measures is
// whether your stack of skills, hooks, scheduled tasks, and MCP servers
// still hangs together or has started drifting apart.

import type { AuditFinding, CategoryScore, GapSeverity } from '../types.js';

type SystemHealthCategoryId =
  | 'jobIntegrity'
  | 'artifactOverlap'
  | 'dataClosure'
  | 'configHealth'
  | 'substrateHealth';

export interface SystemHealthScoringResult {
  categories: Record<SystemHealthCategoryId, CategoryScore>;
  systemHealthScore: number;
}

const WEIGHTS: Record<SystemHealthCategoryId, number> = {
  jobIntegrity: 0.30,      // Scheduled jobs must actually run
  artifactOverlap: 0.15,   // Near-duplicate artifacts drift apart
  dataClosure: 0.20,       // Outputs should have consumers
  configHealth: 0.20,      // MCP refs must resolve
  substrateHealth: 0.15,   // Storage choices + backup
};

function penaltyFor(severity: GapSeverity): number {
  switch (severity) {
    case 'critical': return 30;
    case 'recommended': return 10;
    case 'nice_to_have': return 3;
  }
}

/**
 * Which category does each finding type contribute to? Kept explicit so a new
 * detector has to declare its home rather than quietly reshaping the score.
 */
const TYPE_TO_CATEGORY: Record<string, SystemHealthCategoryId> = {
  orphan_job: 'jobIntegrity',
  stale_schedule: 'jobIntegrity',
  expected_job_missing: 'jobIntegrity',
  overlap: 'artifactOverlap',
  missing_closure: 'dataClosure',
  unregistered_mcp_tool: 'configHealth',
  substrate_mismatch: 'substrateHealth',
  unbacked_up_substrate: 'substrateHealth',
};

const CATEGORY_EMPTY_MESSAGES: Record<SystemHealthCategoryId, string> = {
  jobIntegrity: 'All scheduled jobs have documented consumers and are running on schedule',
  artifactOverlap: 'No near-duplicate skills or scheduled tasks',
  dataClosure: 'All produced outputs have downstream consumers',
  configHealth: 'All MCP tool references resolve to registered servers',
  substrateHealth: 'Storage substrate matches the shape of the data, and ~/.claude/ is backed up',
};

export function scoreSystemHealth(findings: AuditFinding[]): SystemHealthScoringResult {
  const byCategory: Record<SystemHealthCategoryId, AuditFinding[]> = {
    jobIntegrity: [],
    artifactOverlap: [],
    dataClosure: [],
    configHealth: [],
    substrateHealth: [],
  };

  for (const f of findings) {
    const cat = TYPE_TO_CATEGORY[f.type];
    if (cat) byCategory[cat].push(f);
  }

  const categories: Record<SystemHealthCategoryId, CategoryScore> = {} as Record<SystemHealthCategoryId, CategoryScore>;
  for (const [id, catFindings] of Object.entries(byCategory) as Array<[SystemHealthCategoryId, AuditFinding[]]>) {
    const penalty = catFindings.reduce((sum, f) => sum + penaltyFor(f.severity), 0);
    const score = Math.max(0, Math.min(100, 100 - penalty));

    const present: string[] = [];
    const missing: string[] = [];

    if (catFindings.length === 0) {
      present.push(CATEGORY_EMPTY_MESSAGES[id]);
    } else {
      const crit = catFindings.filter(f => f.severity === 'critical').length;
      const rec = catFindings.filter(f => f.severity === 'recommended').length;
      const nice = catFindings.filter(f => f.severity === 'nice_to_have').length;
      if (crit > 0) missing.push(`${crit} critical issue${crit === 1 ? '' : 's'}`);
      if (rec > 0) missing.push(`${rec} recommended issue${rec === 1 ? '' : 's'}`);
      if (nice > 0) missing.push(`${nice} nice-to-have issue${nice === 1 ? '' : 's'}`);
    }

    categories[id] = { score, weight: WEIGHTS[id], signalsPresent: present, signalsMissing: missing };
  }

  const systemHealthScore = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score * cat.weight, 0),
  );

  return { categories, systemHealthScore };
}
