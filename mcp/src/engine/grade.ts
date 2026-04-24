// grade.ts — maps raw 0-100 scores to A/B/C/D/F letter grades + percentile
// context. Thresholds tuned against the v2 2,895-file corpus
// (research/calibration/2026-04-22-claude-md-corpus-v2).
//
// Why: the raw 0-100 number is honest but demoralising at the current state
// of the ecosystem — median public CLAUDE.md scored 18 (blended) across
// 2,895 files. Showing "32/100" alone crushes even strong setups. The
// grade layer contextualises the score:
//   • Keeps the raw number for power users.
//   • Adds an A-F letter anchored to real corpus percentiles.
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
 * Thresholds tuned to the v2 2,895-file public CLAUDE.md corpus.
 *
 * Corpus percentiles (April 2026):
 *   blended — p10=7, p25=9, p50=18, p75=27, p90=35, p95=39, p99=47, max=60
 *   pure    — p10=11, p25=13, p50=22, p75=33, p90=44, p95=49, p99=62, max=78
 *
 * Grade mapping balances two constraints:
 *  1. At current corpus quality, A/B should feel earned — top 5-25% of
 *     public files. C is median-ish public repo. D/F is the long tail.
 *  2. The mapping has to age gracefully — a user who implements Dear User's
 *     recommendations should be able to climb. So A extends up to 100 even
 *     though few corpus files touch the top.
 *
 * Thresholds anchored to percentile boundaries, rounded for legibility:
 *   blended: F <10 (bottom 25%), D 10-17, C 18-27 (median), B 28-39,
 *            A >=40 (top 4%, above p95).
 *   pure:    F <13, D 13-21, C 22-33 (median), B 34-49, A >=50 (top 4%).
 */
const BLENDED_THRESHOLDS: Array<{ min: number; letter: LetterGrade; percentile: number }> = [
  { min: 40, letter: 'A', percentile: 96 },
  { min: 28, letter: 'B', percentile: 78 },
  { min: 18, letter: 'C', percentile: 50 },
  { min: 10, letter: 'D', percentile: 25 },
  { min: 0, letter: 'F', percentile: 10 },
];

const PURE_THRESHOLDS: Array<{ min: number; letter: LetterGrade; percentile: number }> = [
  { min: 50, letter: 'A', percentile: 96 },
  { min: 34, letter: 'B', percentile: 77 },
  { min: 22, letter: 'C', percentile: 50 },
  { min: 13, letter: 'D', percentile: 25 },
  { min: 0, letter: 'F', percentile: 10 },
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
