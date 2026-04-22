// over-specification-detector — flag CLAUDE.md rules that are too narrow,
// too prescriptive, or hyper-detailed to still be useful.
//
// Rules in CLAUDE.md should encode intent + invariants, not micro-implementation
// details. Over-specified rules rot when the stack changes (Tailwind v3 → v4,
// line 42 becomes line 73, `--flag-x --flag-y --flag-z` gets a new option) and
// drown the rules that actually matter.
//
// === Why no LLM? ==========================================================
// Dear User VP: "Ingen cloud, ingen API keys, data forlader aldrig maskinen."
// This detector is local-only, pattern-based. Like semantic-conflict-detector
// it uses multiple signals + a swiss-cheese gate to keep false positives low.
//
// === Swiss-cheese gate ====================================================
// A rule must trigger AT LEAST 2 signals to be flagged. Any single signal is
// too noisy on its own (a security rule legitimately mentions a specific
// file path; a DNS rule legitimately pins IP addresses). Combining signals
// isolates the true anti-pattern: rules that are specific on multiple
// dimensions at once — usually the signature of a frozen implementation
// detail leaking into long-term instructions.
//
// Signals:
//   S1  Line-number reference: "line 42", "linje 87", "line NN"
//   S2  Multi-flag shell command: a backtick command with 3+ flags
//   S3  Deep file path: src/foo/bar/baz.ts (3+ path segments, code-like ext)
//   S4  Version pinning: "Tailwind v3", "React 18.2.1", "Node 20.1.4"
//   S5  Function signature / arg list: "foo(x: string, y: number) => Bar"
//   S6  Verbatim multi-line code block (≥3 lines inside a rule body)
//
// Each finding emits severity 'nice_to_have' (info-level, dismissible). The
// goal is a gentle nudge to rewrite as intent, not a blocking error.

import { createHash } from 'crypto';
import type { GapSeverity, LintFinding, ParsedRule, ParseResult } from '../types.js';

// ---------------------------------------------------------------------------
// Signal detectors
// ---------------------------------------------------------------------------

const LINE_REF = /\b(?:line|linje|linjen|line number)\s+\d{1,4}\b/i;

/** Match a backtick- or fenced-command with 3+ distinct short flags. */
const MULTI_FLAG_CMD = /`[^`]*(?:\s-{1,2}[A-Za-z][\w-]*(?:[= ][^`\s-]+)?){3,}[^`]*`/;

/** Deep relative/absolute file path with code-like extension — 3+ path
 *  segments and a code extension at the end. We strip URL-like contexts
 *  (http://, https://) before matching so "https://x.com/a/b.ts" doesn't
 *  register as a local source path. */
const DEEP_PATH = /[\w.-]+\/[\w.-]+\/[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|swift|kt|scala|sql|sh|yml|yaml|json|toml)\b/;
const URL_STRIP = /https?:\/\/\S+/g;

/** Version pin: "Tailwind v3", "React 18.2", "Node 20.1.4", "React 19".
 *  The leading capitalized word is the stack/tool name. We avoid matching
 *  on bare durations ("30 days") by requiring the v-prefix OR a multi-part
 *  version OR an SDK-style word followed by a bare integer. */
const VERSION_PIN = /\b(?:[A-Z][A-Za-z.+-]{1,20})\s+(?:v\d+(?:\.\d+){0,2}\b|\d+\.\d+(?:\.\d+)?\b)/;
/** Secondary version pin catching bare integers after known tool keywords
 *  (React 19, Node 20, SDK 54). This is deliberately narrower so it only
 *  fires for real stack-version contexts. */
const VERSION_PIN_BARE = /\b(?:React|Node|Python|Ruby|Go|Java|SDK|Expo|Vue|Angular|Svelte|Next|Nuxt|Rails|Django|Flask|TypeScript|JavaScript|Deno|Bun|Rust|Kotlin|Swift|PHP|Laravel)\s+v?\d{1,3}\b/i;

/** Rough heuristic for a function signature in prose: name(args) with a
 *  type-ish tail. Requires EITHER:
 *   - arrow return type (`=>`, `->`)
 *   - OR a typed-parameter shape inside the parens (`: Type`)
 *  This avoids matching Danish prose like "agent (mandage 08:15): extraherer".
 *  The tail must start with an UPPERCASE type name to further reduce noise. */
const FUNC_SIG_ARROW = /`?\b[a-zA-Z_$][\w$]*\s*\([^)]{0,200}\)\s*(?:=>|->)\s*[A-Za-z_$][\w$<>\[\],. |&?]*`?/;
// Matches `name(... x: Type ...)` — at least one typed parameter anywhere.
// Accepts lowercase scalar types (string, number) because real signatures
// typically list them alongside capitalized compound types.
const FUNC_SIG_TYPED_PARAM = /`?\b[a-zA-Z_$][\w$]*\s*\([^)]*\b[a-zA-Z_$][\w$]*\s*:\s*(?:string|number|boolean|void|any|unknown|null|undefined|[A-Z][\w$<>\[\],.|&?]*)[^)]*\)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CODE_EXT_RE = /\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|swift|kt|scala|sql|sh)$/i;

