// CLAUDE.md lint checks — instruction quality analysis
//
// 15 checks that catch common anti-patterns in CLAUDE.md files.
// Designed to complement (not duplicate) the collaboration scoring:
// scoring measures *what's present*, linting measures *what's wrong*.

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import type { ScanResult, ParseResult, LintFinding, LintCheckId, LintSummary, GapSeverity } from '../types.js';

interface LintResult {
  findings: LintFinding[];
  summary: LintSummary;
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
  /should not\b/i, /shouldn't\b/i, // these are prohibitions, not weak
];

const CRITICAL_MARKERS = [
  /\bnever\b/i, /\balways\b/i, /\bcritical\b/i, /\bimportant\b/i,
  /\bmust\b/i, /\brequired\b/i, /\bmandatory\b/i,
  /\baldrig\b/i, /\baltid\b/i, /\bkritisk\b/i, /\bvigtig/i, /\bskal\b/i,
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

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/** 1. Generic filler — phrases the model already knows; wastes context. */
function checkGenericFiller(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  for (const { line, text } of lines) {
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
        break; // one finding per line
      }
    }
  }
  return results;
}

/** 2. Weak imperatives — "try to", "should", "consider" weaken instructions. */
function checkWeakImperatives(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  for (const { line, text } of lines) {
    // Only check bullet points (actual rules)
    if (!/^\s*[-*]\s+/.test(text)) continue;

    for (const pattern of WEAK_IMPERATIVE_PATTERNS) {
      if (pattern.test(text)) {
        // Check exceptions
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

/** 3. Negative-only rules — "don't X" without "do Y instead". */
function checkNegativeOnly(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  const negativePatterns = [
    /\bdon'?t\b/i, /\bdo not\b/i, /\bnever\b/i, /\bavoid\b/i,
    /\blad vær/i, /\bikke\b/i, /\baldrig\b/i, /\bundgå\b/i,
  ];
  const positivePatterns = [
    /\binstead\b/i, /\brather\b/i, /\buse\b/i, /\bprefer\b/i,
    /\bdo\b/i, /\bbrug\b/i, /\bi stedet\b/i, /\bforetræk/i,
    /→/,  // arrow suggesting alternative
    /—.*(?:brug|use|do|prefer)/i,
  ];

  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;

    const isNegative = negativePatterns.some(p => p.test(text));
    if (!isNegative) continue;

    const hasPositive = positivePatterns.some(p => p.test(text));
    if (hasPositive) continue;

    // Check if next line provides the positive (common pattern)
    const nextLine = lines.find(l => l.line === line + 1);
    if (nextLine && positivePatterns.some(p => p.test(nextLine.text))) continue;

    results.push(finding(
      'negative_only', 'nice_to_have',
      'Negative-only rule',
      `Rules that only say "don't" without an alternative leave the model guessing what to do instead.`,
      file, trunc(text), line,
      `Add what TO do: "Don't X — instead, do Y."`,
    ));
  }

  // Cap at 5 to avoid noise
  return results.slice(0, 5);
}

/** 4. File too long — >500 lines wastes context, important rules get lost. */
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

/** 5. Broken file references — paths mentioned that don't exist on disk. */
function checkBrokenFileRefs(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);
  const seen = new Set<string>();

  const pathPattern = /(?:^|[\s`"'(])(\/(Users|home|opt|var|etc)[^\s`"')]+)/g;

  for (const { line, text } of lines) {
    for (const match of text.matchAll(pathPattern)) {
      const refPath = match[1];
      if (seen.has(refPath)) continue;
      seen.add(refPath);

      // Skip URLs
      if (/^https?:/.test(refPath)) continue;
      // Skip patterns/globs
      if (refPath.includes('*') || refPath.includes('{')) continue;

      if (!existsSync(refPath)) {
        results.push(finding(
          'broken_file_ref', 'recommended',
          'Broken file reference',
          `Path "${trunc(refPath, 60)}" does not exist. The agent will waste time looking for it.`,
          file, trunc(text), line,
          `Remove or update the path.`,
        ));
      }
    }
  }
  return results.slice(0, 10);
}

/** 6. Broken markdown links — [text](path) where path doesn't exist. */
function checkBrokenMarkdownLinks(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);
  const fileDir = dirname(file);

  const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const { line, text } of lines) {
    for (const match of text.matchAll(linkPattern)) {
      const linkText = match[1];
      const linkTarget = match[2];

      // Skip URLs, anchors, mailto
      if (/^(https?:|mailto:|#)/.test(linkTarget)) continue;

      const resolved = resolve(fileDir, linkTarget);
      if (!existsSync(resolved)) {
        results.push(finding(
          'broken_markdown_link', 'recommended',
          `Broken link: [${trunc(linkText, 30)}]`,
          `Link target "${linkTarget}" does not exist relative to ${file}.`,
          file, trunc(text), line,
          `Update the link target or remove the link.`,
        ));
      }
    }
  }
  return results.slice(0, 10);
}

/** 7. Hardcoded user paths — platform-specific paths reduce portability. */
function checkHardcodedPaths(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  const hardcodedPattern = /\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+/g;
  const seenUsers = new Set<string>();

  for (const { line, text } of lines) {
    for (const match of text.matchAll(hardcodedPattern)) {
      const userPath = match[0];
      if (seenUsers.has(userPath)) continue;
      seenUsers.add(userPath);

      results.push(finding(
        'hardcoded_user_path', 'nice_to_have',
        `Hardcoded user path: ${userPath}`,
        `Platform-specific paths break when shared with teammates or across machines. Use ~ or relative paths.`,
        file, trunc(text), line,
        `Replace with ~ or $HOME, or use relative paths.`,
      ));
    }
  }

  // Only one finding for this — it's usually all-or-nothing
  return results.slice(0, 1);
}

/** 8. Stale tool references — MCP servers/tools mentioned but not installed. */
function checkStaleToolRefs(content: string, file: string, installedServers: string[]): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  // Look for mcp__<server>__ patterns
  const mcpPattern = /mcp__(\w+)__/g;
  const seen = new Set<string>();

  for (const { line, text } of lines) {
    for (const match of text.matchAll(mcpPattern)) {
      const serverName = match[1].toLowerCase();
      if (seen.has(serverName)) continue;
      seen.add(serverName);

      if (!installedServers.includes(serverName)) {
        results.push(finding(
          'stale_tool_ref', 'recommended',
          `Stale MCP reference: ${serverName}`,
          `CLAUDE.md references MCP server "${serverName}" but it's not installed. The agent may try to use tools that don't exist.`,
          file, trunc(text), line,
          `Install the server or remove the reference.`,
        ));
      }
    }
  }
  return results;
}

/** 9. Redundant stack info — "We use React" when it's in package.json. */
function checkRedundantStackInfo(content: string, file: string, scanRoots: string[]): LintFinding[] {
  const results: LintFinding[] = [];

  // Simple heuristic: check if package.json exists in any scan root
  // and if CLAUDE.md mentions frameworks that are inferrable
  const inferrableFromPkgJson = new Set<string>();
  for (const root of scanRoots) {
    try {
      const pkgPath = resolve(root, 'package.json');
      if (!existsSync(pkgPath)) continue;
      // We don't read the file content — just knowing package.json exists
      // means the tech stack is partially inferrable
      inferrableFromPkgJson.add(root);
    } catch { /* skip */ }
  }

  if (inferrableFromPkgJson.size === 0) return results;

  const redundantPhrases = [
    /we use (react|next\.?js|vue|angular|svelte|express|fastify|node)/i,
    /our (tech )?stack (is|includes)/i,
    /built with (react|next\.?js|vue|angular|typescript|node)/i,
    /vi bruger (react|next\.?js|vue|angular|svelte|express|node)/i,
    /bygget med (react|next\.?js|vue|angular|typescript|node)/i,
  ];

  const lines = indexedLines(content);
  for (const { line, text } of lines) {
    for (const pattern of redundantPhrases) {
      if (pattern.test(text)) {
        results.push(finding(
          'redundant_stack_info', 'nice_to_have',
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

/** 10. Buried critical rules — important rules in the middle of a long file. */
function checkBuriedCriticalRules(content: string, file: string): LintFinding[] {
  const lines = indexedLines(content);
  const totalLines = lines.length;
  if (totalLines < 100) return []; // only relevant for long files

  const results: LintFinding[] = [];
  const middleStart = Math.floor(totalLines * 0.3);
  const middleEnd = Math.floor(totalLines * 0.7);

  for (const { line, text } of lines) {
    if (line < middleStart || line > middleEnd) continue;
    if (!/^\s*[-*]\s+/.test(text)) continue;

    const isCritical = CRITICAL_MARKERS.some(p => p.test(text));
    if (isCritical) {
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

/** 11. Duplicate rules — near-identical rules waste context. */
function checkDuplicateRules(parsed: ParseResult): LintFinding[] {
  const results: LintFinding[] = [];
  const rules = parsed.rules;

  // Simple similarity: normalize and compare
  function normalize(text: string): string {
    return text.toLowerCase()
      .replace(/[^a-z0-9æøå ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const seen = new Map<string, { text: string; source: string }>();

  for (const rule of rules) {
    const norm = normalize(rule.text);
    if (norm.length < 15) continue; // skip very short rules

    // Check for exact or near-exact duplicates
    for (const [existingNorm, existing] of seen) {
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

/** 12. Long sections without sub-headers — walls of text are hard to parse. */
function checkLongSections(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = content.split('\n');

  let sectionStart = 0;
  let sectionHeader = '';
  let linesSinceHeader = 0;
  let hasSubHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,2})\s+(.+)/);
    const subHeaderMatch = lines[i].match(/^#{3,}\s+/);

    if (subHeaderMatch) {
      hasSubHeader = true;
      continue;
    }

    if (headerMatch) {
      // Check previous section
      if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
        results.push(finding(
          'long_section_no_headers', 'nice_to_have',
          `Long section without sub-headers: "${trunc(sectionHeader, 40)}"`,
          `${linesSinceHeader} lines without structure. Break into sub-sections for better comprehension.`,
          file, `"${trunc(sectionHeader, 40)}" — ${linesSinceHeader} lines`, sectionStart + 1,
          `Add ### sub-headers to break up the content.`,
        ));
      }

      sectionStart = i;
      sectionHeader = headerMatch[2];
      linesSinceHeader = 0;
      hasSubHeader = false;
    } else {
      linesSinceHeader++;
    }
  }

  // Check last section
  if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
    results.push(finding(
      'long_section_no_headers', 'nice_to_have',
      `Long section without sub-headers: "${trunc(sectionHeader, 40)}"`,
      `${linesSinceHeader} lines without structure. Break into sub-sections.`,
      file, `"${trunc(sectionHeader, 40)}" — ${linesSinceHeader} lines`, sectionStart + 1,
      `Add ### sub-headers to break up the content.`,
    ));
  }

  return results.slice(0, 3);
}

/** 13. Empty sections — headers with no meaningful content. */
function checkEmptySections(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (!headerMatch) continue;

    // Check if next non-empty line is another header (meaning this section is empty)
    let j = i + 1;
    let hasContent = false;
    while (j < lines.length) {
      const trimmed = lines[j].trim();
      if (trimmed === '') { j++; continue; }
      if (/^#{1,3}\s+/.test(trimmed)) break;
      hasContent = true;
      break;
    }

    if (!hasContent) {
      results.push(finding(
        'empty_section', 'nice_to_have',
        `Empty section: "${headerMatch[2]}"`,
        `Section has a header but no content. Either fill it or remove the placeholder.`,
        file, lines[i], i + 1,
        `Add content or remove the empty section.`,
      ));
    }
  }
  return results;
}

/** 14. Ambiguous rules — too short or vague to be actionable. */
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

/** 15. Missing rationale — rules without "why" are harder to follow in edge cases. */
function checkMissingRationale(content: string, file: string): LintFinding[] {
  const results: LintFinding[] = [];
  const lines = indexedLines(content);

  // Only check prohibition and ask-first rules — these are the ones where
  // the agent most needs to understand WHY to judge edge cases
  const strongRulePatterns = [
    /\bnever\b/i, /\balways\b/i, /\bmust\b/i,
    /\baldrig\b/i, /\baltid\b/i, /\bskal\b/i,
  ];

  const rationalePatterns = [
    /\bbecause\b/i, /\bsince\b/i, /\bwhy\b/i, /\breason\b/i,
    /\bfordi\b/i, /\bgrund/i, /\bda\b/i,
    /—/, /\(.*\)/, // inline explanation via dash or parens
  ];

  let count = 0;
  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (count >= 3) break;

    const isStrong = strongRulePatterns.some(p => p.test(text));
    if (!isStrong) continue;

    const hasRationale = rationalePatterns.some(p => p.test(text));
    if (hasRationale) continue;

    // Check if next line provides rationale
    const nextLine = lines.find(l => l.line === line + 1);
    if (nextLine && rationalePatterns.some(p => p.test(nextLine.text))) continue;

    // Only flag if the rule is short enough that it's clearly missing context
    if (text.length > 120) continue; // long rules usually have enough context

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Run all 15 lint checks against CLAUDE.md content. */
export function lintClaudeMd(scanResult: ScanResult, parsed: ParseResult): LintResult {
  findingCounter = 0; // reset for deterministic IDs
  const allFindings: LintFinding[] = [];

  const files: Array<{ content: string; path: string }> = [];
  if (scanResult.globalClaudeMd) {
    files.push({ content: scanResult.globalClaudeMd.content, path: scanResult.globalClaudeMd.path });
  }
  if (scanResult.projectClaudeMd) {
    files.push({ content: scanResult.projectClaudeMd.content, path: scanResult.projectClaudeMd.path });
  }

  for (const { content, path } of files) {
    allFindings.push(
      ...checkGenericFiller(content, path),
      ...checkWeakImperatives(content, path),
      ...checkNegativeOnly(content, path),
      ...checkFileTooLong(content, path),
      ...checkBrokenFileRefs(content, path),
      ...checkBrokenMarkdownLinks(content, path),
      ...checkHardcodedPaths(content, path),
      ...checkStaleToolRefs(content, path, scanResult.installedServers),
      ...checkRedundantStackInfo(content, path, scanResult.scanRoots),
      ...checkBuriedCriticalRules(content, path),
      ...checkLongSections(content, path),
      ...checkEmptySections(content, path),
      ...checkMissingRationale(content, path),
    );
  }

  // Cross-file checks (need parsed data, not per-file)
  allFindings.push(
    ...checkDuplicateRules(parsed),
    ...checkAmbiguousRules(parsed),
  );

  // Sort: critical first, then recommended, then nice_to_have
  const severityOrder: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const summary: LintSummary = {
    totalChecks: 15,
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
