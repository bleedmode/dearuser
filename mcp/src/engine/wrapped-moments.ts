// wrapped-moments — extract Spotify-Wrapped-style "moments" from the scan.
//
// Principles (see Content rules in the task brief):
//   - Never fabricate: if data isn't there, skip the moment.
//   - One specific number per moment. Not "several", not "many" — real integers.
//   - Name the thing: skill names, rule excerpts, category names.
//   - Privacy: don't leak secrets or full file paths.
//   - Max 5 moments surfaced; ordered by perceived punch.
//
// Every extractor is defensive — returns null when its signal is absent.

import { readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type {
  AuditArtifact,
  ParsedRule,
  ScanResult,
  SessionData,
  CategoryScore,
  WrappedContrast,
  WrappedMoment,
  WrappedPercentile,
} from '../types.js';

// ---------------------------------------------------------------------------
// Percentile vs corpus — 1000+ public CLAUDE.md files (v2 calibration study
// 2026-04-22). See research/calibration/2026-04-22-claude-md-corpus-v2/.
// ---------------------------------------------------------------------------

/**
 * Locate the scores.jsonl file shipping alongside the repo. In dev this is
 * `research/calibration/...`. In the installed npm package we don't ship
 * calibration data (too much weight), so this returns null there and the
 * moment is skipped. That's fine — the feature degrades gracefully.
 *
 * Prefers v2 (1000+ files) if present; falls back to v1 (50 files) for
 * back-compat when this module is copied into an environment that only has
 * the old corpus around.
 */
function findCorpusFile(): string | null {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    'research/calibration/2026-04-22-claude-md-corpus-v2/data/scores.jsonl',
    'research/calibration/2026-04-22-claude-md-corpus/data/scores.jsonl',
  ];
  let dir = dirname(here);
  for (let i = 0; i < 8; i++) {
    for (const c of candidates) {
      const candidate = resolve(dir, c);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let _cachedCorpus: number[] | null | undefined;
let _cachedMedian: number | null | undefined;

function loadCorpusScores(): number[] | null {
  if (_cachedCorpus !== undefined) return _cachedCorpus;
  const file = findCorpusFile();
  if (!file) {
    _cachedCorpus = null;
    _cachedMedian = null;
    return null;
  }
  try {
    const content = readFileSync(file, 'utf-8');
    const scores: number[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.collabScore === 'number') {
          scores.push(parsed.collabScore);
        }
      } catch {
        // skip malformed lines
      }
    }
    _cachedCorpus = scores.length > 0 ? scores : null;
    if (_cachedCorpus) {
      const sorted = [..._cachedCorpus].sort((a, b) => a - b);
      _cachedMedian = sorted[Math.floor((sorted.length - 1) * 0.5)];
    } else {
      _cachedMedian = null;
    }
    return _cachedCorpus;
  } catch {
    _cachedCorpus = null;
    _cachedMedian = null;
    return null;
  }
}

function corpusMedian(): number | null {
  loadCorpusScores();
  return _cachedMedian ?? null;
}

/** For tests — clear the cache so fixtures don't bleed across specs. */
export function __resetCorpusCache(): void {
  _cachedCorpus = undefined;
  _cachedMedian = undefined;
}

/**
 * Round the "top X%" figure to a sensible, shareable bucket (3, 5, 10, 25,
 * 50). Never displays "top 47%" — always a round number below the real one.
 */
function roundTopPercent(rawTop: number): number {
  const buckets = [1, 3, 5, 10, 25, 50];
  for (const b of buckets) {
    if (rawTop <= b) return b;
  }
  return 50;
}

export function computePercentile(score: number): WrappedPercentile | null {
  const corpus = loadCorpusScores();
  if (!corpus || corpus.length < 10) return null;
  const below = corpus.filter((s) => s < score).length;
  const percentile = Math.round((below / corpus.length) * 100);
  // Only show the moment when the user is at least mid-corpus — no point
  // telling someone "you scored in the bottom 20%" as a celebration stat.
  if (percentile < 50) return null;
  const rawTop = 100 - percentile;
  const topPercent = roundTopPercent(Math.max(1, rawTop));
  return {
    score,
    percentile,
    topPercent,
    corpusSize: corpus.length,
  };
}

// ---------------------------------------------------------------------------
// Moment extractors
// ---------------------------------------------------------------------------

/**
 * Moment 1 — percentile vs corpus.
 *
 * Only fires when we can read the calibration corpus AND the user is in the
 * upper half. The narrative mirrors Spotify's "you listened more than X% of
 * Danes" framing.
 */
function percentileMoment(pct: WrappedPercentile | null): WrappedMoment | null {
  if (!pct) return null;
  // Narrative reads better in absolute counts for the top end — "beat every
  // single one of 1000" is punchier than "higher than 100%".
  const beat = Math.round((pct.percentile / 100) * pct.corpusSize);
  const narrative = beat >= pct.corpusSize
    ? `Your setup beats every single one of the ${pct.corpusSize.toLocaleString('en-US')} public CLAUDE.md files we benchmarked.`
    : `Your setup beats ${beat.toLocaleString('en-US')} of ${pct.corpusSize.toLocaleString('en-US')} public CLAUDE.md files we benchmarked — top ${pct.topPercent}% territory.`;
  const median = corpusMedian();
  const detail = median !== null
    ? `Score ${pct.score} — corpus median is ${median}.`
    : `Score ${pct.score}.`;
  return {
    id: 'percentile',
    value: `Top ${pct.topPercent}%`,
    label: 'Where you rank',
    narrative,
    detail,
  };
}

/**
 * Moment 2 — most-repeated correction.
 *
 * Mines session corrections.examples for a recurring theme. We don't do
 * clustering — the examples list is already short and curated. Instead we
 * pick the total negation count and surface one anonymised example line.
 */
function correctionMoment(session: SessionData | undefined): WrappedMoment | null {
  if (!session) return null;
  const neg = session.corrections.negationCount;
  if (neg < 3) return null;
  const example = session.corrections.examples[0];
  const narrative = example
    ? `You caught me and pushed back ${neg} times. The one I remember: "${truncate(example, 80)}"`
    : `You caught me and pushed back ${neg} times. I'm keeping track — so the next correction comes sooner.`;
  return {
    id: 'corrections',
    value: String(neg),
    label: 'Times you corrected me',
    narrative,
  };
}

/**
 * Moment 3 — dead skills.
 *
 * A skill is "dead" when nothing references it — no CLAUDE.md mention, no
 * scheduled task, no hook command, no other skill's body. The check is
 * deliberately conservative (exact kebab-case + lowercase substring) so we
 * don't falsely accuse a live skill of being unused.
 */
function deadSkillsMoment(
  artifacts: AuditArtifact[] | undefined,
  scanResult: ScanResult,
): WrappedMoment | null {
  if (!artifacts) return null;
  const skills = artifacts.filter((a) => a.type === 'skill');
  if (skills.length < 3) return null;

  // Aggregate searchable text: CLAUDE.md (both), memory, scheduled task
  // bodies, hook commands, OTHER skill bodies.
  const corpusParts: string[] = [];
  if (scanResult.globalClaudeMd?.content) corpusParts.push(scanResult.globalClaudeMd.content);
  if (scanResult.projectClaudeMd?.content) corpusParts.push(scanResult.projectClaudeMd.content);
  for (const m of scanResult.memoryFiles) corpusParts.push(m.content);
  for (const a of artifacts) {
    if (a.type === 'skill') continue; // skills don't count as references to themselves
    corpusParts.push(a.prompt || '');
    corpusParts.push(a.description || '');
  }
  const corpus = corpusParts.join('\n').toLowerCase();

  const dead: string[] = [];
  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    // Plugin-namespaced skills like "pluginName:skillName" — check both
    // halves separately. Plugin is often referenced without the full colon
    // path (e.g. via `mcp__pluginName__*` MCP tool calls).
    const parts = name.split(':');
    const candidates = parts.length > 1 ? [name, ...parts] : [name];
    // Require at least one reference with a word-ish boundary — `/name`,
    // `name:`, ` name `, etc. A bare substring match fires too much on
    // common words.
    let hit = false;
    outer: for (const candidate of candidates) {
      const patterns = [
        `/${candidate}`,
        ` ${candidate} `,
        ` ${candidate}.`,
        ` ${candidate}\n`,
        ` ${candidate},`,
        `"${candidate}"`,
        `\`${candidate}\``,
        `(${candidate})`,
        `[${candidate}]`,
        `mcp__${candidate}`, // plugin/MCP-backed skills
      ];
      for (const p of patterns) {
        if (corpus.includes(p)) { hit = true; break outer; }
      }
    }
    if (!hit) dead.push(skill.name);
  }

  if (dead.length === 0) return null;
  // Surface up to 3 names; trailing "and N more" if longer.
  const shown = dead.slice(0, 3);
  const rest = dead.length - shown.length;
  const list = shown.map((n) => `\`${n}\``).join(', ');
  const more = rest > 0 ? ` and ${rest} more` : '';
  const plural = dead.length === 1;
  const themIt = plural ? 'it' : 'them';
  const tense = plural ? 'it' : 'them';
  return {
    id: 'dead-skills',
    value: String(dead.length),
    label: plural ? 'Skill never called' : 'Skills never called',
    narrative: `You built ${list}${more} — I've never seen you use ${themIt}. Maybe it's time to kill ${tense}, or tell me when ${plural ? 'it fires' : 'they fire'}.`,
    detail: `Out of ${skills.length} total skills.`,
  };
}

