// ceiling-scorer — projects the collaboration score a user would reach if
// they implemented every current recommendation.
//
// Why this exists:
//   A user who follows the whole report should hit a knowable number, not a
//   mystery. Without a ceiling, recommendations feel disconnected from the
//   score — "I did everything, why am I still at 82?".
//
// How it works:
//   We re-run the category scoring optimistically: every signal currently in
//   signalsMissing is assumed to become signalsPresent after the user applies
//   the recommendations that target it. Categories with structural caps
//   (systemMaturity tops out at 85 even with 15+ artifacts) surface those
//   caps explicitly so the user knows what's unreachable and why.
//
// The output is a projection, not a promise: not every missing signal has a
// one-to-one rec, and some behavioral recs (like "write longer prompts") only
// work if the user actually changes behavior over several sessions.

import type { CategoryScore, ParseResult, ScanResult } from '../types.js';
import type { SessionAnalysis } from './session-analyzer.js';

type CategoryId = 'roleClarity' | 'communication' | 'autonomyBalance' | 'qualityStandards' | 'memoryHealth' | 'systemMaturity' | 'coverage';

const WEIGHTS: Record<CategoryId, number> = {
  roleClarity: 0.15,
  communication: 0.10,
  autonomyBalance: 0.20,
  qualityStandards: 0.15,
  memoryHealth: 0.15,
  systemMaturity: 0.15,
  coverage: 0.10,
};

/**
 * Hard caps that can't be lifted just by adding signals. Kept as a lookup so
 * the ceiling explanation can surface them when structural limits apply.
 * Currently empty — every category can reach 100 with the right signals. If
 * a structural cap is added to a category in the future, register it here so
 * the ceiling UI stays honest (a visible cap < 100 on a 0–100 scale is the
 * kind of inconsistency users notice and lose trust over).
 */
const CATEGORY_CAPS: Partial<Record<CategoryId, { cap: number; reason: string }>> = {};

export interface CategoryCeiling {
  /** Current score for this category. */
  current: number;
  /** Score it would reach if all current missing signals became present. */
  ceiling: number;
  /** Delta in points (may be negative if current already exceeds simple missing-→-present projection — rare). */
  delta: number;
  /** Hard cap note if this category has one. */
  cap?: { cap: number; reason: string };
}

export interface CeilingProjection {
  /** Current score, repeated so callers don't need to stitch. */
  currentScore: number;
  /** Projected score if all recommendations are implemented. */
  ceilingScore: number;
  /** Delta between current and ceiling (0 means recommendations don't raise the score). */
  delta: number;
  /** Per-category breakdown. */
  byCategory: Record<CategoryId, CategoryCeiling>;
  /** Human-readable explanations of structural caps the user can't beat. */
  unreachable: string[];
  /**
   * Short plain-language summary for the report header. Covers the common cases:
   * already near ceiling, ceiling is 100, ceiling reflects hard caps.
   */
  summary: string;
}

/**
 * Ratio-style categories compute score as `present / (present + missing) * 100`.
 * Moving every missing → present on these is a clean recompute: the new score
 * is `(present + missing) / (present + missing) * 100 = 100`. Hence these
 * ceiling at 100 when every missing signal has a rec.
 */
const RATIO_CATEGORIES: Set<CategoryId> = new Set([
  'roleClarity',
  'communication',
  'qualityStandards',
  'memoryHealth',
  'coverage',
]);

/** Project ceiling for a single ratio-based category. */
function projectRatioCategory(cat: CategoryScore): number {
  const total = cat.signalsPresent.length + cat.signalsMissing.length;
  if (total === 0) return cat.score;
  return 100;
}

/**
 * Autonomy is formula-driven, not signal-count-driven. Worst-case additive
 * bonuses implemented in scorer.scoreAutonomyBalance sum to: base 30 +
 * all-tiers 25 + healthy-prohibition 20 + specific-rules 5 = 80. With
 * intentional autonomy that's 30 + 25 (do+ask split) + 10 (prohibitions ≥ 3)
 * + 20 (prohibition ratio) + 5 = 90. Session-correction penalties subtract
 * up to 15 more.
 *
 * We take a pragmatic approach: ceiling = min(100, current + recoverable penalties + missing-signal bonus).
 * If the user currently has penalties from session friction, fixing them recovers those points.
 * If they're missing tiers, adding them recovers ~25.
 */
