// Friction Analyzer — extracts friction themes from feedback memories,
// prohibition rules, and session correction signals.
//
// Design notes:
// 1. Feedback memory FILENAMES are the strongest signal — users name their
//    feedback files after the lesson ("feedback_never_change_beyond_scope.md").
//    We map filename keywords → themes before falling back to content regex.
// 2. We parse the frontmatter `name` / `description` for evidence quotes so
//    the user sees the sentence they themselves wrote, not a random slice.
// 3. Regex patterns over free text are tight — no generic single words like
//    "system", "cli", "api", "repeat" that false-positive on normal prose.
// 4. Session correction examples feed theme counts too (new in v2).

import type { FrictionPattern, FrictionTheme, ParseResult, ScanResult, SessionData } from '../types.js';

interface ThemeConfig {
  theme: FrictionTheme;
  title: string;
  description: string;
  /** Substrings in feedback memory filenames that strongly imply this theme. */
  filenameKeywords: string[];
  /** Regex patterns to apply to free text (prohibition rules, memory bodies, session examples). */
  textPatterns: RegExp[];
}

const THEMES: ThemeConfig[] = [
  {
    theme: 'scope_creep',
    title: 'Scope Creep',
    description: 'The agent changes things it wasn\'t asked to touch — rewriting prompts, redesigning assets, refactoring working code',
    filenameKeywords: ['scope', 'beyond', 'redesign', 'logo', 'never_change'],
    textPatterns: [
      /never change (?:code|prompts?|logic) beyond/i,
      /kun (?:rør|ændre) (?:det|den)/i,
      /only change exactly what/i,
      /don'?t (?:rewrite|refactor|redesign) without/i,
      /scope creep/i,
    ],
  },
  {
    theme: 'communication',
    title: 'Lost in Translation',
    description: 'Mismatched communication style — wrong language, too technical, too verbose, or missing the user\'s preferred tone',
    filenameKeywords: ['danish', 'language', 'tone', 'response', 'communication', 'jargon'],
    textPatterns: [
      /(?:answer|respond|svar) (?:in|på) danish/i,
      /always (?:respond|answer) in/i,
      /don'?t (?:use|speak) (?:english|technical)/i,
      /too (?:technical|verbose|long)/i,
      /match (?:my|the user'?s) language/i,
    ],
  },
  {
    theme: 'quality',
    title: 'Quality Gaps',
    description: 'Code breaks, tests fail, builds break, or the agent ships without verifying',
    filenameKeywords: ['quality', 'research', 'content', 'end_to_end', 'verify', 'test'],
    textPatterns: [
      /(?:build|test|deploy) (?:fails?|broken|failed)/i,
      /(?:verify|test) before (?:ship|commit|deploy)/i,
      /never (?:say|claim) (?:something|it) works/i,
      /broke (?:production|working code)/i,
      /empty research (?:file|files)/i,
      /think end.?to.?end/i,
    ],
  },
  {
    theme: 'autonomy',
    title: 'Autonomy Mismatch',
    description: 'The agent acts when it should ask, or asks when it should act — wrong calibration of independence',
    filenameKeywords: ['autonomy', 'ask_first', 'permission', 'approval'],
    textPatterns: [
      /ask (?:first|before)/i,
      /(?:don'?t|never) (?:delete|commit|publish) without asking/i,
      /spørg (?:først|før)/i,
      /acted when (?:it should|I wanted it to) ask/i,
    ],
  },
  {
    theme: 'tooling',
    title: 'Manual Workarounds',
    description: 'Suggesting one-off fixes instead of systematic solutions — doing things manually when they should be automated',
    filenameKeywords: ['manual', 'workaround', 'automat', 'one_off', 'dev_server'],
    textPatterns: [
      /(?:doing|do) (?:this|it) manually/i,
      /one.?off (?:fix|solution)/i,
      /no dev server for/i,
      /should be automated/i,
      /deploy directly (?:without|instead)/i,
    ],
  },
  {
    theme: 'process',
    title: 'Process Friction',
    description: 'Workflow issues — wrong deploy flow, skipped steps, incorrect assumptions about process',
    filenameKeywords: ['workflow', 'deploy', 'process', 'flow', 'protocol'],
    textPatterns: [
      /(?:wrong|broken) (?:deploy|release|workflow)/i,
      /skipped (?:a |the )?(?:step|check)/i,
      /forgot to (?:run|check|update)/i,
      /protocol (?:not |isn'?t )followed/i,
    ],
  },
];

interface ThemeBucket {
  hits: number;
  evidence: string[];
}

function emptyBuckets(): Record<FrictionTheme, ThemeBucket> {
  return {
    scope_creep: { hits: 0, evidence: [] },
    communication: { hits: 0, evidence: [] },
    quality: { hits: 0, evidence: [] },
    autonomy: { hits: 0, evidence: [] },
    tooling: { hits: 0, evidence: [] },
    process: { hits: 0, evidence: [] },
  };
}

function addEvidence(bucket: ThemeBucket, excerpt: string) {
  if (bucket.evidence.length >= 3) return;
  const cleaned = excerpt.replace(/\s+/g, ' ').trim();
  if (!cleaned) return;
  // Dedupe — don't add the same quote twice.
  if (bucket.evidence.some(e => e === cleaned || e.includes(cleaned) || cleaned.includes(e))) return;
  bucket.evidence.push(cleaned.slice(0, 140));
}

/**
 * Pull the `name:` and `description:` lines out of a memory file's frontmatter.
 * These are the user's own words describing the lesson — the best possible
 * evidence to cite back to them.
 */
function extractFrontmatterEvidence(content: string): string | null {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  if (nameMatch && descMatch) {
    return `${nameMatch[1].trim()} — ${descMatch[1].trim()}`;
  }
  if (nameMatch) return nameMatch[1].trim();
  if (descMatch) return descMatch[1].trim();
  return null;
}

export function analyzeFriction(parsed: ParseResult, scan: ScanResult, session?: SessionData): FrictionPattern[] {
  const buckets = emptyBuckets();

  // --- 1. Feedback memory files — filename-based classification (strongest). ---
  for (const mem of scan.memoryFiles.filter(m => m.path.toLowerCase().includes('feedback_'))) {
    const filename = mem.path.split('/').pop() || '';
    const lower = filename.toLowerCase();

    for (const theme of THEMES) {
      if (theme.filenameKeywords.some(kw => lower.includes(kw))) {
        buckets[theme.theme].hits += 2; // Filename match weighs more than body regex
        const evidence = extractFrontmatterEvidence(mem.content);
        if (evidence) addEvidence(buckets[theme.theme], evidence);
        break; // One theme per file — filenames are specific enough
      }
    }
  }

  // --- 2. Prohibition rules — tight regex only. ---
  // Prohibitions are the user's explicit "never do X" rules. We only count
  // matches of specific multi-word patterns to avoid generic-word noise.
  for (const rule of parsed.rules.filter(r => r.type === 'prohibition')) {
    for (const theme of THEMES) {
      if (theme.textPatterns.some(p => p.test(rule.text))) {
        buckets[theme.theme].hits += 1;
        addEvidence(buckets[theme.theme], rule.text);
        break; // Each rule belongs to at most one theme
      }
    }
  }

  // --- 3. Session correction examples — the user literally pushed back. ---
  // Each example is a real user prompt that tripped a negation/frustration
  // pattern. We reuse the same text patterns to classify them.
  if (session?.corrections?.examples) {
    for (const example of session.corrections.examples) {
      for (const theme of THEMES) {
        if (theme.textPatterns.some(p => p.test(example))) {
          buckets[theme.theme].hits += 1;
          addEvidence(buckets[theme.theme], example);
          break;
        }
      }
    }
  }

  // --- Rank and return themes that have BOTH hits AND concrete evidence. ---
  // Themes with hits but no evidence are silently dropped — we refuse to
  // claim a pattern we can't cite.
  const ranked = Object.entries(buckets)
    .filter(([, b]) => b.hits > 0 && b.evidence.length > 0)
    .sort(([, a], [, b]) => b.hits - a.hits)
    .slice(0, 5);

  return ranked.map(([theme, b], index) => {
    const config = THEMES.find(t => t.theme === theme)!;
    return {
      rank: index + 1,
      title: config.title,
      description: config.description,
      evidence: b.evidence,
      theme: theme as FrictionTheme,
    };
  });
}
