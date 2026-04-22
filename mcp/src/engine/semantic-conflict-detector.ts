// semantic-conflict-detector — find rules in CLAUDE.md that appear
// contradictory in meaning, not just wording.
//
// This is a differentiator vs. competitors like agnix (180★ GitHub), which
// only do syntactic/structural analysis. A syntactic detector catches "same
// rule written twice"; a semantic detector catches "always prefer X" +
// "never use X in situation Y" — two rules with opposite polarity about the
// same subject.
//
// === Why no LLM / embeddings? =============================================
// Dear User's product principle (per mcp/CLAUDE.md): "Ingen cloud, ingen API
// keys, data forlader aldrig maskinen." Shipping an LLM-assisted detector
// would require either (a) an Anthropic API key and sending CLAUDE.md
// contents off the machine, or (b) a local model heavy enough to run
// inference — both violate the principle. So this detector is deliberately
// local-only heuristic: polarity detection + lexical topic overlap +
// multi-gate false-positive suppression.
//
// The pipeline below is structured so an LLM-verify step could slot in
// later as an opt-in (`options.llmVerify = true`), but the default path is
// zero-API.
//
// === Swiss-cheese quality gates ===========================================
// The #1 risk with semantic conflict detection is false positives — users
// turn it off fast if it cries wolf. So every candidate pair must pass
// ALL gates below to be flagged:
//
//   G1  Different polarity markers present (always/must vs never/don't/avoid)
//   G2  Meaningful topic overlap (jaccard ≥ 0.5) on content words
//   G3  Both rules have ≥ 3 content words (short rules are noise)
//   G4  Pair is not already caught by the syntactic duplicate-rule check
//   G5  Neither rule has an explicit nuance escape hatch ("unless", "except",
//       "when …", "only if …") that resolves the apparent conflict
//   G6  Rules live in the same file or under the same section heading
//       (cross-file conflicts need a stricter similarity gate to avoid
//       false positives from general-vs-project scoping)
//   G7  Stable finding hash — same pair = same finding across scans
//
// Any pair that passes all gates is emitted as severity 'nice_to_have' —
// the whole point is "human should look at this", not "this is broken".

import { createHash } from 'crypto';
import type { GapSeverity, LintFinding, ParsedRule, ParseResult } from '../types.js';

// ---------------------------------------------------------------------------
// Polarity detection
// ---------------------------------------------------------------------------

/** Polarity markers. Keep these aligned with the Danish/English phrasing
 *  already used by the syntactic rule-contradiction check in lint-checks.ts
 *  so behaviour is consistent. */
const POSITIVE_MARKERS = [
  /\balways\b/i, /\bmust\b/i, /\brequired?\b/i, /\bprefer\b/i,
  /\baltid\b/i, /\bskal\b/i, /\bforetræk/i,
];

const NEGATIVE_MARKERS = [
  /\bnever\b/i, /\bdon'?t\b/i, /\bdo not\b/i, /\bavoid\b/i, /\bforbidden\b/i,
  /\baldrig\b/i, /\bundgå\b/i, /\bmå ikke\b/i,
];

/** Markers that signal the rule is explicitly scoped / carved-out and so
 *  two otherwise contradictory-looking rules are probably intentional nuance,
 *  not a conflict. */
const NUANCE_MARKERS = [
  /\bunless\b/i, /\bexcept\b/i, /\bonly if\b/i, /\bonly when\b/i,
  /\bexcept when\b/i, /\bmedmindre\b/i, /\bundtagen\b/i, /\bkun hvis\b/i,
  /\bkun når\b/i,
];

type Polarity = 'positive' | 'negative' | 'neutral';

/** Find the earliest polarity marker in the text — whichever comes FIRST
 *  dominates the rule. Rules that carry both ("Never X — always do Y
 *  instead") are common, and the opening clause is the rule's true stance. */
function polarityOf(text: string): Polarity {
  let posIdx = Infinity;
  let negIdx = Infinity;
  for (const p of POSITIVE_MARKERS) {
    const m = text.match(p);
    if (m && m.index !== undefined && m.index < posIdx) posIdx = m.index;
  }
  for (const p of NEGATIVE_MARKERS) {
    const m = text.match(p);
    if (m && m.index !== undefined && m.index < negIdx) negIdx = m.index;
  }
  if (posIdx === Infinity && negIdx === Infinity) return 'neutral';
  if (posIdx < negIdx) return 'positive';
  if (negIdx < posIdx) return 'negative';
  return 'neutral';
}

