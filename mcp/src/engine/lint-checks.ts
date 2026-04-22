// CLAUDE.md lint checks — prompt & config quality analysis
//
// 52 checks across 7 domains that catch common anti-patterns in agent config.
// Designed to complement (not duplicate) the collaboration scoring:
// scoring measures *what's present*, linting measures *what's wrong*.

import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';
import { homedir } from 'os';
import type { ScanResult, ParseResult, LintFinding, LintCheckId, LintSummary, GapSeverity, FileInfo } from '../types.js';
import { detectSemanticConflicts } from './semantic-conflict-detector.js';
import { detectOverSpecification } from './over-specification-detector.js';

interface LintResult {
  findings: LintFinding[];
  summary: LintSummary;
}

// ---------------------------------------------------------------------------
// Parsed hook / skill helpers
// ---------------------------------------------------------------------------

interface ParsedHook {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
  source: string; // settings file path
}

interface SkillInfo {
  name: string;     // directory name
  path: string;     // full path to SKILL.md
  content: string;
  hasFrontmatter: boolean;
  frontmatterName?: string;
  frontmatterDescription?: string;
}

function extractHooksFromSettings(settingsFiles: FileInfo[]): ParsedHook[] {
  const hooks: ParsedHook[] = [];
  for (const sf of settingsFiles) {
    try {
      const json = JSON.parse(sf.content);
      const hooksObj = json?.hooks;
      if (!hooksObj || typeof hooksObj !== 'object') continue;
      for (const [event, entries] of Object.entries(hooksObj)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const hookList = entry?.hooks;
          if (!Array.isArray(hookList)) continue;
          for (const h of hookList) {
            if (h?.type === 'command' && typeof h.command === 'string') {
              hooks.push({
                event,
                matcher: entry.matcher || undefined,
                command: h.command,
                timeout: h.timeout || undefined,
                source: sf.path,
              });
            }
          }
        }
      }
    } catch { /* not valid JSON or no hooks */ }
  }
  return hooks;
}

function discoverSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];
  const skillsDir = join(homedir(), '.claude', 'skills');
  try {
    if (!existsSync(skillsDir)) return skills;
    for (const entry of readdirSync(skillsDir)) {
      const skillMd = join(skillsDir, entry, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      const content = readFileSync(skillMd, 'utf-8');
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let fmName: string | undefined;
      let fmDesc: string | undefined;
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)/m);
        const descMatch = fmMatch[1].match(/^description:\s*(.+)/m);
        fmName = nameMatch?.[1]?.trim();
        fmDesc = descMatch?.[1]?.trim();
      }
      skills.push({
        name: entry,
        path: skillMd,
        content,
        hasFrontmatter: !!fmMatch,
        frontmatterName: fmName,
        frontmatterDescription: fmDesc,
      });
    }
  } catch { /* skills dir unreadable */ }
  return skills;
}

// ---------------------------------------------------------------------------
// Pattern libraries
// ---------------------------------------------------------------------------

const GENERIC_FILLER_PHRASES = [
  'be helpful', 'be accurate', 'be concise', 'be thorough',
  'write clean code', 'write good code', 'follow best practices',
  'be professional', 'be efficient', 'be careful',
  'use common sense', 'think step by step', 'think carefully',
  'you are a helpful assistant', 'you are an expert',
  'always produce high-quality', 'ensure correctness',
  'pay attention to detail', 'be thoughtful',
  'write maintainable code', 'write readable code',
  'provide clear explanations', 'be responsive',
  'vær hjælpsom', 'vær grundig', 'vær præcis', 'skriv god kode',
];

const WEAK_IMPERATIVE_PATTERNS = [
  /\btry to\b/i, /\bshould\b/i, /\bconsider\b/i,
  /\bif possible\b/i, /\bwhen possible\b/i, /\bideally\b/i,
  /\bpreferably\b/i, /\bit would be nice\b/i, /\bmaybe\b/i,
  /\bperhaps\b/i, /\bmight want to\b/i,
  /\bprøv at\b/i, /\bbør\b/i, /\bevt\.?\b/i, /\bhvis muligt\b/i,
  /\boverve?j\b/i,
];

// Exclude "should" in analytical context (not instructions)
const WEAK_IMPERATIVE_EXCEPTIONS = [
  /should be evaluated/i, /should be assessed/i,
  /shouldn't\b/i, /should not\b/i, // these are prohibitions, not weak
];

const CRITICAL_MARKERS = [
  /\bnever\b/i, /\balways\b/i, /\bcritical\b/i, /\bimportant\b/i,
  /\bmust\b/i, /\brequired\b/i, /\bmandatory\b/i,
  /\baldrig\b/i, /\baltid\b/i, /\bkritisk\b/i, /\bvigtig/i, /\bskal\b/i,
];

const COMPRESSIBLE_PADDING = [
  'always remember to', 'make sure to', 'please ensure that',
  'it is important to', 'you should always', 'be sure to',
  'remember that you', 'keep in mind that', 'note that you should',
  'it is essential to', 'it is crucial to', 'please make sure',
  'husk altid at', 'sørg for at', 'det er vigtigt at',
  'vær sikker på at', 'husk at du skal',
];

const MENTAL_NOTE_PATTERNS = [
  /\bremember to\b/i, /\bkeep in mind\b/i, /\bdon't forget to\b/i,
  /\bbear in mind\b/i, /\bnote that\b/i, /\btake note\b/i,
  /\bhusk at\b/i, /\bglem ikke at\b/i, /\bhav in mente\b/i,
];

const DANGEROUS_HOOK_COMMANDS = [
  /\brm\s+(-\w*r\w*f|--force)\b/, /\brm\s+-\w*f\w*r\b/,
  /\bcurl\b.*\|\s*\b(sh|bash|zsh)\b/, /\bwget\b.*\|\s*\b(sh|bash)\b/,
  /\bchmod\s+777\b/, /\bchmod\s+-R\s+777\b/,
  /\bgit\s+push\s+--force\b/, /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\s+rm\b/, /\bdd\s+if=.*of=\/dev\b/,
  /\b>\s*\/dev\/sd[a-z]\b/,
];

const LINTER_CONFIG_PATTERNS = [
  /\b(2|4)[\s-]space (indent|tab)/i,
  /\buse (single|double) quotes\b/i,
  /\bsemicolons? (at end|required|always)\b/i,
  /\bmax (line )?length.?\d+/i,
  /\btrailing comma/i,
  /\btabs? (vs |over |instead of )spaces/i,
];

const VAGUE_SKILL_NAMES = [
  'helper', 'utils', 'utility', 'tool', 'misc', 'general', 'common', 'base', 'main', 'default', 'test',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let findingCounter = 0;
function makeId(check: LintCheckId): string {
  return `lint-${check}-${++findingCounter}`;
}

function finding(
  check: LintCheckId,
  severity: GapSeverity,
  title: string,
  description: string,
  file: string,
  excerpt: string,
  line?: number,
  fix?: string,
): LintFinding {
  return { id: makeId(check), check, severity, title, description, file, line, excerpt, fix };
}

/** Get lines from content with 1-based line numbers. */
function indexedLines(content: string): Array<{ line: number; text: string }> {
  return content.split('\n').map((text, i) => ({ line: i + 1, text }));
}

/** Truncate to max N chars for excerpt. */
function trunc(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Normalize text for comparison: lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9æøå ]/g, '').replace(/\s+/g, ' ').trim();
}

/** Extract topic words from a rule (nouns/verbs after removing common words). */
function topicWords(text: string): Set<string> {
  const stop = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'be', 'to', 'of', 'and', 'or', 'in', 'on', 'for', 'with', 'not', 'do', 'don', 't', 'it', 'you', 'your', 'this', 'that']);
  return new Set(normalize(text).split(' ').filter(w => w.length > 2 && !stop.has(w)));
}

/** Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// ============================================================================
// A. INSTRUCTION QUALITY (14 checks)
// ============================================================================

/** A1. Generic filler — phrases the model already knows; wastes context. */
function checkGenericFiller(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  for (const { line, text } of indexedLines(content)) {
    const lower = text.toLowerCase();
    for (const phrase of GENERIC_FILLER_PHRASES) {
      if (lower.includes(phrase)) {
        results.push(finding(
          'generic_filler', 'recommended',
          `Generic filler: "${phrase}"`,
          `The model already knows to "${phrase}". This wastes context tokens without changing behavior.`,
          file, trunc(text), line,
          `Remove or replace with a specific, actionable instruction.`,
        ));
        break;
      }
    }
  }
  return results;
}

/** A2. Weak imperatives — "try to", "should", "consider" weaken instructions. */
function checkWeakImperatives(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    for (const pattern of WEAK_IMPERATIVE_PATTERNS) {
      if (pattern.test(text)) {
        if (WEAK_IMPERATIVE_EXCEPTIONS.some(ex => ex.test(text))) continue;
        const match = text.match(pattern);
        results.push(finding(
          'weak_imperative', 'nice_to_have',
          `Weak imperative: "${match?.[0] || 'should'}"`,
          `Hedging language weakens instructions. The model treats "should" as optional. Use direct imperatives.`,
          file, trunc(text), line,
          `Replace with a direct imperative: "Do X" instead of "Try to X".`,
        ));
        break;
      }
    }
  }
  return results;
}

/** A3. Negative-only rules — "don't X" without "do Y instead". */
function checkNegativeOnly(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);
  const negP = [/\bdon'?t\b/i, /\bdo not\b/i, /\bnever\b/i, /\bavoid\b/i, /\blad vær/i, /\bikke\b/i, /\baldrig\b/i, /\bundgå\b/i];
  const posP = [/\binstead\b/i, /\brather\b/i, /\buse\b/i, /\bprefer\b/i, /→/, /—.*(?:brug|use|do|prefer|kør|åbn|tjek|verificér|flag|tilføj|vis|lav|gør|nævn|skriv|sæt)/i, /\bkør\b/i, /\båbn\b/i, /\btjek\b/i, /\bverificér\b/i, /\bflag\b/i, /\btilføj\b/i, /\bvis\b/i, /\blav\b/i, /\bgør\b/i, /\bnævn\b/i, /\bskriv\b/i, /\bsæt\b/i, /\bimplementér\b/i, /\bbare (?:gå i gang|gør det)\b/i];

  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (/^\s*[-*]\s+\*\*\w+.*:\*\*/.test(text)) continue;
    if (!negP.some(p => p.test(text))) continue;
    if (posP.some(p => p.test(text))) continue;
    const nextLine = lines.find(l => l.line === line + 1);
    if (nextLine && posP.some(p => p.test(nextLine.text))) continue;
    results.push(finding(
      'negative_only', 'nice_to_have',
      'Negative-only rule',
      `Rules that only say "don't" without an alternative leave the model guessing what to do instead.`,
      file, trunc(text), line,
      `Add what TO do: "Don't X — instead, do Y."`,
    ));
  }
  return results.slice(0, 5);
}

/** A4. Ambiguous rules — too short or vague to be actionable. */
function checkAmbiguousRules(parsed: ParseResult): LintFinding[] {
  const results: LintFinding[] = [];
  for (const rule of parsed.rules) {
    if (rule.text.length < 15) {
      results.push(finding(
        'ambiguous_rule', 'nice_to_have',
        'Rule too short to be actionable',
        `"${rule.text}" — at ${rule.text.length} characters, this is too vague for the agent to follow consistently.`,
        rule.source, rule.text, undefined,
        `Expand with specific context: when does this apply? What exactly should happen?`,
      ));
    }
  }
  return results.slice(0, 5);
}

/** A5. Missing rationale — rules without "why" are harder to follow in edge cases. */
function checkMissingRationale(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);
  const strongP = [/\bnever\b/i, /\balways\b/i, /\bmust\b/i, /\baldrig\b/i, /\baltid\b/i, /\bskal\b/i];
  const rationaleP = [/\bbecause\b/i, /\bsince\b/i, /\bwhy\b/i, /\breason\b/i, /\bfordi\b/i, /\bgrund/i, /\bda\b/i, /—/, /\(.*\)/];

  let count = 0;
  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (count >= 3) break;
    if (!strongP.some(p => p.test(text))) continue;
    if (rationaleP.some(p => p.test(text))) continue;
    const nextLine = lines.find(l => l.line === line + 1);
    if (nextLine && rationaleP.some(p => p.test(nextLine.text))) continue;
    if (text.length > 120) continue;
    results.push(finding(
      'missing_rationale', 'nice_to_have',
      'Rule without rationale',
      `Strong rules ("never", "always", "must") work better when the agent understands WHY. This helps it judge edge cases correctly.`,
      file, trunc(text), line,
      `Add a brief reason: "Never X — because Y" or "Always X (reason: Y)".`,
    ));
    count++;
  }
  return results;
}

/** A6. Buried critical rules — important rules in the middle of a long file. */
function checkBuriedCriticalRules(content: string, file: string): LintFinding[] {
  const lines = indexedLines(content);
  const totalLines = lines.length;
  if (totalLines < 100) return [];

  const results: LintFinding[] = [];
  const middleStart = Math.floor(totalLines * 0.3);
  const middleEnd = Math.floor(totalLines * 0.7);

  for (const { line, text } of lines) {
    if (line < middleStart || line > middleEnd) continue;
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (CRITICAL_MARKERS.some(p => p.test(text))) {
      results.push(finding(
        'buried_critical_rule', 'recommended',
        'Critical rule buried in middle',
        `Line ${line}/${totalLines}: LLMs pay less attention to content in the middle of long documents. Move critical rules to the top or bottom.`,
        file, trunc(text), line,
        `Move to the top 30% or bottom 30% of the file.`,
      ));
    }
  }
  return results.slice(0, 3);
}

/** A7. Duplicate rules — near-identical rules waste context. */
function checkDuplicateRules(parsed: ParseResult): LintFinding[] {
  const results: LintFinding[] = [];
  const seen = new Map<string, { text: string; source: string }>();

  for (const rule of parsed.rules) {
    const norm = normalize(rule.text);
    if (norm.length < 15) continue;
    for (const [existingNorm] of seen) {
      if (norm === existingNorm || (norm.length > 30 && existingNorm.includes(norm.slice(0, 30)))) {
        results.push(finding(
          'duplicate_rule', 'recommended',
          'Duplicate rule',
          `This rule appears twice — wastes context and can confuse the agent if wording differs slightly.`,
          rule.source, trunc(rule.text), undefined,
          `Remove the duplicate. Keep the more specific version.`,
        ));
        break;
      }
    }
    seen.set(norm, { text: rule.text, source: rule.source });
  }
  return results.slice(0, 5);
}