function normalizeRule(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

function stableHash(text: string): string {
  return createHash('sha256')
    .update(`over-specification|${normalizeRule(text)}`)
    .digest('hex')
    .slice(0, 16);
}

function isAcronymList(signatureCandidate: string): boolean {
  const parenMatch = signatureCandidate.match(/\(([^)]+)\)/);
  if (!parenMatch) return false;
  const body = parenMatch[1];
  // Body has commas (list) AND ≥2 all-caps tokens? Probably an acronym list,
  // not a function signature. Real TS signatures tend to have at most one
  // all-caps abbreviation as a type (e.g. `URL`, `ID`) and use lowercase
  // parameter names like `id: string`.
  const tokens = body.split(/[,\s]+/).filter(Boolean);
  const allCaps = tokens.filter(t => /^[A-Z]{2,}[A-Z0-9:.-]*$/.test(t));
  if (body.includes(',') && allCaps.length >= 2) return true;
  return false;
}

function trunc(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function findRuleLine(content: string, ruleText: string): number | undefined {
  const key = ruleText.trim().slice(0, 40).toLowerCase();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(key)) return i + 1;
  }
  return undefined;
}

/** Detect a verbatim multi-line code block attached to a rule.
 *  Signal fires when the content around the rule includes a fenced block
 *  (```...```) that spans 3+ non-empty lines. We look within 6 lines after
 *  the rule's start line. */
