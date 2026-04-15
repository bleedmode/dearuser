// rule-conflict-detector — find cases where a rule in CLAUDE.md is
// contradicted by a hook, skill, or scheduled task. Example:
//
//   CLAUDE.md:  "NEVER run rm -rf on data/"
//   Hook:       { matcher: "Bash", command: "rm -rf /tmp/cache" }
//
// These conflicts are the most damaging kind because the agent is being
// explicitly told "never X" yet the infrastructure Does X anyway. The user's
// mental model and reality diverge — the fail mode is "I thought we agreed".

import type { AuditArtifact, GapSeverity, ParsedRule } from '../types.js';

export type ConflictCategory =
  | 'prohibition_violated'     // CLAUDE.md says never X, hook/skill does X
  | 'required_check_missing'   // CLAUDE.md says always X, ship/build lacks X
  | 'autonomy_mismatch';       // CLAUDE.md says ask_first, hook silently does

export interface RuleConflict {
  id: string;
  category: ConflictCategory;
  severity: GapSeverity;
  title: string;
  claudeMdRule: string;            // the rule text
  claudeMdSource: string;          // file path
  conflictingArtifact: string;     // artifact id
  conflictingPath: string;
  excerpt: string;                 // the command/prompt that violates
  recommendation: string;
  why: string;
}

// ============================================================================
// Prohibition → action patterns
//
// For each common prohibition phrasing, define regex patterns that detect
// violations in artifact prompts (bash commands, etc).
// ============================================================================

interface ProhibitionPattern {
  /** Keywords in a rule text signalling this prohibition. */
  ruleKeywords: RegExp;
  /** Keywords in an artifact prompt signalling the prohibited action. */
  violationPattern: RegExp;
  label: string;
}