/** A8. Rule contradiction — two rules that conflict on the same topic. */
function checkRuleContradictions(parsed: ParseResult): LintFinding[] {
  const results: LintFinding[] = [];
  const positiveRules: Array<{ text: string; source: string; topics: Set<string> }> = [];
  const negativeRules: Array<{ text: string; source: string; topics: Set<string> }> = [];
  const negMarkers = [/\bnever\b/i, /\bdon'?t\b/i, /\bdo not\b/i, /\bavoid\b/i, /\baldrig\b/i, /\bundgå\b/i];
  const posMarkers = [/\balways\b/i, /\bmust\b/i, /\baltid\b/i, /\bskal\b/i];

  for (const rule of parsed.rules) {
    const topics = topicWords(rule.text);
    if (topics.size < 2) continue;
    const isNeg = negMarkers.some(p => p.test(rule.text));
    const isPos = posMarkers.some(p => p.test(rule.text));
    if (isNeg) negativeRules.push({ text: rule.text, source: rule.source, topics });
    if (isPos) positiveRules.push({ text: rule.text, source: rule.source, topics });
  }

  for (const neg of negativeRules) {
    for (const pos of positiveRules) {
      if (neg.text === pos.text) continue;
      const sim = jaccard(neg.topics, pos.topics);
      if (sim >= 0.5) {
        results.push(finding(
          'rule_contradiction', 'recommended',
          'Possible rule contradiction',
          `These rules may conflict — one says "always/must" and the other says "never/don't" about similar topics. The agent may be confused about which to follow.`,
          neg.source,
          `"${trunc(neg.text, 40)}" vs "${trunc(pos.text, 40)}"`,
          undefined,
          `Reconcile: make them complementary or remove one.`,
        ));
      }
    }
  }
  return results.slice(0, 3);
}

/** A9. Escape hatch missing — NEVER/ALWAYS without "unless user explicitly asks". */
function checkEscapeHatchMissing(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const absoluteP = [/\bnever\b/i, /\balways\b/i, /\baldrig\b/i, /\baltid\b/i];
  const escapeP = [/\bunless\b/i, /\bexcept\b/i, /\bmedmindre\b/i, /\bundtagen\b/i, /\bif.*explicitly/i, /\bwhen.*ask/i];

  let count = 0;
  for (const { line, text } of indexedLines(content)) {
    if (count >= 3) break;
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (!absoluteP.some(p => p.test(text))) continue;
    if (escapeP.some(p => p.test(text))) continue;
    // Skip short rules — they're caught by ambiguous_rule
    if (text.length < 30) continue;

    results.push(finding(
      'escape_hatch_missing', 'nice_to_have',
      'Absolute rule without escape hatch',
      `NEVER/ALWAYS rules without an escape clause can trap the agent when the user explicitly wants an exception.`,
      file, trunc(text), line,
      `Add "unless explicitly asked" or "except when..." to give the agent a way out.`,
    ));
    count++;
  }
  return results;
}

/** A10. Compound instruction — multi-clause single rule that's hard to follow. */
function checkCompoundInstructions(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const conjunctions = /\b(and then|and also|, and\b|, then\b|; also\b|; then\b|og derefter|og også|, og\b|; dernæst)/gi;

  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    const matches = text.match(conjunctions);
    if (matches && matches.length >= 2) {
      results.push(finding(
        'compound_instruction', 'nice_to_have',
        'Compound instruction (multiple clauses)',
        `This rule chains ${matches.length + 1} actions in one bullet. Multi-step rules are easy to partially follow — the agent may do the first step and forget the rest.`,
        file, trunc(text), line,
        `Split into separate bullet points — one action per rule.`,
      ));
    }
  }
  return results.slice(0, 3);
}

/** A11. Naked conditional — "If X" without specifying what happens otherwise. */
function checkNakedConditionals(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);
  const ifPattern = /^\s*[-*]\s+(?:if|when|hvis|når)\b/i;
  const elsePattern = /\b(otherwise|else|if not|ellers|alternativt)\b/i;

  for (const { line, text } of lines) {
    if (!ifPattern.test(text)) continue;
    if (elsePattern.test(text)) continue;
    // Check next line for "else" clause
    const nextLine = lines.find(l => l.line === line + 1);
    if (nextLine && elsePattern.test(nextLine.text)) continue;

    results.push(finding(
      'naked_conditional', 'nice_to_have',
      'Conditional without else clause',
      `"If X, do Y" — but what should the agent do when X is NOT true? Without an else clause, the agent guesses.`,
      file, trunc(text), line,
      `Add what happens otherwise: "If X, do Y. Otherwise, do Z."`,
    ));
  }
  return results.slice(0, 3);
}