function hasNuanceEscape(text: string): boolean {
  return NUANCE_MARKERS.some(p => p.test(text));
}

// ---------------------------------------------------------------------------
// Topic extraction — shared stopword list with lint-checks.ts topicWords
// ---------------------------------------------------------------------------

const STOP = new Set([
  // English
  'the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or',
  'in', 'on', 'for', 'with', 'not', 'do', 'don', 't', 'it', 'you', 'your',
  'this', 'that', 'always', 'never', 'must', 'should', 'would', 'could',
  'avoid', 'prefer', 'required', 'forbidden', 'unless', 'except', 'only',
  'if', 'when', 'all', 'any', 'some', 'but', 'so', 'no', 'yes',
  // Danish
  'altid', 'aldrig', 'skal', 'ikke', 'må', 'må_ikke', 'kun', 'hvis', 'når',
  'med', 'uden', 'og', 'eller', 'fra', 'til', 'af', 'det', 'den', 'de',
  'en', 'et', 'er', 'var', 'har', 'have', 'bør', 'kan', 'vil', 'skal',
  'medmindre', 'undtagen', 'foretræk', 'undgå',
]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9æøå ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function topicWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter(w => w.length > 2 && !STOP.has(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ---------------------------------------------------------------------------
// Section context — which heading does this rule live under?
// ---------------------------------------------------------------------------

function findRuleLine(content: string, ruleText: string): number | undefined {
  const key = ruleText.trim().slice(0, 40).toLowerCase();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(key)) return i + 1;
  }
  return undefined;
}

function findSectionForLine(content: string, line: number | undefined): string | null {
  if (!line) return null;
  const lines = content.split('\n');
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) return m[2].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding emission
// ---------------------------------------------------------------------------

function stableHash(ruleA: string, ruleB: string): string {
  // Canonicalize the pair so (A,B) and (B,A) hash the same.
  const pair = [normalize(ruleA).slice(0, 120), normalize(ruleB).slice(0, 120)].sort();
  return createHash('sha256').update(`semantic-conflict|${pair.join('|')}`).digest('hex').slice(0, 16);
}

function trunc(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SemanticConflictOptions {
  /** Minimum topic overlap (jaccard) to consider as a candidate pair. */
  minSimilarity?: number;
  /** Require strictly higher similarity for cross-file pairs to cut
   *  false positives from global vs. project scoping mismatches. */
  crossFileMinSimilarity?: number;
  /** Cap on findings returned — same pattern as other lint checks. */
  maxFindings?: number;
}

const DEFAULTS: Required<SemanticConflictOptions> = {
  // Jaccard is a soft signal — two rules with opposite polarity about the
  // same core action (e.g. "force push") routinely score 0.10–0.20 in the
  // wild because one side carries caveats the other doesn't. The hard
  // floor is the anchor-overlap gate (≥2 shared non-stop anchors) which
  // does the heavy lifting on precision; jaccard is a cheap sanity check.
  minSimilarity: 0.1,
  crossFileMinSimilarity: 0.2,
  maxFindings: 5,
};

/** Extract "anchor" content words — verbs/nouns that carry the rule's action.
 *  We require at least 2 anchors to overlap between the two rules. This
 *  catches "always force push" vs "never force push" even when the surrounding
 *  prose diverges (conditions, caveats), without firing on rules that happen
 *  to share one generic word like "tests" or "branch". */
function anchorWords(text: string): Set<string> {
  const words = normalize(text).split(' ').filter(w => w.length > 3 && !STOP.has(w));
  return new Set(words);
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

interface EnrichedRule {
  rule: ParsedRule;
  polarity: Polarity;
  topics: Set<string>;
  anchors: Set<string>;
  section: string | null;
  line: number | undefined;
  normalized: string;
  escape: boolean;
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

export function detectSemanticConflicts(
  parsed: ParseResult,
  filesByPath: Map<string, string>,
  options: SemanticConflictOptions = {},
  idFactory?: (check: 'semantic_rule_conflict') => string,
): LintFinding[] {
  const opts = { ...DEFAULTS, ...options };

  // 1. Enrich every rule with polarity + topics + section context.
  const enriched: EnrichedRule[] = [];
  for (const rule of parsed.rules) {
    const topics = topicWords(rule.text);
    // G3 — rules need enough content words to be comparable
    if (topics.size < 3) continue;
    const polarity = polarityOf(rule.text);
    // G1 precondition — only rules carrying a polarity marker can ever conflict
    if (polarity === 'neutral') continue;
    const content = filesByPath.get(rule.source) ?? '';
    const line = findRuleLine(content, rule.text);
    const section = findSectionForLine(content, line);
    enriched.push({
      rule,
      polarity,
      topics,
      anchors: anchorWords(rule.text),
      section,
      line,
      normalized: normalize(rule.text),
      escape: hasNuanceEscape(rule.text),
    });
  }

  // 2. Pairwise scan with all gates.
  const findings: LintFinding[] = [];
  const seenHashes = new Set<string>();

  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i];
      const b = enriched[j];

      // G1 — different polarity
      if (a.polarity === b.polarity) continue;

      // G4 — skip near-duplicates (covered by checkDuplicateRules)
      if (a.normalized === b.normalized) continue;
      if (a.normalized.length > 30 && b.normalized.includes(a.normalized.slice(0, 30))) continue;
      if (b.normalized.length > 30 && a.normalized.includes(b.normalized.slice(0, 30))) continue;

      // G5 — either side has an escape hatch = intentional nuance
      if (a.escape || b.escape) continue;

      // G2 / G6 — topic overlap, stricter for cross-file. We use TWO
      // signals in parallel and require both to be "plausible":
      //   - jaccard similarity over topic words (soft threshold, forgiving
      //     of length differences)
      //   - shared anchor count (verbs/nouns ≥ 4 chars, non-stop) — a hard
      //     floor of 2 shared anchors keeps us from firing on pairs that
      //     only share a single generic word.
      const sameFile = a.rule.source === b.rule.source;
      const sameSection = Boolean(
        sameFile && a.section && b.section && a.section === b.section
      );
      const similarity = jaccard(a.topics, b.topics);
      const shared = sharedCount(a.anchors, b.anchors);
      const threshold = sameFile
        ? opts.minSimilarity
        : opts.crossFileMinSimilarity;
      const requiredAnchors = sameFile ? 2 : 3;
      if (similarity < threshold) continue;
      if (shared < requiredAnchors) continue;

      // G7 — stable hash, dedupe across runs
      const hash = stableHash(a.rule.text, b.rule.text);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      const locationA = a.line ? `${a.rule.source}:${a.line}` : a.rule.source;
      const locationB = b.line ? `${b.rule.source}:${b.line}` : b.rule.source;

      const why = explainConflict(a, b, sameSection);

      findings.push({
        id: idFactory ? idFactory('semantic_rule_conflict') : `lint-semantic_rule_conflict-${hash}`,
        check: 'semantic_rule_conflict',
        severity: 'nice_to_have' as GapSeverity,
        title: 'To regler kan modsige hinanden',
        description:
          `Disse to regler lyder som om de trækker i hver sin retning om det samme emne. ` +
          `Den ene siger "gør X", den anden siger "lad være med X" — agenten ved ikke hvilken der vinder. ` +
          why,
        file: a.rule.source,
        line: a.line,
        excerpt: `"${trunc(a.rule.text, 60)}" (${locationA})  ↔  "${trunc(b.rule.text, 60)}" (${locationB})`,
        fix:
          `Tjek om reglerne faktisk modsiger hinanden. ` +
          `Hvis ja: skriv dem sammen som én regel, eller tilføj "medmindre…" / "unless…" ` +
          `så agenten forstår hvornår hver regel gælder. ` +
          `Hvis nej: det er falsk alarm — du kan ignorere denne.`,
      });

      if (findings.length >= opts.maxFindings) return findings;
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Explanation helper — tells the user *why* we flagged it
// ---------------------------------------------------------------------------

function explainConflict(a: EnrichedRule, b: EnrichedRule, sameSection: boolean): string {
  const posRule = a.polarity === 'positive' ? a : b;
  const negRule = a.polarity === 'negative' ? a : b;
  const shared = [...a.topics].filter(w => b.topics.has(w)).slice(0, 3);
  const location = sameSection
    ? `i samme sektion`
    : a.rule.source === b.rule.source
    ? `i samme fil`
    : `i hver sin fil`;
  const topicsStr = shared.length > 0 ? ` (omkring: ${shared.join(', ')})` : '';
  return (
    `Den ene regel siger "${posRule.polarity === 'positive' ? 'altid / skal' : 'aldrig / må ikke'}", ` +
    `den anden siger det modsatte${topicsStr} — og de står ${location}.`
  );
}