function projectAutonomyCategory(cat: CategoryScore, intentionalAutonomy: boolean): number {
  // Count how many points are "recoverable" by looking at the missing signals.
  // Each structural missing signal represents a category of bonus the scorer
  // didn't award. We attribute a pragmatic point value per miss; more accurate
  // than a fixed ceiling but simpler than a full re-scoring.
  let recoverable = 0;
  for (const miss of cat.signalsMissing) {
    if (/correction signals/i.test(miss)) recoverable += intentionalAutonomy ? 5 : 15;
    else if (/ask-first/i.test(miss)) recoverable += 10;
    else if (/suggest-only/i.test(miss)) recoverable += 10;
    else if (/autonomous action rules/i.test(miss)) recoverable += 10;
    else if (/prohibitions/i.test(miss) || /guardrails/i.test(miss)) recoverable += 10;
    else if (/vague/i.test(miss)) recoverable += 10;
    else recoverable += 5;
  }
  return Math.min(100, cat.score + recoverable);
}

/**
 * System maturity is a stepped curve keyed on total artifact count, with a
 * hard cap at 85. The ceiling for any user is 85 unless a scorer change lifts
 * the cap — we reflect that cap explicitly in the projection.
 *
 * We also subtract the session-based /clear penalty recovery if it's visible
 * in the missing signals.
 */
/**
 * System maturity is a stepped curve keyed on total artifact count (with a
 * breadth gate — needs at least one of each tier to hit 100). Ceiling is the
 * current score plus recovered penalties and an estimate of what's reachable
 * by adding the missing tier / fixing session friction.
 */
function projectSystemMaturityCategory(cat: CategoryScore): number {
  let projected = cat.score;
  for (const miss of cat.signalsMissing) {
    if (/\/clear/i.test(miss)) projected += 10;
    else if (/\bhooks\b/i.test(miss)) projected += 8;
    else if (/\bskills\b/i.test(miss)) projected += 8;
    else if (/scheduled tasks/i.test(miss)) projected += 8;
    else if (/MCP servers/i.test(miss)) projected += 8;
    else if (/custom commands/i.test(miss)) projected += 10;
    else projected += 3;
  }
  return Math.min(100, projected);
}

export function computeCeiling(
  parsed: ParseResult,
  scan: ScanResult,
  session: SessionAnalysis | undefined,
  categories: Record<CategoryId, CategoryScore>,
  intentionalAutonomy: boolean,
): CeilingProjection {
  const currentScore = Math.round(
    (Object.entries(categories) as Array<[CategoryId, CategoryScore]>)
      .reduce((sum, [id, cat]) => sum + cat.score * WEIGHTS[id], 0),
  );

  const byCategory: Record<CategoryId, CategoryCeiling> = {} as Record<CategoryId, CategoryCeiling>;
  const unreachable: string[] = [];
  let ceilingWeightedSum = 0;

  for (const [id, cat] of Object.entries(categories) as Array<[CategoryId, CategoryScore]>) {
    let ceiling: number;
    if (RATIO_CATEGORIES.has(id)) {
      ceiling = projectRatioCategory(cat);
    } else if (id === 'autonomyBalance') {
      ceiling = projectAutonomyCategory(cat, intentionalAutonomy);
    } else if (id === 'systemMaturity') {
      ceiling = projectSystemMaturityCategory(cat);
    } else {
      ceiling = cat.score;
    }

    const cap = CATEGORY_CAPS[id];
    if (cap) {
      ceiling = Math.min(ceiling, cap.cap);
      if (ceiling < 100) unreachable.push(cap.reason);
    }

    ceiling = Math.round(ceiling);
    byCategory[id] = {
      current: cat.score,
      ceiling,
      delta: ceiling - cat.score,
      cap,
    };
    ceilingWeightedSum += ceiling * WEIGHTS[id];
  }

  const ceilingScore = Math.round(ceilingWeightedSum);
  const delta = ceilingScore - currentScore;

  const summary = (() => {
    if (delta === 0) return `You're already at the reachable ceiling for your current setup. Any higher needs new recommendations — re-run analyze after major changes.`;
    if (ceilingScore === 100) return `Implementing everything in this report lifts your score to 100. No structural blockers.`;
    if (unreachable.length > 0) {
      return `Implementing everything in this report lifts your score from ${currentScore} to ${ceilingScore}. The gap from ${ceilingScore} to 100 is structural — see "Why 100 is unreachable" below.`;
    }
    return `Implementing everything in this report lifts your score from ${currentScore} to ${ceilingScore} (+${delta}).`;
  })();

  return {
    currentScore,
    ceilingScore,
    delta,
    byCategory,
    unreachable,
    summary,
  };
}
