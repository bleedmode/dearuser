// context-file-health — lightweight summary of CLAUDE.md/AGENTS.md issues
// surfaced during onboarding. The full scan/lint pipeline catches everything;
// this helper is just a triage lens for three categories a new user can act on
// immediately: bloat, LLM-smell, staleness.
//
// Category membership (reusing existing lint check IDs):
//   bloat     — file size / section layout issues
//   llmSmell  — typical AI-fluff patterns (padding, generic phrasing, weak verbs)
//   staleness — references rotted over time (dead commands, stale tools, no date)

import type { LintCheckId, LintFinding } from '../types.js';

export type ContextHealthCategory = 'bloat' | 'llmSmell' | 'staleness';

export interface ContextFileHealth {
  /** Total lint findings in the three categories below. */
  total: number;
  /** Findings grouped into user-facing categories. */
  byCategory: Record<ContextHealthCategory, number>;
  /** True if any category has ≥1 finding — used to gate teaching screens. */
  hasSignal: boolean;
  /** Up to 3 most impactful example findings (critical > recommended > nice). */
  topExamples: Array<{ category: ContextHealthCategory; check: LintCheckId; title: string }>;
}

const BLOAT_CHECKS = new Set<LintCheckId>([
  'file_too_long',
  'long_section_no_headers',
  'empty_section',
  'section_balance',
  'over_specified',
]);

const SMELL_CHECKS = new Set<LintCheckId>([
  'generic_filler',
  'compressible_padding',
  'weak_imperative',
  'ambiguous_pronoun',
  'mental_note',
]);

const STALENESS_CHECKS = new Set<LintCheckId>([
  'dead_command_ref',
  'stale_tool_ref',
  'missing_update_date',
  'broken_file_ref',
  'broken_markdown_link',
]);

function categorise(check: LintCheckId): ContextHealthCategory | null {
  if (BLOAT_CHECKS.has(check)) return 'bloat';
  if (SMELL_CHECKS.has(check)) return 'llmSmell';
  if (STALENESS_CHECKS.has(check)) return 'staleness';
  return null;
}

export function summariseContextHealth(findings: LintFinding[]): ContextFileHealth {
  const byCategory: Record<ContextHealthCategory, number> = {
    bloat: 0,
    llmSmell: 0,
    staleness: 0,
  };
  const categorised: Array<{ f: LintFinding; category: ContextHealthCategory }> = [];
  for (const f of findings) {
    const category = categorise(f.check);
    if (!category) continue;
    byCategory[category] += 1;
    categorised.push({ f, category });
  }
  const total = byCategory.bloat + byCategory.llmSmell + byCategory.staleness;

  // Rank by severity, then keep one example per category for balance.
  const severityOrder = { critical: 0, recommended: 1, nice_to_have: 2 } as const;
  categorised.sort((a, b) => severityOrder[a.f.severity] - severityOrder[b.f.severity]);
  const seenCategories = new Set<ContextHealthCategory>();
  const topExamples: ContextFileHealth['topExamples'] = [];
  for (const { f, category } of categorised) {
    if (seenCategories.has(category)) continue;
    seenCategories.add(category);
    topExamples.push({ category, check: f.check, title: f.title });
    if (topExamples.length >= 3) break;
  }

  return {
    total,
    byCategory,
    hasSignal: total > 0,
    topExamples,
  };
}