function hasVerbatimBlock(content: string, line: number | undefined): boolean {
  if (!line) return false;
  const lines = content.split('\n');
  const end = Math.min(lines.length, line + 10);
  let inBlock = false;
  let bodyLines = 0;
  for (let i = line; i < end; i++) {
    const t = lines[i] ?? '';
    if (/^\s*```/.test(t)) {
      if (inBlock) {
        if (bodyLines >= 3) return true;
        return false;
      }
      inBlock = true;
      bodyLines = 0;
      continue;
    }
    if (inBlock && t.trim().length > 0) bodyLines++;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-rule signal scan
// ---------------------------------------------------------------------------

export type OverSpecSignal =
  | 'line_ref'
  | 'multi_flag_cmd'
  | 'deep_path'
  | 'version_pin'
  | 'func_sig'
  | 'verbatim_block';

export interface OverSpecSignalDetails {
  signals: OverSpecSignal[];
  matches: Partial<Record<OverSpecSignal, string>>;
}

export function scanRuleForSignals(
  ruleText: string,
  content: string,
  line: number | undefined,
): OverSpecSignalDetails {
  const signals: OverSpecSignal[] = [];
  const matches: Partial<Record<OverSpecSignal, string>> = {};

  const lineMatch = ruleText.match(LINE_REF);
  if (lineMatch) {
    signals.push('line_ref');
    matches.line_ref = lineMatch[0];
  }

  const cmdMatch = ruleText.match(MULTI_FLAG_CMD);
  if (cmdMatch) {
    signals.push('multi_flag_cmd');
    matches.multi_flag_cmd = cmdMatch[0];
  }

  const stripped = ruleText.replace(URL_STRIP, ' ');
  const pathMatch = stripped.match(DEEP_PATH);
  if (pathMatch && CODE_EXT_RE.test(pathMatch[0])) {
    signals.push('deep_path');
    matches.deep_path = pathMatch[0];
  }

  const versionMatch = ruleText.match(VERSION_PIN) ?? ruleText.match(VERSION_PIN_BARE);
  if (versionMatch) {
    signals.push('version_pin');
    matches.version_pin = versionMatch[0];
  }

  const funcMatch = ruleText.match(FUNC_SIG_ARROW) ?? ruleText.match(FUNC_SIG_TYPED_PARAM);
  // Filter out prose-abbreviation matches like "(LTD, MRR, LTV:CAC)" — if the
  // entire paren body is ALL-CAPS words and commas, it's a list of acronyms,
  // not a function signature.
  if (funcMatch && !isAcronymList(funcMatch[0])) {
    signals.push('func_sig');
    matches.func_sig = funcMatch[0];
  }

  if (hasVerbatimBlock(content, line)) {
    signals.push('verbatim_block');
    matches.verbatim_block = '(multi-line code block)';
  }

  return { signals, matches };
}

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

export interface OverSpecificationOptions {
  /** Minimum number of distinct signals required to fire. Default 2 (swiss-cheese). */
  minSignals?: number;
  /** Cap on findings returned. */
  maxFindings?: number;
}

const DEFAULTS: Required<OverSpecificationOptions> = {
  minSignals: 2,
  maxFindings: 10,
};

const SIGNAL_LABELS: Record<OverSpecSignal, string> = {
  line_ref: 'henvisning til et specifikt linjenummer',
  multi_flag_cmd: 'kommando med 3+ flag',
  deep_path: 'dyb fil-sti med kode-extension',
  version_pin: 'hårdt pinned versionsnummer',
  func_sig: 'funktions-signatur med typer',
  verbatim_block: 'verbatim multi-line kodeblok',
};

export function detectOverSpecification(
  parsed: ParseResult,
  filesByPath: Map<string, string>,
  options: OverSpecificationOptions = {},
  idFactory?: (check: 'over_specified') => string,
): LintFinding[] {
  const opts = { ...DEFAULTS, ...options };
  const findings: LintFinding[] = [];
  const seenHashes = new Set<string>();

  for (const rule of parsed.rules) {
    const content = filesByPath.get(rule.source) ?? '';
    const line = findRuleLine(content, rule.text);
    const { signals, matches } = scanRuleForSignals(rule.text, content, line);

    if (signals.length < opts.minSignals) continue;

    const hash = stableHash(rule.text);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const why = explainWhy(signals, matches);
    const suggestion = buildSuggestion(rule.text, signals);

    findings.push({
      id: idFactory ? idFactory('over_specified') : `lint-over_specified-${hash}`,
      check: 'over_specified',
      severity: 'nice_to_have' as GapSeverity,
      title: 'Regel er for detaljeret til CLAUDE.md',
      description:
        `Denne regel binder sig til meget specifikke implementerings-detaljer. ` +
        `Når koden, versionen eller kommandoen ændrer sig, bliver reglen forkert — ` +
        `og de rigtige regler drukner i støj. ${why}`,
      file: rule.source,
      line,
      excerpt: trunc(rule.text, 120),
      fix:
        `Skriv reglen om som intention, ikke implementation. ${suggestion} ` +
        `Detaljerne hører hjemme i kode-kommentarer eller docs — ikke i CLAUDE.md.`,
    });

    if (findings.length >= opts.maxFindings) return findings;
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Explanation + suggestion helpers
// ---------------------------------------------------------------------------

function explainWhy(
  signals: OverSpecSignal[],
  matches: Partial<Record<OverSpecSignal, string>>,
): string {
  const bits = signals.slice(0, 3).map(s => {
    const match = matches[s];
    const label = SIGNAL_LABELS[s];
    if (match && s !== 'verbatim_block') return `${label} ("${trunc(match, 40)}")`;
    return label;
  });
  return `Fangede: ${bits.join(' + ')}.`;
}

function buildSuggestion(ruleText: string, signals: OverSpecSignal[]): string {
  const lower = ruleText.toLowerCase();
  if (signals.includes('version_pin')) {
    return `Fx: "Brug en moderne version af [værktøjet]" i stedet for at pinne et præcist versionsnummer.`;
  }
  if (signals.includes('line_ref')) {
    return `Fx: "Når du redigerer [modul], husk at [intention]" i stedet for at pege på linje NN.`;
  }
  if (signals.includes('multi_flag_cmd')) {
    return `Fx: "Kør tests før du committer" i stedet for at låse kommandoen med alle flag.`;
  }
  if (signals.includes('deep_path')) {
    return `Fx: "Når du rører [komponent], tjek [invariant]" i stedet for at pege på en dyb fil-sti.`;
  }
  if (signals.includes('func_sig')) {
    return `Fx: "Denne funktion returnerer [formål]" i stedet for at duplikere signaturen.`;
  }
  if (lower.length > 120) {
    return `Klip detaljerne ud og efterlad kun intentionen.`;
  }
  return `Behold intentionen, fjern implementation.`;
}
