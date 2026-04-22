// grade.ts — maps raw 0-100 scores to A/B/C/D/F letter grades + percentile
// context. Original thresholds were tuned against the v1 50-file corpus
// (research/calibration/2026-04-22-claude-md-corpus). The v2 2,895-file
// corpus (research/calibration/2026-04-22-claude-md-corpus-v2) shows a
// wider distribution (blended p50=18, p90=35, p99=47, max=60) — a proper
// retuning against v2 percentiles is a post-launch polish task.
//
// Why: the raw 0-100 number is honest but demoralising at the current state
// of the ecosystem — median public CLAUDE.md scored 18 (blended) across
// 2,895 files. Showing "32/100" alone crushes even strong setups. The
// grade layer contextualises the score:
//   • Keeps the raw number for power users.
//   • Adds an A-F letter anchored to real corpus percentiles so a 32 lands
//     as "A (top 2%)" instead of "32%".
//
// The thresholds are recomputed from data/scores.jsonl percentiles; update
// this file if the corpus is refreshed and the distribution shifts.

export type LetterGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScoreGrade {
  /** Raw 0-100 score, unchanged. Power-user readers still see this. */
  score: number;
  /** Letter grade A-F. */
  letter: LetterGrade;
  /** Approximate corpus percentile — "top N%" when in the top half, "bottom N%" otherwise. */
  percentile: number;
  /** Short label like "top 2%" / "better than 75% of public CLAUDE.md files we've seen". */
  percentileLabel: string;
  /** One-sentence explanation for the UI. */
  summary: string;
}

/**
 * Thresholds tuned to the v1 50-file public CLAUDE.md corpus + pure-subscore.
 * v2 (2,895 files) has a wider distribution; retuning pending as post-launch polish.
 *
 * Corpus reality (April 2026): no public CLAUDE.md scored above 32 (blended)
 * or 42 (pure). Percentiles:
 *   blended — p10=7, p25=16, p50=19, p75=24, p90=26, max=32
 *   pure    — p10=11, p25=18, p50=24, p75=31, p90=36, max=42
 *
 * Grade mapping balances two constraints:
 *  1. At current corpus quality, A/B should feel earned — top 10-20% of
 *     public files, not half. C is "median public repo". D/F is the long
 *     tail of stub/redirect files.
 *  2. The mapping has to age gracefully — a user who implements Dear User's
 *     recommendations should be able to climb. So A extends up to 100 even
 *     though no corpus file touches it. That's correct: our report's whole
 *     purpose is helping users push past the corpus ceiling.
 *
 * Thresholds chosen by percentile lookup, rounded to user-legible numbers:
 *   blended: F <10, D 10-17, C 18-23, B 24-29, A >=30 (top 2% corpus, ~p98).
 *
 * The pure subscore has a different scale so we apply a slightly looser
 * mapping. Both use the same letter shape — a user seeing "B (top 10%)"
 * on either score understands it the same way.
 */
const BLENDED_THRESHOLDS: Array<{ min: number; letter: LetterGrade; percentile: number }> = [
  { min: 30, letter: 'A', percentile: 98 },
  { min: 24, letter: 'B', percentile: 85 },
  { min: 18, letter: 'C', percentile: 55 },
  { min: 10, letter: 'D', percentile: 20 },
  { min: 0, letter: 'F', percentile: 5 },
];

const PURE_THRESHOLDS: Array<{ min: number; letter: LetterGrade; percentile: number }> = [
  { min: 40, letter: 'A', percentile: 97 },
  { min: 32, letter: 'B', percentile: 82 },
  { min: 24, letter: 'C', percentile: 55 },
  { min: 15, letter: 'D', percentile: 22 },
  { min: 0, letter: 'F', percentile: 5 },
];

function pickGrade(
  score: number,
  thresholds: Array<{ min: number; letter: LetterGrade; percentile: number }>,
): { letter: LetterGrade; percentile: number } {
  for (const t of thresholds) {
    if (score >= t.min) return { letter: t.letter, percentile: t.percentile };
  }
  return { letter: 'F', percentile: 1 };
}

function percentileLabel(percentile: number): string {
  if (percentile >= 95) return `top ${100 - percentile}%`;
  if (percentile >= 75) return `top ${100 - percentile}%`;
  if (percentile >= 25) return `better than ${percentile}% of public CLAUDE.md files we benchmarked`;
  if (percentile > 0) return `bottom ${percentile}%`;
  return 'bottom sliver';
}

function buildSummary(letter: LetterGrade, label: string): string {
  const letterText: Record<LetterGrade, string> = {
    A: 'Top-tier',
    B: 'Strong',
    C: 'Average for public repos',
    D: 'Thin — several core sections missing',
    F: 'Stub — almost no agent guidance',
  };
  return `${letterText[letter]} — ${label}.`;
}

/**
 * Grade a blended (7-category weighted) collaboration score.
 * Use this for the main report number.
 */
export function gradeBlendedScore(score: number): ScoreGrade {
  const { letter, percentile } = pickGrade(score, BLENDED_THRESHOLDS);
  const label = percentileLabel(percentile);
  return {
    score,
    letter,
    percentile,
    percentileLabel: label,
    summary: buildSummary(letter, label),
  };
}

/**
 * Grade a CLAUDE.md-only (pure, 4-category) subscore.
 * Use this when surfacing the fresh-install-fair subscore alongside the
 * blended score (see R1 in the calibration study).
 */
export function gradePureSubScore(score: number): ScoreGrade {
  const { letter, percentile } = pickGrade(score, PURE_THRESHOLDS);
  const label = percentileLabel(percentile);
  return {
    score,
    letter,
    percentile,
    percentileLabel: label,
    summary: buildSummary(letter, label),
  };
}