/**
 * Moment 4 — your biggest rule.
 *
 * Longest single rule by word count. We quote a short head so the user sees
 * what the moment is about without leaking the whole rule.
 */
function biggestRuleMoment(rules: ParsedRule[] | undefined): WrappedMoment | null {
  if (!rules || rules.length === 0) return null;
  let longest: ParsedRule | null = null;
  let longestWords = 0;
  for (const r of rules) {
    const w = r.text.trim().split(/\s+/).filter(Boolean).length;
    if (w > longestWords) {
      longest = r;
      longestWords = w;
    }
  }
  if (!longest || longestWords < 40) return null;
  const head = truncate(longest.text.trim().replace(/\s+/g, ' '), 80);
  return {
    id: 'biggest-rule',
    value: `${longestWords} words`,
    label: 'Your longest rule',
    narrative: `Your longest rule runs ${longestWords} words. It starts: "${head}"`,
    detail: 'Long rules are easier to forget than short ones. If this is load-bearing, it might deserve to be two rules.',
  };
}

/**
 * Moment 5 — contrast (strongest + weakest category).
 *
 * Always computable since categories are always present, so this is the
 * reliable "always has something to say" moment. The narrative names both
 * so the user sees the gap, not just a score.
 */
function contrastMoment(contrast: WrappedContrast): WrappedMoment | null {
  const delta = contrast.strongest.score - contrast.weakest.score;
  if (delta < 20) return null; // too flat a profile to be a moment
  return {
    id: 'contrast',
    value: `+${delta}`,
    label: 'Your biggest gap',
    narrative: `You're strongest at ${contrast.strongest.name} (${contrast.strongest.score}/100) and weakest at ${contrast.weakest.name} (${contrast.weakest.score}). That's a ${delta}-point spread — a clear next focus.`,
  };
}

