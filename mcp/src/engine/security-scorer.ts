// security-scorer — turns the raw SecurityReport into a 0-100 score plus
// per-category breakdown, mirroring the collaboration score's shape so the
// dashboard can render them side-by-side.
//
// Why the parity with scorer.ts:
//   Users shouldn't have to learn two mental models. "Score 0-100, weighted
//   categories, each category 0-100 with signals" is the pattern. Security
//   just reports findings against that same frame.

import type {
  CategoryScore,
  GapSeverity,
  SecretFinding,
  InjectionFinding,
  RuleConflict,
  CveFinding,
  PlatformAdvisorFinding,
  PlatformAdvisorStatus,
} from '../types.js';

type SecurityCategoryId =
  | 'secretSafety'
  | 'injectionResistance'
  | 'ruleIntegrity'
  | 'dependencySafety'
  | 'platformCompliance';

export interface SecurityScoringResult {
  categories: Record<SecurityCategoryId, CategoryScore>;
  securityScore: number;
}

const WEIGHTS: Record<SecurityCategoryId, number> = {
  secretSafety: 0.30,
  injectionResistance: 0.20,
  ruleIntegrity: 0.15,
  dependencySafety: 0.15,
  platformCompliance: 0.20,
};

/**
 * Severity-weighted penalty. Tuned so one critical finding drops a category
 * from 100 to 70 (still "needs work"), two criticals drop it to 40 ("weak"),
 * and three or more zero it. Recommended + nice-to-have scale more gently so
 * a handful of minor findings don't crater a category.
 */
function penaltyFor(severity: GapSeverity): number {
  switch (severity) {
    case 'critical': return 30;
    case 'recommended': return 10;
    case 'nice_to_have': return 3;
  }
}

/** Turn a findings list into a 0-100 category score with signals. */
function scoreCategory(
  name: string,
  findings: Array<{ severity: GapSeverity; title?: string }>,
  presentWhenEmpty: string,
  weight: number,
): CategoryScore {
  const total = findings.reduce((sum, f) => sum + penaltyFor(f.severity), 0);
  const score = Math.max(0, Math.min(100, 100 - total));

  const present: string[] = [];
  const missing: string[] = [];

  if (findings.length === 0) {
    present.push(presentWhenEmpty);
  } else {
    const crit = findings.filter(f => f.severity === 'critical').length;
    const rec = findings.filter(f => f.severity === 'recommended').length;
    const nice = findings.filter(f => f.severity === 'nice_to_have').length;
    if (crit > 0) missing.push(`${crit} critical finding${crit === 1 ? '' : 's'} in ${name}`);
    if (rec > 0) missing.push(`${rec} recommended finding${rec === 1 ? '' : 's'} in ${name}`);
    if (nice > 0) missing.push(`${nice} nice-to-have finding${nice === 1 ? '' : 's'} in ${name}`);
  }

  return { score, weight, signalsPresent: present, signalsMissing: missing };
}

export interface SecurityScoringInput {
  secrets: SecretFinding[];
  injection: InjectionFinding[];
  ruleConflicts: RuleConflict[];
  cveFindings: CveFinding[];
  platformFindings: PlatformAdvisorFinding[];
  /**
   * If all platform advisors are skipped or errored, platformCompliance can't
   * be meaningfully scored — we treat it as N/A and redistribute its weight
   * across the other categories rather than falsely awarding 100.
   */
  platformStatus: PlatformAdvisorStatus[];
}

export function scoreSecurity(input: SecurityScoringInput): SecurityScoringResult {
  const platformCovered = input.platformStatus.some(s => s.status === 'ok' && s.projectsScanned > 0);

  const categories: Record<SecurityCategoryId, CategoryScore> = {
    secretSafety: scoreCategory('Secret Safety', input.secrets, 'No leaked secrets found', WEIGHTS.secretSafety),
    injectionResistance: scoreCategory(
      'Injection Resistance',
      input.injection,
      'No prompt-injection surfaces in hooks/skills',
      WEIGHTS.injectionResistance,
    ),
    ruleIntegrity: scoreCategory(
      'Rule Integrity',
      input.ruleConflicts,
      'CLAUDE.md rules match actual hook/skill behavior',
      WEIGHTS.ruleIntegrity,
    ),
    dependencySafety: scoreCategory(
      'Dependency Safety',
      input.cveFindings,
      'No known CVEs in declared dependencies',
      WEIGHTS.dependencySafety,
    ),
    platformCompliance: platformCovered
      ? scoreCategory(
          'Platform Compliance',
          input.platformFindings,
          'External advisors (Supabase, GitHub, npm, Vercel) returned clean',
          WEIGHTS.platformCompliance,
        )
      : {
          score: 0,
          weight: 0, // drop from aggregate — we didn't actually measure it
          signalsPresent: [],
          signalsMissing: [
            'Platform advisors not reachable — score excludes this category. Check ~/.dearuser/config.json and 1Password tokens to enable.',
          ],
        },
  };

  // When platform coverage is missing, redistribute its 20% weight across the
  // four categories we did measure. Otherwise users see a weirdly-low number
  // that doesn't reflect the security they actually have visibility into.
  if (!platformCovered) {
    const redistributable = WEIGHTS.platformCompliance;
    const measuredCount = 4;
    const bonus = redistributable / measuredCount;
    categories.secretSafety.weight += bonus;
    categories.injectionResistance.weight += bonus;
    categories.ruleIntegrity.weight += bonus;
    categories.dependencySafety.weight += bonus;
  }

  const securityScore = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score * cat.weight, 0),
  );

  return { categories, securityScore };
}