/** A12. Mental notes — "remember to", "keep in mind" (LLMs can't hold mental state). */
function checkMentalNotes(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  for (const { line, text } of indexedLines(content)) {
    for (const pattern of MENTAL_NOTE_PATTERNS) {
      if (pattern.test(text)) {
        const match = text.match(pattern);
        results.push(finding(
          'mental_note', 'recommended',
          `Mental note: "${match?.[0]}"`,
          `LLMs don't have persistent memory within a conversation. "Remember to X" doesn't work — make it a direct instruction: "Do X when Y."`,
          file, trunc(text), line,
          `Rewrite as a conditional action: "When Y happens, do X."`,
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}

/** A13. Ambiguous pronouns — "it", "this", "that" at start of rule without clear reference. */
function checkAmbiguousPronouns(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const pronounStart = /^\s*[-*]\s+(it |this |that |these |those |den |det |disse |de )/i;

  for (const { line, text } of indexedLines(content)) {
    if (!pronounStart.test(text)) continue;
    // Allow if the pronoun is followed by a clear referent in quotes or backticks
    if (/["'`]/.test(text.slice(0, 30))) continue;
    results.push(finding(
      'ambiguous_pronoun', 'nice_to_have',
      'Rule starts with ambiguous pronoun',
      `Starting a rule with "it/this/that" requires the reader to look backwards for context. Name the subject explicitly.`,
      file, trunc(text), line,
      `Replace the pronoun with the actual subject: "The build must..." instead of "It must..."`,
    ));
  }
  return results.slice(0, 3);
}

/** A14. Compressible padding — "Always remember to", "Make sure to" (filler before the real instruction). */
function checkCompressiblePadding(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  for (const { line, text } of indexedLines(content)) {
    const lower = text.toLowerCase();
    for (const phrase of COMPRESSIBLE_PADDING) {
      if (lower.includes(phrase)) {
        results.push(finding(
          'compressible_padding', 'nice_to_have',
          `Compressible padding: "${phrase}"`,
          `"${phrase}" adds words before the real instruction without changing its meaning. Tokens are limited — get to the point.`,
          file, trunc(text), line,
          `Remove the padding. "Make sure to run tests" → "Run tests."`,
        ));
        break;
      }
    }
  }
  return results.slice(0, 5);
}

// ============================================================================
// B. DOCUMENT STRUCTURE (9 checks)
// ============================================================================

/** B1. File too long — >500 lines wastes context, important rules get lost. */
function checkFileTooLong(content: string, file: string): LintFinding[] {
  const lineCount = content.split('\n').length;
  if (lineCount <= 500) return [];
  return [finding(
    'file_too_long', lineCount > 800 ? 'critical' : 'recommended',
    `CLAUDE.md is ${lineCount} lines`,
    `Long files cause important rules to get lost (the "lost in the middle" effect). Most effective setups are under 200 lines.`,
    file, `${lineCount} lines total`, undefined,
    `Move project-specific details to project CLAUDE.md files. Move reference data to memory files.`,
  )];
}

/** B2. Long sections without sub-headers — walls of text are hard to parse. */
function checkLongSections(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = content.split('\n');
  let sectionStart = 0, sectionHeader = '', linesSinceHeader = 0, hasSubHeader = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^#{3,}\s+/.test(lines[i])) { hasSubHeader = true; continue; }
    const headerMatch = lines[i].match(/^(#{1,2})\s+(.+)/);
    if (headerMatch) {
      if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
        results.push(finding('long_section_no_headers', 'nice_to_have',
          `Long section without sub-headers: "${trunc(sectionHeader, 40)}"`,
          `${linesSinceHeader} lines without structure. Break into sub-sections for better comprehension.`,
          file, `"${trunc(sectionHeader, 40)}" — ${linesSinceHeader} lines`, sectionStart + 1,
          `Add ### sub-headers to break up the content.`,
        ));
      }
      sectionStart = i; sectionHeader = headerMatch[2]; linesSinceHeader = 0; hasSubHeader = false;
    } else {
      linesSinceHeader++;
    }
  }
  if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
    results.push(finding('long_section_no_headers', 'nice_to_have',
      `Long section without sub-headers: "${trunc(sectionHeader, 40)}"`,
      `${linesSinceHeader} lines without structure.`,
      file, `"${trunc(sectionHeader, 40)}" — ${linesSinceHeader} lines`, sectionStart + 1,
      `Add ### sub-headers to break up the content.`,
    ));
  }
  return results.slice(0, 3);
}

/** B3. Empty sections — headers with no meaningful content. */
// R4 (calibration study): these are structural / navigational headers that
// conventionally have little or no prose directly under them — the content
// arrives via sub-sections or bullet lists. Flagging them adds report noise
// on 77 of 50 corpus files with zero real false-negative risk.
const CONVENTION_SECTION_TITLES = /^(overview|introduction|getting started|project overview|table of contents|toc|contents|index)$/i;

function checkEmptySections(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    const headerMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (!headerMatch) continue;
    const sectionTitle = headerMatch[2].trim();
    let j = i + 1, hasContent = false, innerCodeBlock = false;
    while (j < lines.length) {
      if (/^```/.test(lines[j].trim())) innerCodeBlock = !innerCodeBlock;
      const trimmed = lines[j].trim();
      if (trimmed === '') { j++; continue; }
      if (!innerCodeBlock && /^#{1,3}\s+/.test(trimmed)) break;
      hasContent = true; break;
    }
    if (!hasContent) {
      // R4: suppress convention-named sections that are structurally meant
      // to sit on top of sub-headings (Overview, Table of Contents, etc.).
      if (CONVENTION_SECTION_TITLES.test(sectionTitle)) continue;
      results.push(finding('empty_section', 'nice_to_have',
        `Empty section: "${headerMatch[2]}"`,
        `Section has a header but no content. Either fill it or remove the placeholder.`,
        file, lines[i], i + 1, `Add content or remove the empty section.`,
      ));
    }
  }
  return results;
}

/** B4. Redundant stack info — "We use React" when it's in package.json. */
function checkRedundantStackInfo(content: string, file: string, scanRoots: string[]): LintFinding[] {
  const results: LintFinding[] = [];
  let hasPkgJson = false;
  for (const root of scanRoots) {
    try { if (existsSync(resolve(root, 'package.json'))) hasPkgJson = true; } catch { /* skip */ }
  }
  if (!hasPkgJson) return results;

  const patterns = [
    /we use (react|next\.?js|vue|angular|svelte|express|fastify|node)/i,
    /our (tech )?stack (is|includes)/i,
    /built with (react|next\.?js|vue|angular|typescript|node)/i,
    /vi bruger (react|next\.?js|vue|angular|svelte|express|node)/i,
    /bygget med (react|next\.?js|vue|angular|typescript|node)/i,
  ];
  for (const { line, text } of indexedLines(content)) {
    for (const p of patterns) {
      if (p.test(text)) {
        results.push(finding('redundant_stack_info', 'nice_to_have',
          'Redundant stack info',
          `This is inferrable from package.json. The agent can read your dependencies directly.`,
          file, trunc(text), line,
          `Remove — the agent reads package.json. Only document stack choices that aren't obvious from code.`,
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}

/** B5. README/CLAUDE.md overlap — >30% of CLAUDE.md lines appear in README.md. */
function checkReadmeOverlap(content: string, file: string, scanRoots: string[]): LintFinding[] {
  // Find README.md in scan roots
  let readmeContent: string | null = null;
  for (const root of scanRoots) {
    for (const name of ['README.md', 'readme.md', 'Readme.md']) {
      const p = resolve(root, name);
      try { if (existsSync(p)) { readmeContent = readFileSync(p, 'utf-8'); break; } } catch { /* skip */ }
    }
    if (readmeContent) break;
  }
  if (!readmeContent) return [];

  const claudeLines = new Set(content.split('\n').map(l => l.trim()).filter(l => l.length > 20));
  const readmeLines = new Set(readmeContent.split('\n').map(l => l.trim()).filter(l => l.length > 20));
  if (claudeLines.size === 0) return [];

  let overlap = 0;
  for (const line of claudeLines) if (readmeLines.has(line)) overlap++;
  const ratio = overlap / claudeLines.size;

  if (ratio >= 0.3) {
    return [finding('readme_overlap', 'recommended',
      `${Math.round(ratio * 100)}% overlap with README.md`,
      `${overlap} of ${claudeLines.size} non-trivial lines in CLAUDE.md also appear in README.md. This wastes context — the agent can read README.md directly.`,
      file, `${overlap} overlapping lines`, undefined,
      `Remove duplicated content. Reference README.md instead of copying from it.`,
    )];
  }
  return [];
}

/** B6. Unclosed code block — odd number of ``` markers means malformed markdown. */
function checkUnclosedCodeBlocks(content: string, file: string): LintFinding[] {
  const fenceMarkers = content.split('\n').filter(l => /^```/.test(l.trim()));
  if (fenceMarkers.length % 2 !== 0) {
    return [finding('unclosed_code_block', 'recommended',
      'Unclosed code block',
      `Found ${fenceMarkers.length} fence markers (\`\`\`) — odd number means one is unclosed. Everything after the unclosed block may be misinterpreted as code.`,
      file, `${fenceMarkers.length} fence markers`, undefined,
      `Find and close the unclosed code block.`,
    )];
  }
  return [];
}

/** B7. Section balance — >60% of rules in one domain, 0 in another. */
function checkSectionBalance(parsed: ParseResult): LintFinding[] {
  if (parsed.rules.length < 10) return [];

  const byType: Record<string, number> = { do_autonomously: 0, ask_first: 0, suggest_only: 0, prohibition: 0 };
  for (const rule of parsed.rules) byType[rule.type] = (byType[rule.type] || 0) + 1;

  const total = parsed.rules.length;
  const results: LintFinding[] = [];

  for (const [type, count] of Object.entries(byType)) {
    if (count / total > 0.6) {
      results.push(finding('section_balance', 'recommended',
        `Rule imbalance: ${Math.round(count / total * 100)}% are ${type.replace(/_/g, ' ')}`,
        `${count} of ${total} rules are ${type.replace(/_/g, ' ')}. A balanced setup needs a mix of do/ask/suggest/prohibit rules.`,
        'CLAUDE.md', `${count}/${total} rules = ${type}`, undefined,
        `Add rules for the under-represented categories.`,
      ));
    }
    // Flag if a category has 0 rules while total > 15
    if (count === 0 && total > 15 && type !== 'suggest_only') {
      results.push(finding('section_balance', 'nice_to_have',
        `No ${type.replace(/_/g, ' ')} rules defined`,
        `Your setup has ${total} rules but none in the "${type.replace(/_/g, ' ')}" category. This creates blind spots.`,
        'CLAUDE.md', `0/${total} rules for ${type}`, undefined,
        `Add at least a few rules for ${type.replace(/_/g, ' ')}.`,
      ));
    }
  }
  return results.slice(0, 2);
}

/** B8. Missing update date — no date/version indicator in CLAUDE.md. */
function checkMissingUpdateDate(content: string, file: string): LintFinding[] {
  const datePatterns = [
    /\b20\d{2}[-/]\d{2}[-/]\d{2}\b/, // 2026-04-16
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+20\d{2}\b/i,
    /\bv\d+\.\d+/i, // v1.0
    /\bupdated?\b.*\b20\d{2}\b/i,
    /\blast (?:updated|modified|changed)\b/i,
  ];
  if (datePatterns.some(p => p.test(content))) return [];
  if (content.split('\n').length < 30) return []; // too short to need a date

  return [finding('missing_update_date', 'nice_to_have',
    'No update date or version',
    `CLAUDE.md has no date or version indicator. Over time, it's hard to tell if instructions are current or stale.`,
    file, 'No date/version pattern found', undefined,
    `Add a comment like "# Last updated: 2026-04-16" at the top.`,
  )];
}

/** B9. Priority signal missing — multi-rule section without ordering/priority. */
function checkPrioritySignalMissing(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const sections: Array<{ header: string; line: number; bulletCount: number; hasPriority: boolean }> = [];
  const lines = content.split('\n');
  let current: typeof sections[0] | null = null;
  const priorityP = [/\b(first|most important|priority|top|critical|highest)\b/i, /\b(først|vigtigst|priorit)\b/i, /\b[1-3]\.\s/];

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { header: headerMatch[2], line: i + 1, bulletCount: 0, hasPriority: false };
    } else if (current) {
      if (/^\s*[-*]\s+/.test(lines[i])) current.bulletCount++;
      if (priorityP.some(p => p.test(lines[i]))) current.hasPriority = true;
    }
  }
  if (current) sections.push(current);

  for (const s of sections) {
    if (s.bulletCount >= 8 && !s.hasPriority) {
      results.push(finding('priority_signal_missing', 'nice_to_have',
        `Section "${trunc(s.header, 30)}" has ${s.bulletCount} rules without priority`,
        `When a section has many rules without ordering, the agent treats them all as equally important. Mark the most critical ones.`,
        file, `${s.bulletCount} bullets, no priority signal`, s.line,
        `Add "Most important:" at the top, or number the top 3 rules.`,
      ));
    }
  }
  return results.slice(0, 2);
}

// ============================================================================
// C. REFERENCES & PATHS (7 checks)
// ============================================================================

/** C1. Broken file references — paths mentioned that don't exist on disk. */
function checkBrokenFileRefs(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const seen = new Set<string>();
  const pathPattern = /(?:^|[\s`"'(])(\/(Users|home|opt|var|etc)[^\s`"')]+)/g;

  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(pathPattern)) {
      const refPath = match[1];
      if (seen.has(refPath)) continue;
      seen.add(refPath);
      if (/^https?:/.test(refPath) || refPath.includes('*') || refPath.includes('{')) continue;
      if (!existsSync(refPath)) {
        results.push(finding('broken_file_ref', 'recommended',
          'Broken file reference',
          `Path "${trunc(refPath, 60)}" does not exist. The agent will waste time looking for it.`,
          file, trunc(text), line, `Remove or update the path.`,
        ));
      }
    }
  }
  return results.slice(0, 10);
}

/** C2. Broken markdown links — [text](path) where path doesn't exist. */
function checkBrokenMarkdownLinks(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const fileDir = dirname(file);
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const [, linkText, linkTarget] = match;
      if (/^(https?:|mailto:|#)/.test(linkTarget)) continue;
      if (!existsSync(resolve(fileDir, linkTarget))) {
        results.push(finding('broken_markdown_link', 'recommended',
          `Broken link: [${trunc(linkText, 30)}]`,
          `Link target "${linkTarget}" does not exist relative to ${file}.`,
          file, trunc(text), line, `Update the link target or remove the link.`,
        ));
      }
    }
  }
  return results.slice(0, 10);
}

/** C3. Hardcoded user paths — platform-specific paths reduce portability. */
function checkHardcodedPaths(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const seenUsers = new Set<string>();
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+/g)) {
      if (seenUsers.has(match[0])) continue;
      seenUsers.add(match[0]);
      results.push(finding('hardcoded_user_path', 'nice_to_have',
        `Hardcoded user path: ${match[0]}`,
        `Platform-specific paths break when shared across machines. Use ~ or relative paths.`,
        file, trunc(text), line, `Replace with ~ or $HOME.`,
      ));
    }
  }
  return results.slice(0, 1);
}

/** C4. Stale tool references — MCP tools mentioned but not installed. */
function checkStaleToolRefs(content: string, file: string, installedServers: string[]): LintFinding[] {
  const results: LintFinding[] = [];
  const seen = new Set<string>();
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/mcp__(\w+)__/g)) {
      const server = match[1].toLowerCase();
      if (seen.has(server)) continue;
      seen.add(server);
      if (!installedServers.includes(server)) {
        results.push(finding('stale_tool_ref', 'recommended',
          `Stale MCP reference: ${server}`,
          `CLAUDE.md references MCP server "${server}" but it's not installed. The agent may try to use tools that don't exist.`,
          file, trunc(text), line, `Install the server or remove the reference.`,
        ));
      }
    }
  }
  return results;
}

