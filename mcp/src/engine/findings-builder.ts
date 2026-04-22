// Findings builder — composes the "What I saw" narrative layer.
//
// Inputs:
//   - frictionPatterns — existing internal data surfaced as pattern/risk findings
//   - strengths — wins detected by strengths-detector
//
// Output:
//   - Finding[] ordered as: wins (max 2 at top), risks, patterns. Capped at 6.
//
// This file is the only place that decides the pattern-vs-risk split. Keep
// the rule concentrated here so the voice stays consistent.

import type { Finding, FrictionPattern } from '../types.js';

interface BuildFindingsInput {
  frictionPatterns: FrictionPattern[];
  strengths: Finding[];
}

/**
 * Decide whether a FrictionPattern surfaces as a neutral 'pattern' or an
 * active 'risk'. Top-ranked friction and themes that directly break work
 * are risks — everything else is a pattern.
 */
function frictionToTag(fp: FrictionPattern): 'pattern' | 'risk' {
  if (fp.rank === 1) return 'risk';
  if (fp.theme === 'quality' || fp.theme === 'scope_creep') return 'risk';
  return 'pattern';
}

/**
 * Compose the body string from a FrictionPattern. The user's own words
 * (evidence[0]) are the whole point — they make the finding recognisable.
 * We trim evidence to keep the body readable.
 */
function frictionToBody(fp: FrictionPattern): string {
  const desc = fp.description.replace(/\s+/g, ' ').trim();
  const quote = fp.evidence[0]?.replace(/\s+/g, ' ').trim();
  if (!quote) return desc;
  const trimmedQuote = quote.length > 140 ? quote.slice(0, 137) + '…' : quote;
  return `${desc} — your words: "${trimmedQuote}"`;
}

export function buildFindings({ frictionPatterns, strengths }: BuildFindingsInput): Finding[] {
  // FrictionPattern[] → Finding[] with pattern/risk split.
  const frictionFindings: Finding[] = frictionPatterns.map((fp) => ({
    tag: frictionToTag(fp),
    title: fp.title,
    body: frictionToBody(fp),
  }));

  const risks = frictionFindings.filter((f) => f.tag === 'risk');
  const patterns = frictionFindings.filter((f) => f.tag === 'pattern');

  // Order: up to 2 wins first, then risks, then patterns. Cap total at 6.
  // This way a report that's heavy on friction still leads with earned wins
  // — the reader sees "here's what's working" before "here's what's not".
  const topWins = strengths.slice(0, 2);
  const remainingWins = strengths.slice(2);
  const ordered: Finding[] = [
    ...topWins,
    ...risks,
    ...remainingWins,
    ...patterns,
  ];

  return ordered.slice(0, 6);
}