const PROHIBITION_PATTERNS: ProhibitionPattern[] = [
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:run\s+)?rm\b|\bnever\s+delete|aldrig\s+slet/i,
    violationPattern: /\brm\s+-rf?\b(?!\s+--?help)/,
    label: 'prohibits rm/delete',
  },
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:force[- ]?push|push --force|--force)/i,
    violationPattern: /\bgit\s+push\s+.*(?:--force|--force-with-lease|-f\b)/,
    label: 'prohibits force-push',
  },
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:run|use|invoke)?\s*sudo|aldrig\s+sudo/i,
    violationPattern: /\bsudo\b/,
    label: 'prohibits sudo',
  },
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:skip|bypass)\s+(?:hooks?|tests?|ci)|aldrig\s+(?:skip|spring over)\s+(?:hooks?|tests?)/i,
    violationPattern: /--no-verify\b|SKIP_(?:CHECK|HOOKS|TESTS)=1|--skip-hook/,
    label: 'prohibits skipping hooks/tests',
  },
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:commit\s+)?secrets?|aldrig\s+commit(?:ér|er)\s+(?:secrets?|hemmeligheder)/i,
    violationPattern: /\b(?:export|ENV|ENVIRONMENT).*(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*["'][^"']{10,}["']/,
    label: 'prohibits committing secrets',
  },
  {
    ruleKeywords: /\b(never|aldrig|do not|don['’]t)\s+(?:delete|drop|truncate)\s+(?:tables?|databases?|prod)|aldrig\s+drop\s+(?:table|base)/i,
    violationPattern: /\b(?:DROP\s+(?:TABLE|DATABASE)|TRUNCATE)\b/i,
    label: 'prohibits destructive SQL',
  },
];

// ============================================================================
// Required-action patterns — CLAUDE.md says always X
// ============================================================================

interface RequirementPattern {
  ruleKeywords: RegExp;
  /** If this pattern is absent from a specific artifact type, flag it. */
  requiredIn: {
    artifactType: AuditArtifact['type'];
    requiredPattern: RegExp;
    nameHint?: RegExp; // only check artifacts whose name matches
  };
  label: string;
}

const REQUIREMENT_PATTERNS: RequirementPattern[] = [
  {
    ruleKeywords: /\b(always|altid)\s+run\s+tests?\s+before\s+(?:shipping|push|merging)|tests?\s+must\s+pass/i,
    requiredIn: {
      artifactType: 'skill',
      requiredPattern: /\b(?:npm\s+test|yarn\s+test|pytest|go\s+test|cargo\s+test|test\s+(?:runs?|passes?))/i,
      nameHint: /ship|deploy|release|merge/i,
    },
    label: 'ship skill missing test step',
  },
  {
    ruleKeywords: /\b(always|altid)\s+(?:run\s+)?build|build\s+must\s+pass/i,
    requiredIn: {
      artifactType: 'skill',
      requiredPattern: /\b(?:npm\s+(?:run\s+)?build|yarn\s+build|cargo\s+build|tsc\b|go\s+build)/i,
      nameHint: /ship|deploy|release/i,
    },
    label: 'ship skill missing build step',
  },
];

// ============================================================================
// Detection
// ============================================================================

function findingId(parts: string[]): string {
  return `conflict:${parts.filter(Boolean).join(':').toLowerCase().replace(/[^\w:]+/g, '-')}`;
}

function detectProhibitionViolations(
  rules: ParsedRule[],
  artifacts: AuditArtifact[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const prohibitions = rules.filter(r => r.type === 'prohibition');

  for (const rule of prohibitions) {
    for (const pattern of PROHIBITION_PATTERNS) {
      if (!pattern.ruleKeywords.test(rule.text)) continue;

      // This prohibition applies — look for violations
      for (const artifact of artifacts) {
        if (!artifact.prompt) continue;
        if (!pattern.violationPattern.test(artifact.prompt)) continue;

        // Found a match — but check context for whitelisted use (e.g., rm -rf /tmp/cache is often fine)
        // For v1, we surface and let the user judge. Be conservative: only critical for the worst cases.
        const isCritical = /\b(delete|drop|truncate|force[- ]push|sudo)\b/i.test(pattern.label);

        const excerptMatch = artifact.prompt.match(pattern.violationPattern);
        const excerpt = excerptMatch
          ? excerptMatch[0].slice(0, 120)
          : `matches ${pattern.label}`;

        conflicts.push({
          id: findingId(['prohibition_violated', rule.text.slice(0, 30), artifact.name]),
          category: 'prohibition_violated',
          severity: isCritical ? 'critical' : 'recommended',
          title: `Hook/skill "${artifact.name}" may violate CLAUDE.md: "${rule.text.slice(0, 80)}"`,
          claudeMdRule: rule.text,
          claudeMdSource: rule.source,
          conflictingArtifact: artifact.id,
          conflictingPath: artifact.path,
          excerpt,
          recommendation: `Review whether the command in ${artifact.name} actually violates the rule, or is a legitimate exception (e.g., rm on /tmp is usually safe). If it\'s a real conflict: either remove the command, or narrow the rule to reflect when the exception applies.`,
          why: 'When CLAUDE.md says "never X" but infrastructure Does X, the agent and user disagree about reality. The agent thinks you agreed; you don\'t realize the action is happening. Trust breaks silently.',
        });
      }
    }
  }
  return conflicts;
}

function detectMissingRequirements(
  rules: ParsedRule[],
  artifacts: AuditArtifact[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];

  for (const rule of rules) {
    for (const pattern of REQUIREMENT_PATTERNS) {
      if (!pattern.ruleKeywords.test(rule.text)) continue;

      // Check every artifact of the required type
      for (const artifact of artifacts) {
        if (artifact.type !== pattern.requiredIn.artifactType) continue;
        if (pattern.requiredIn.nameHint && !pattern.requiredIn.nameHint.test(artifact.name)) continue;
        if (!artifact.prompt) continue;

        // If the required pattern is PRESENT, we're good
        if (pattern.requiredIn.requiredPattern.test(artifact.prompt)) continue;

        conflicts.push({
          id: findingId(['required_check_missing', pattern.label, artifact.name]),
          category: 'required_check_missing',
          severity: 'recommended',
          title: `${artifact.name} does not include the step CLAUDE.md requires: ${pattern.label}`,
          claudeMdRule: rule.text,
          claudeMdSource: rule.source,
          conflictingArtifact: artifact.id,
          conflictingPath: artifact.path,
          excerpt: `${artifact.name} prompt does not mention the required command pattern`,
          recommendation: `Add the step to ${artifact.name} so the rule is actually enforced. A rule without an enforcement mechanism is aspirational.`,
          why: 'Rules in CLAUDE.md without supporting infrastructure are frequently violated. You wrote "always run tests before shipping" but your /ship skill just commits and pushes.',
        });
      }
    }
  }
  return conflicts;
}

export function detectRuleConflicts(
  rules: ParsedRule[],
  artifacts: AuditArtifact[],
): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  conflicts.push(...detectProhibitionViolations(rules, artifacts));
  conflicts.push(...detectMissingRequirements(rules, artifacts));

  // Dedupe + sort by severity
  const seen = new Set<string>();
  const unique: RuleConflict[] = [];
  for (const c of conflicts) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    unique.push(c);
  }
  const order: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  unique.sort((a, b) => order[a.severity] - order[b.severity]);
  return unique;
}