/** C5. Stale tool ref (reverse) — MCP server installed but never mentioned anywhere. */
function checkStaleToolRefReverse(allContent: string, installedServers: string[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const server of installedServers) {
    if (allContent.includes(`mcp__${server}__`) || allContent.includes(server)) continue;
    results.push(finding('stale_tool_ref_reverse', 'nice_to_have',
      `Installed MCP server never referenced: ${server}`,
      `Server "${server}" is installed but not mentioned in CLAUDE.md. The agent may not know when to use it.`,
      'MCP config', server, undefined,
      `Add a note in CLAUDE.md about when to use ${server}, or uninstall if unused.`,
    ));
  }
  return results.slice(0, 5);
}

/**
 * C6. Dead command references — mentions scripts/binaries that don't exist on PATH or disk.
 *
 * NOTE (R5, calibration study 2026-04-22): this check reads the local
 * filesystem via existsSync. That is intentional for the lived-in Dear User
 * workflow where the user scans their own `~/.claude/` and local repo paths.
 * It is NOT a bug that this finding fires on synthetic corpus runs, CI
 * sandboxes, or when scoring someone else's repo — a path like
 * `./scripts/deploy.sh` cannot be validated without the author's filesystem.
 * Treat findings here as advisory for any scan that didn't originate on the
 * author's machine. We keep severity `recommended` because on a real local
 * scan a dead reference is a genuine agent footgun.
 */
function checkDeadCommandRefs(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  // Match inline code that looks like a command invocation
  const cmdPattern = /`((?:\.\/|~\/|\/)[^\s`]+(?:\s[^\s`]*)?)`/g;

  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(cmdPattern)) {
      const cmd = match[1].split(/\s/)[0]; // first word = executable
      const expanded = cmd.replace(/^~/, homedir());
      if (expanded.includes('*') || expanded.includes('{')) continue; // globs
      try {
        if (!existsSync(expanded)) {
          results.push(finding('dead_command_ref', 'recommended',
            `Referenced command may not exist: ${trunc(cmd, 40)}`,
            `CLAUDE.md references "${cmd}" but the file doesn't exist. The agent will fail when trying to run it.`,
            file, trunc(text), line, `Update the path or remove the reference.`,
          ));
        }
      } catch { /* skip unparseable paths */ }
    }
  }
  return results.slice(0, 5);
}