/**
 * Moment 6 — prohibition balance.
 *
 * Spotify Wrapped punches on ratios. Surface the ratio ONLY when it's
 * lopsided enough to mean something — below 10% or above 50%.
 */
function prohibitionMoment(rules: ParsedRule[] | undefined): WrappedMoment | null {
  if (!rules || rules.length < 8) return null;
  const total = rules.length;
  const prohibitions = rules.filter((r) => r.type === 'prohibition').length;
  const ratio = Math.round((prohibitions / total) * 100);
  if (ratio < 10 || ratio > 50) {
    const narrative = ratio > 50
      ? `${ratio}% of your rules are DON'Ts. You mostly tell me what to avoid — not what to do. Consider adding a few "do this" rules so I have a positive template.`
      : `Only ${ratio}% of your rules are DON'Ts. You trust me with a lot of positive latitude — ${prohibitions} explicit prohibitions across ${total} rules.`;
    return {
      id: 'prohibitions',
      value: `${ratio}%`,
      label: 'Your DO/DON\'T mix',
      narrative,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contrast computation — always returned (the one moment we can always make)
// ---------------------------------------------------------------------------

const CATEGORY_DISPLAY: Record<string, string> = {
  roleClarity: 'Role Clarity',
  communication: 'Communication',
  autonomyBalance: 'Autonomy Balance',
  qualityStandards: 'Quality Standards',
  memoryHealth: 'Memory Health',
  systemMaturity: 'System Maturity',
  coverage: 'Coverage',
};

export function computeContrast(categories: Record<string, CategoryScore>): WrappedContrast {
  let strongest: { key: string; score: number } | null = null;
  let weakest: { key: string; score: number } | null = null;
  for (const [key, cat] of Object.entries(categories)) {
    if (!strongest || cat.score > strongest.score) strongest = { key, score: cat.score };
    if (!weakest || cat.score < weakest.score) weakest = { key, score: cat.score };
  }
  const s = strongest ?? { key: 'roleClarity', score: 0 };
  const w = weakest ?? { key: 'roleClarity', score: 0 };
  return {
    strongest: { key: s.key, name: CATEGORY_DISPLAY[s.key] || s.key, score: s.score },
    weakest: { key: w.key, name: CATEGORY_DISPLAY[w.key] || w.key, score: w.score },
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface BuildMomentsInput {
  collaborationScore: number;
  rules: ParsedRule[];
  artifacts: AuditArtifact[];
  scanResult: ScanResult;
  session: SessionData | undefined;
  categories: Record<string, CategoryScore>;
}

export interface BuildMomentsResult {
  moments: WrappedMoment[];
  percentile: WrappedPercentile | null;
  contrast: WrappedContrast;
}

/**
 * Extract up to 5 moments. Priority order reflects perceived punch:
 *   1. Percentile (if data available) — leads strong.
 *   2. Corrections (if user has a loop) — most personal.
 *   3. Dead skills (if any) — specific + names things.
 *   4. Biggest rule (if long enough) — quotable.
 *   5. Contrast (always if delta ≥ 20) — actionable.
 *   6. Prohibition balance (fallback) — only if others didn't hit 5.
 */
export function buildMoments(input: BuildMomentsInput): BuildMomentsResult {
  const percentile = computePercentile(input.collaborationScore);
  const contrast = computeContrast(input.categories);

  const candidates: Array<WrappedMoment | null> = [
    percentileMoment(percentile),
    correctionMoment(input.session),
    deadSkillsMoment(input.artifacts, input.scanResult),
    biggestRuleMoment(input.rules),
    contrastMoment(contrast),
    prohibitionMoment(input.rules),
  ];

  const moments = candidates
    .filter((m): m is WrappedMoment => m !== null)
    .slice(0, 5);

  return { moments, percentile, contrast };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