/** C7. Wrong abstraction — style rules that should be linter/formatter configs. */
function checkWrongAbstraction(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    for (const pattern of LINTER_CONFIG_PATTERNS) {
      if (pattern.test(text)) {
        results.push(finding('wrong_abstraction', 'nice_to_have',
          'Style rule belongs in a formatter config',
          `This formatting rule is better enforced by a tool (Prettier, ESLint, etc.) than by an instruction. The agent may not follow it consistently.`,
          file, trunc(text), line,
          `Move to .prettierrc / .eslintrc. Code formatting rules in CLAUDE.md waste context and are unreliable.`,
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}

// ============================================================================
// D. MEMORY QUALITY (6 checks)
// ============================================================================

/** D1. Memory stale — memory file >90 days without update. */
function checkMemoryStale(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  for (const mf of memoryFiles) {
    if (basename(mf.path) === 'MEMORY.md') continue; // index file, not a memory
    if (!mf.lastModified) continue;
    const age = now - new Date(mf.lastModified).getTime();
    if (age > ninetyDays) {
      const days = Math.round(age / (24 * 60 * 60 * 1000));
      results.push(finding('memory_stale', 'nice_to_have',
        `Stale memory: ${basename(mf.path)} (${days} days old)`,
        `This memory file hasn't been updated in ${days} days. Old memories may contain outdated information that misleads the agent.`,
        mf.path, trunc(mf.content.split('\n')[0] || '', 60), undefined,
        `Review and update, or remove if no longer relevant.`,
      ));
    }
  }
  return results.slice(0, 5);
}

/** D2. Memory orphan — file exists in memory dir but isn't in MEMORY.md index. */
function checkMemoryOrphan(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  const indexFile = memoryFiles.find(f => basename(f.path) === 'MEMORY.md');
  if (!indexFile) return [];
  const indexContent = indexFile.content.toLowerCase();

  for (const mf of memoryFiles) {
    const name = basename(mf.path);
    if (name === 'MEMORY.md') continue;
    if (!indexContent.includes(name.toLowerCase())) {
      results.push(finding('memory_orphan', 'nice_to_have',
        `Memory not indexed: ${name}`,
        `This memory file exists but isn't listed in MEMORY.md. The agent may not find it when loading context.`,
        mf.path, trunc(mf.content.split('\n')[0] || '', 60), undefined,
        `Add an entry in MEMORY.md: "- [Title](${name}) — one-line description"`,
      ));
    }
  }
  return results.slice(0, 5);
}

/** D3. Memory index orphan — entry in MEMORY.md points to a file that doesn't exist. */
function checkMemoryIndexOrphan(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  const indexFile = memoryFiles.find(f => basename(f.path) === 'MEMORY.md');
  if (!indexFile) return [];
  const indexDir = dirname(indexFile.path);

  for (const match of indexFile.content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const [, linkText, linkTarget] = match;
    if (/^https?:/.test(linkTarget)) continue;
    const resolved = resolve(indexDir, linkTarget);
    if (!existsSync(resolved)) {
      results.push(finding('memory_index_orphan', 'recommended',
        `Dead memory link: [${trunc(linkText, 30)}]`,
        `MEMORY.md references "${linkTarget}" but the file doesn't exist. This is a broken pointer in your memory index.`,
        indexFile.path, trunc(`[${linkText}](${linkTarget})`), undefined,
        `Remove the entry from MEMORY.md or restore the file.`,
      ));
    }
  }
  return results.slice(0, 5);
}

/** D4. Memory too large — individual memory file >5KB (should be concise). */
function checkMemoryTooLarge(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const mf of memoryFiles) {
    if (basename(mf.path) === 'MEMORY.md') continue;
    if (mf.size > 5120) {
      results.push(finding('memory_too_large', 'nice_to_have',
        `Large memory file: ${basename(mf.path)} (${Math.round(mf.size / 1024)}KB)`,
        `Memory files should be concise (under 5KB). Large files waste context and may contain data better suited for a database.`,
        mf.path, `${Math.round(mf.size / 1024)}KB`, undefined,
        `Split into smaller, focused memories — or move structured data to a database/JSONL file.`,
      ));
    }
  }
  return results.slice(0, 3);
}

/** D5. Memory duplicate — two memory files with >60% text overlap. */
function checkMemoryDuplicate(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  const memories = memoryFiles.filter(f => basename(f.path) !== 'MEMORY.md' && f.content.length > 50);

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const aWords = topicWords(memories[i].content);
      const bWords = topicWords(memories[j].content);
      const sim = jaccard(aWords, bWords);
      if (sim >= 0.6) {
        results.push(finding('memory_duplicate', 'recommended',
          `Possible duplicate memories`,
          `"${basename(memories[i].path)}" and "${basename(memories[j].path)}" have ${Math.round(sim * 100)}% topic overlap. Duplicates waste context.`,
          memories[i].path,
          `${basename(memories[i].path)} ↔ ${basename(memories[j].path)} (${Math.round(sim * 100)}% similar)`,
          undefined,
          `Merge into one file and remove the duplicate.`,
        ));
      }
    }
  }
  return results.slice(0, 3);
}

/** D6. Memory missing frontmatter — memory file without name/type/description. */
function checkMemoryMissingFrontmatter(memoryFiles: FileInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const mf of memoryFiles) {
    if (basename(mf.path) === 'MEMORY.md') continue;
    const fmMatch = mf.content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      results.push(finding('memory_missing_frontmatter', 'nice_to_have',
        `Memory without frontmatter: ${basename(mf.path)}`,
        `Memory files need frontmatter (name, type, description) so the system knows when to load them.`,
        mf.path, trunc(mf.content.split('\n')[0] || '', 60), undefined,
        `Add frontmatter: ---\\nname: ...\\ntype: feedback|user|project|reference\\ndescription: ...\\n---`,
      ));
    } else {
      const fm = fmMatch[1];
      const missing: string[] = [];
      if (!/^name:/m.test(fm)) missing.push('name');
      if (!/^type:/m.test(fm)) missing.push('type');
      if (!/^description:/m.test(fm)) missing.push('description');
      if (missing.length > 0) {
        results.push(finding('memory_missing_frontmatter', 'nice_to_have',
          `Memory frontmatter incomplete: ${basename(mf.path)}`,
          `Missing fields: ${missing.join(', ')}. Complete frontmatter helps the system decide when this memory is relevant.`,
          mf.path, `Missing: ${missing.join(', ')}`, undefined,
          `Add the missing fields to the frontmatter block.`,
        ));
      }
    }
  }
  return results.slice(0, 5);
}

// ============================================================================
// E. HOOK QUALITY (5 checks)
// ============================================================================

/** E1. Hook dangerous command — rm -rf, curl|sh, chmod 777, git push --force. */
function checkHookDangerousCommands(hooks: ParsedHook[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const hook of hooks) {
    for (const pattern of DANGEROUS_HOOK_COMMANDS) {
      if (pattern.test(hook.command)) {
        results.push(finding('hook_dangerous_command', 'critical',
          `Dangerous command in hook: ${hook.event}`,
          `Hook runs "${trunc(hook.command, 50)}" which matches a dangerous pattern. This could cause data loss if triggered unexpectedly.`,
          hook.source, trunc(hook.command, 60), undefined,
          `Add safeguards (confirmation, --dry-run) or remove the hook.`,
        ));
        break;
      }
    }
  }
  return results.slice(0, 5);
}

/** E2. Hook missing condition — hook without matcher/event filter fires on everything. */
function checkHookMissingCondition(hooks: ParsedHook[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const hook of hooks) {
    if (!hook.matcher) {
      results.push(finding('hook_missing_condition', 'nice_to_have',
        `Hook without matcher: ${hook.event}`,
        `This hook fires on every ${hook.event} event with no filter. If the command is expensive, it slows down every operation.`,
        hook.source, trunc(hook.command, 60), undefined,
        `Add a "matcher" to limit when this hook runs.`,
      ));
    }
  }
  return results.slice(0, 3);
}

/** E3. Hook unquoted variable — $ARGUMENTS or $INPUT without quotes = injection risk. */
function checkHookUnquotedVariable(hooks: ParsedHook[]): LintFinding[] {
  const results: LintFinding[] = [];
  const unquotedVar = /(?<!")(\$(?:ARGUMENTS|INPUT|FILE_PATH|TOOL_NAME))(?!")/;

  for (const hook of hooks) {
    const match = hook.command.match(unquotedVar);
    if (match) {
      // Check it's not inside quotes
      const idx = hook.command.indexOf(match[1]);
      const before = hook.command.slice(0, idx);
      const quoteCount = (before.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) { // not inside quotes
        results.push(finding('hook_unquoted_variable', 'recommended',
          `Unquoted variable in hook: ${match[1]}`,
          `${match[1]} is not quoted. If it contains spaces or special characters, the shell will split it — which is a potential injection vector.`,
          hook.source, trunc(hook.command, 60), undefined,
          `Wrap in double quotes: "${match[1]}"`,
        ));
      }
    }
  }
  return results.slice(0, 3);
}

/** E4. Hook no timeout — hook without timeout can hang indefinitely. */
function checkHookNoTimeout(hooks: ParsedHook[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const hook of hooks) {
    if (!hook.timeout) {
      // Only flag hooks with potentially slow commands
      const slowPatterns = [/\bcurl\b/, /\bwget\b/, /\bnpm\b/, /\bgit\b/, /\bfetch\b/, /\bhttp/];
      if (slowPatterns.some(p => p.test(hook.command))) {
        results.push(finding('hook_no_timeout', 'nice_to_have',
          `Hook without timeout: ${hook.event}`,
          `This hook runs a network/build command without a timeout. If the command hangs, it blocks the entire session.`,
          hook.source, trunc(hook.command, 60), undefined,
          `Add "timeout" (in milliseconds) to the hook config.`,
        ));
      }
    }
  }
  return results.slice(0, 3);
}

/** E5. Hook stale tool ref — hook references a tool that isn't installed. */
function checkHookStaleToolRef(hooks: ParsedHook[], installedServers: string[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const hook of hooks) {
    for (const match of hook.command.matchAll(/mcp__(\w+)__/g)) {
      const server = match[1].toLowerCase();
      if (!installedServers.includes(server)) {
        results.push(finding('hook_stale_tool_ref', 'recommended',
          `Hook references uninstalled MCP server: ${server}`,
          `Hook in ${hook.event} calls mcp__${server}__ but that server isn't installed. The hook will fail silently.`,
          hook.source, trunc(hook.command, 60), undefined,
          `Install the MCP server or update the hook command.`,
        ));
      }
    }
  }
  return results.slice(0, 3);
}

// ============================================================================
// F. SKILL QUALITY (5 checks)
// ============================================================================

/** F1. Skill missing frontmatter — SKILL.md without name/description. */
function checkSkillMissingFrontmatter(skills: SkillInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const skill of skills) {
    if (!skill.hasFrontmatter) {
      results.push(finding('skill_missing_frontmatter', 'recommended',
        `Skill without frontmatter: ${skill.name}`,
        `SKILL.md needs frontmatter (name, description) for Claude Code to discover and describe the skill correctly.`,
        skill.path, trunc(skill.content.split('\n')[0] || '', 60), undefined,
        `Add frontmatter: ---\\nname: ${skill.name}\\ndescription: ...\\n---`,
      ));
    } else if (!skill.frontmatterName || !skill.frontmatterDescription) {
      const missing = [!skill.frontmatterName && 'name', !skill.frontmatterDescription && 'description'].filter(Boolean);
      results.push(finding('skill_missing_frontmatter', 'nice_to_have',
        `Skill frontmatter incomplete: ${skill.name}`,
        `Missing: ${missing.join(', ')}. Incomplete frontmatter affects skill discovery and routing.`,
        skill.path, `Missing: ${missing.join(', ')}`, undefined,
        `Add the missing fields to the frontmatter block.`,
      ));
    }
  }
  return results.slice(0, 5);
}

/** F2. Skill vague name — generic names like "helper", "utils", "tool". */
function checkSkillVagueName(skills: SkillInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const skill of skills) {
    if (VAGUE_SKILL_NAMES.includes(skill.name.toLowerCase())) {
      results.push(finding('skill_vague_name', 'recommended',
        `Vague skill name: "${skill.name}"`,
        `Generic names make it hard for the agent to route tasks to the right skill. Use a specific, descriptive name.`,
        skill.path, skill.name, undefined,
        `Rename to describe what the skill does: "deploy-frontend" instead of "helper".`,
      ));
    }
  }
  return results;
}

/** F3. Skill prompt too short — prompt body <100 chars is unlikely to be useful. */
function checkSkillPromptTooShort(skills: SkillInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  for (const skill of skills) {
    // Strip frontmatter to get prompt body
    const body = skill.content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    if (body.length < 100 && body.length > 0) {
      results.push(finding('skill_prompt_too_short', 'nice_to_have',
        `Skill prompt very short: ${skill.name} (${body.length} chars)`,
        `A ${body.length}-character prompt is unlikely to provide enough context for the agent to execute the skill well.`,
        skill.path, trunc(body, 60), undefined,
        `Add more detail: what should the skill do step by step? What are the constraints?`,
      ));
    }
  }
  return results.slice(0, 3);
}

/** F4. Skill unrestricted Bash — plain "Bash" in allowedTools without scoping. */
function checkSkillUnrestrictedBash(skills: SkillInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  // Check for allowed_tools or allowedTools mentioning plain Bash
  const unrestrictedPattern = /(?:allowed_?[Tt]ools|allowedTools)\s*[=:]\s*\[?\s*["']?Bash["']?\s*[\],]/;

  for (const skill of skills) {
    if (unrestrictedPattern.test(skill.content)) {
      results.push(finding('skill_unrestricted_bash', 'recommended',
        `Skill has unrestricted Bash access: ${skill.name}`,
        `Plain "Bash" in allowedTools lets the skill run any command. Scope it: "Bash(git:*)" or "Bash(npm:*)".`,
        skill.path, 'allowedTools: ["Bash"]', undefined,
        `Replace with scoped access: "Bash(git:*, npm:*)" — only the commands the skill needs.`,
      ));
    }
  }
  return results;
}

/** F5. Skill dangerous name without safety guard — delete-*, deploy-*, push-* skills. */
function checkSkillDangerousNameNoGuard(skills: SkillInfo[]): LintFinding[] {
  const results: LintFinding[] = [];
  const dangerousPatterns = [/^delete/i, /^remove/i, /^drop/i, /^deploy/i, /^push/i, /^publish/i, /^release/i];
  const safetySignals = [/confirm/i, /--dry-run/i, /are you sure/i, /double.?check/i, /verify/i, /preview/i];

  for (const skill of skills) {
    if (!dangerousPatterns.some(p => p.test(skill.name))) continue;
    if (safetySignals.some(p => p.test(skill.content))) continue;
    results.push(finding('skill_dangerous_name_no_guard', 'recommended',
      `Dangerous skill without safety: ${skill.name}`,
      `Skills named "${skill.name}" should include a confirmation step or dry-run option to prevent accidental execution.`,
      skill.path, skill.name, undefined,
      `Add a confirmation step: "Before executing, list what will be affected and ask for confirmation."`,
    ));
  }
  return results;
}

// ============================================================================
// G. COMPLETENESS (4 checks)
// ============================================================================

/** G1. Missing verification — no test/build/verify instructions in quality section. */
function checkMissingVerification(parsed: ParseResult, content: string): LintFinding[] {
  const verifyP = [/\btest\b/i, /\bbuild\b/i, /\bverif/i, /\blint\b/i, /\bci\b/i, /\btjek\b/i, /\bbyg\b/i];
  if (verifyP.some(p => p.test(content))) return [];
  if (parsed.sections.length < 3) return []; // too minimal to flag

  return [finding('missing_verification', 'recommended',
    'No verification or testing instructions',
    `CLAUDE.md doesn't mention testing, building, or verification. Without this, the agent ships code without quality checks.`,
    'CLAUDE.md', 'No test/build/verify/lint keywords found', undefined,
    `Add a Quality section: "Build must pass. Run tests before committing. Verify changes work."`,
  )];
}

/** G2. Missing error handling — no error/failure/fallback instructions. */
function checkMissingErrorHandling(content: string): LintFinding[] {
  const errorP = [/\berror\b/i, /\bfail/i, /\bfallback\b/i, /\brollback\b/i, /\brecov/i, /\bfejl/i, /\bfald tilbage\b/i];
  if (errorP.some(p => p.test(content))) return [];
  if (content.split('\n').length < 30) return [];

  return [finding('missing_error_handling', 'nice_to_have',
    'No error handling instructions',
    `CLAUDE.md doesn't mention what to do when things go wrong. Without this, the agent makes its own judgment calls on errors.`,
    'CLAUDE.md', 'No error/fail/fallback/rollback keywords', undefined,
    `Add guidance: "If a build fails, fix the error before continuing. If blocked, ask the user."`,
  )];
}

/** G3. Missing handoff protocol — no session handoff or state persistence instructions. */
function checkMissingHandoffProtocol(content: string, parsed: ParseResult): LintFinding[] {
  const handoffP = [/\bsession\b/i, /\bhandoff\b/i, /\bhand.?over\b/i, /\bresume\b/i, /\bcontext\b/i, /\bsession.?start/i, /\blearn\b/i, /\bmemory\b/i];
  if (handoffP.some(p => p.test(content))) return [];
  if (parsed.sections.length < 4) return [];

  return [finding('missing_handoff_protocol', 'nice_to_have',
    'No session handoff protocol',
    `CLAUDE.md doesn't describe how to preserve context between sessions. Without this, each new session starts from zero.`,
    'CLAUDE.md', 'No session/handoff/resume/memory keywords', undefined,
    `Add: "At session end, save learnings to memory. At session start, check git status and recent changes."`,
  )];
}

/** G4. Cognitive blueprint gap — less than 4 of 6 essential elements present. */
function checkCognitiveBlueprint(parsed: ParseResult): LintFinding[] {
  // 6 elements: identity, goals, constraints, memory, planning, validation
  const checks = [
    { name: 'Identity', patterns: [/role/i, /who/i, /roller/i, /hvem/i], present: false },
    { name: 'Goals', patterns: [/goal/i, /north star/i, /mål/i, /objective/i], present: false },
    { name: 'Constraints', patterns: [/autonomy/i, /ask first/i, /never/i, /prohibition/i, /grænse/i], present: false },
    { name: 'Memory', patterns: [/memory/i, /learn/i, /remember/i, /hukommelse/i], present: false },
    { name: 'Planning', patterns: [/workflow/i, /process/i, /protocol/i, /plan/i], present: false },
    { name: 'Validation', patterns: [/quality/i, /test/i, /verify/i, /build/i, /kvalitet/i], present: false },
  ];

  const allContent = parsed.sections.map(s => s.header + ' ' + s.content).join(' ');
  for (const check of checks) {
    if (check.patterns.some(p => p.test(allContent))) check.present = true;
  }

  const present = checks.filter(c => c.present).length;
  const missing = checks.filter(c => !c.present).map(c => c.name);

  if (present >= 4) return [];

  return [finding('cognitive_blueprint_gap', present <= 2 ? 'recommended' : 'nice_to_have',
    `Cognitive blueprint: ${present}/6 elements (missing: ${missing.join(', ')})`,
    `A complete agent setup covers 6 areas: Identity, Goals, Constraints, Memory, Planning, and Validation. Yours has ${present}. Missing elements create blind spots.`,
    'CLAUDE.md', `Present: ${present}/6 — missing: ${missing.join(', ')}`, undefined,
    `Add sections for: ${missing.join(', ')}.`,
  )];
}

// ============================================================================
// Public API
// ============================================================================

const TOTAL_CHECKS = 52;

/** Run all 51 lint checks against agent config. */
export function lintClaudeMd(scanResult: ScanResult, parsed: ParseResult): LintResult {
  findingCounter = 0;
  const allFindings: LintFinding[] = [];

  // Gather CLAUDE.md files
  const files: Array<{ content: string; path: string }> = [];
  if (scanResult.globalClaudeMd) files.push({ content: scanResult.globalClaudeMd.content, path: scanResult.globalClaudeMd.path });
  if (scanResult.projectClaudeMd) files.push({ content: scanResult.projectClaudeMd.content, path: scanResult.projectClaudeMd.path });

  // Extract hooks and skills for domain-specific checks
  const hooks = extractHooksFromSettings(scanResult.settingsFiles);
  const skills = discoverSkills();
  const allContent = files.map(f => f.content).join('\n');

  // --- A. Instruction Quality (per-file) ---
  for (const { content, path } of files) {
    allFindings.push(
      ...checkGenericFiller(content, path),
      ...checkWeakImperatives(content, path),
      ...checkNegativeOnly(content, path),
      ...checkMissingRationale(content, path),
      ...checkBuriedCriticalRules(content, path),
      ...checkEscapeHatchMissing(content, path),
      ...checkCompoundInstructions(content, path),
      ...checkNakedConditionals(content, path),
      ...checkMentalNotes(content, path),
      ...checkAmbiguousPronouns(content, path),
      ...checkCompressiblePadding(content, path),
    );
  }
  // Cross-file instruction checks
  allFindings.push(
    ...checkDuplicateRules(parsed),
    ...checkAmbiguousRules(parsed),
    ...checkRuleContradictions(parsed),
    ...detectSemanticConflicts(
      parsed,
      new Map(files.map(f => [f.path, f.content])),
      {},
      makeId,
    ),
    ...detectOverSpecification(
      parsed,
      new Map(files.map(f => [f.path, f.content])),
      {},
      makeId,
    ),
  );

  // --- B. Document Structure (per-file) ---
  for (const { content, path } of files) {
    allFindings.push(
      ...checkFileTooLong(content, path),
      ...checkLongSections(content, path),
      ...checkEmptySections(content, path),
      ...checkRedundantStackInfo(content, path, scanResult.scanRoots),
      ...checkReadmeOverlap(content, path, scanResult.scanRoots),
      ...checkUnclosedCodeBlocks(content, path),
      ...checkMissingUpdateDate(content, path),
      ...checkPrioritySignalMissing(content, path),
    );
  }
  allFindings.push(...checkSectionBalance(parsed));

  // --- C. References & Paths (per-file) ---
  for (const { content, path } of files) {
    allFindings.push(
      ...checkBrokenFileRefs(content, path),
      ...checkBrokenMarkdownLinks(content, path),
      ...checkHardcodedPaths(content, path),
      ...checkStaleToolRefs(content, path, scanResult.installedServers),
      ...checkDeadCommandRefs(content, path),
      ...checkWrongAbstraction(content, path),
    );
  }
  allFindings.push(...checkStaleToolRefReverse(allContent, scanResult.installedServers));

  // --- D. Memory Quality ---
  allFindings.push(
    ...checkMemoryStale(scanResult.memoryFiles),
    ...checkMemoryOrphan(scanResult.memoryFiles),
    ...checkMemoryIndexOrphan(scanResult.memoryFiles),
    ...checkMemoryTooLarge(scanResult.memoryFiles),
    ...checkMemoryDuplicate(scanResult.memoryFiles),
    ...checkMemoryMissingFrontmatter(scanResult.memoryFiles),
  );

  // --- E. Hook Quality ---
  allFindings.push(
    ...checkHookDangerousCommands(hooks),
    ...checkHookMissingCondition(hooks),
    ...checkHookUnquotedVariable(hooks),
    ...checkHookNoTimeout(hooks),
    ...checkHookStaleToolRef(hooks, scanResult.installedServers),
  );

  // --- F. Skill Quality ---
  allFindings.push(
    ...checkSkillMissingFrontmatter(skills),
    ...checkSkillVagueName(skills),
    ...checkSkillPromptTooShort(skills),
    ...checkSkillUnrestrictedBash(skills),
    ...checkSkillDangerousNameNoGuard(skills),
  );

  // --- G. Completeness ---
  allFindings.push(
    ...checkMissingVerification(parsed, allContent),
    ...checkMissingErrorHandling(allContent),
    ...checkMissingHandoffProtocol(allContent, parsed),
    ...checkCognitiveBlueprint(parsed),
  );

  // Sort: critical first, then recommended, then nice_to_have
  const severityOrder: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary: LintSummary = {
    totalChecks: TOTAL_CHECKS,
    totalFindings: allFindings.length,
    bySeverity: {
      critical: allFindings.filter(f => f.severity === 'critical').length,
      recommended: allFindings.filter(f => f.severity === 'recommended').length,
      nice_to_have: allFindings.filter(f => f.severity === 'nice_to_have').length,
    },
    byCheck: {},
  };

  for (const f of allFindings) {
    summary.byCheck[f.check] = (summary.byCheck[f.check] || 0) + 1;
  }

  return { findings: allFindings, summary };
}
