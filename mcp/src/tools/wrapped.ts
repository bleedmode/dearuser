// wrapped tool — shareable collaboration stats, Spotify Wrapped style.
//
// Two things live here:
//   - formatWrappedText(report): rich ASCII/unicode terminal output (monospace,
//     80-100 cols wide, no ANSI color assumption, no emoji). One HERO stat
//     rendered as block-digits, supporting stats as ranked lists with clean
//     section dividers. Emulates Spotify Wrapped's "one massive number per
//     card" visual language within a monospace constraint.
//   - formatWrappedJson(report): pass-through for `format: 'json'`.
//
// The MCP server glue (persisting a "wrapped" run, attaching the dashboard
// CTA) lives in index.ts and wraps around this formatter.
//
// Privacy: everything here operates on the already-scoped WrappedData subtree
// of AnalysisReport. No paths or file names are emitted; project name is only
// surfaced when explicitly present in the report (share.ts handles the
// anonymization pipeline for the web share card separately).

import type { AnalysisReport } from '../types.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/**
 * Terminal card width. 80 fits in every terminal (git log, tmux splits, SSH
 * sessions, Windows cmd.exe). Wider would let the hero digits be taller but
 * we'd lose legibility in narrow panes. 80 is the Spotify Wrapped of widths.
 */
const CARD_WIDTH = 80;

/** Inner text width once we account for the `│ ` + ` │` frame. */
const INNER_WIDTH = CARD_WIDTH - 4;

// ---------------------------------------------------------------------------
// Block-digit renderer — our "big number" typography.
// ---------------------------------------------------------------------------
//
// Each digit is a 5-row glyph, 5 cols wide + 1 col of right-padding. We use
// a half-block + full-block shape that reads as "bold" in any monospace font
// without requiring ANSI color. Glyphs designed to have a consistent weight
// so the stat feels engineered, not decorative.

const BLOCK_DIGITS: Record<string, string[]> = {
  '0': [
    ' ███ ',
    '█   █',
    '█   █',
    '█   █',
    ' ███ ',
  ],
  '1': [
    '  █  ',
    ' ██  ',
    '  █  ',
    '  █  ',
    ' ███ ',
  ],
  '2': [
    ' ███ ',
    '█   █',
    '   █ ',
    '  █  ',
    '█████',
  ],
  '3': [
    '████ ',
    '    █',
    ' ███ ',
    '    █',
    '████ ',
  ],
  '4': [
    '█   █',
    '█   █',
    '█████',
    '    █',
    '    █',
  ],
  '5': [
    '█████',
    '█    ',
    '████ ',
    '    █',
    '████ ',
  ],
  '6': [
    ' ███ ',
    '█    ',
    '████ ',
    '█   █',
    ' ███ ',
  ],
  '7': [
    '█████',
    '    █',
    '   █ ',
    '  █  ',
    '  █  ',
  ],
  '8': [
    ' ███ ',
    '█   █',
    ' ███ ',
    '█   █',
    ' ███ ',
  ],
  '9': [
    ' ███ ',
    '█   █',
    ' ████',
    '    █',
    ' ███ ',
  ],
  '%': [
    '█   █',
    '   █ ',
    '  █  ',
    ' █   ',
    '█   █',
  ],
  '/': [
    '    █',
    '   █ ',
    '  █  ',
    ' █   ',
    '█    ',
  ],
  '.': [
    '     ',
    '     ',
    '     ',
    '     ',
    '  █  ',
  ],
  ' ': [
    '     ',
    '     ',
    '     ',
    '     ',
    '     ',
  ],
};

/**
 * Render a string (digits, `%`, `/`, `.`, spaces) as 5 rows of block glyphs.
 * Unknown chars are rendered as blanks rather than throwing — a graceful
 * fallback matters more than strictness for a presentation layer.
 */
export function renderBlockNumber(s: string): string[] {
  const chars = s.split('');
  const rows = ['', '', '', '', ''];
  for (const c of chars) {
    const glyph = BLOCK_DIGITS[c] || BLOCK_DIGITS[' '];
    for (let r = 0; r < 5; r++) {
      rows[r] += glyph[r] + ' ';
    }
  }
  return rows.map((r) => r.trimEnd());
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function centered(s: string, width = INNER_WIDTH): string {
  const visible = s.length;
  if (visible >= width) return s.slice(0, width);
  const pad = Math.floor((width - visible) / 2);
  return ' '.repeat(pad) + s + ' '.repeat(width - visible - pad);
}

function leftFill(s: string, width = INNER_WIDTH): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function divider(char = '─', width = CARD_WIDTH): string {
  return char.repeat(width);
}

/**
 * Horizontal bar — used for autonomy split. Fixed width so the three bars
 * line up even when their labels are different lengths.
 */
function bar(pct: number, width = 24): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Frame helpers — top/bottom/inner lines of the overall Wrapped "card".
// ---------------------------------------------------------------------------

function frameTop(): string {
  return `╭${'─'.repeat(CARD_WIDTH - 2)}╮`;
}
function frameBottom(): string {
  return `╰${'─'.repeat(CARD_WIDTH - 2)}╯`;
}
function frameBlank(): string {
  return `│${' '.repeat(CARD_WIDTH - 2)}│`;
}
function frameLine(content: string): string {
  // Pad/trim to inner width so the right border always aligns.
  const body = leftFill(content, INNER_WIDTH);
  return `│ ${body} │`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

/**
 * Hero section — one MASSIVE number (the collaboration score), with a tiny
 * "out of 100" label below. Mirrors Spotify Wrapped's "47,382 minutes"
 * hero treatment.
 */
function renderHero(score: number, headlineLabel: string): string[] {
  const block = renderBlockNumber(String(score));
  const lines: string[] = [];
  lines.push(frameBlank());
  for (const row of block) {
    lines.push(frameLine(centered(row, INNER_WIDTH)));
  }
  lines.push(frameBlank());
  lines.push(frameLine(centered('OUT OF 100', INNER_WIDTH)));
  lines.push(frameBlank());
  // The supporting line under the hero — e.g. "47 conversations across 3 projects".
  lines.push(frameLine(centered(headlineLabel.toUpperCase(), INNER_WIDTH)));
  lines.push(frameBlank());
  return lines;
}

/**
 * Section header — big label in caps with a rule underneath, mimicking the
 * typographic hierarchy on a Spotify Wrapped card ("YOUR TOP ARTIST").
 */
function renderSectionHeader(label: string): string[] {
  return [
    frameBlank(),
    frameLine(label.toUpperCase()),
    frameLine('─'.repeat(INNER_WIDTH)),
  ];
}

/**
 * Archetype block — "YOUR AGENT ARCHETYPE" as section header, archetype name
 * rendered large, traits as a single tight line.
 */
function renderArchetype(name: string, traits: string[]): string[] {
  const lines = renderSectionHeader('Your agent archetype');
  lines.push(frameBlank());
  lines.push(frameLine(name));
  if (traits.length > 0) {
    lines.push(frameLine(traits.slice(0, 4).join(' · ')));
  }
  lines.push(frameBlank());
  return lines;
}

/**
 * Autonomy split — three bars. We emphasise the biggest slice by listing it
 * first, so the reader sees the dominant mode immediately.
 */
function renderAutonomySplit(split: { doSelf: number; askFirst: number; suggest: number }): string[] {
  const rows: Array<{ label: string; pct: number }> = [
    { label: 'Do yourself', pct: split.doSelf },
    { label: 'Ask first', pct: split.askFirst },
    { label: 'Suggest only', pct: split.suggest },
  ].sort((a, b) => b.pct - a.pct);

  const lines = renderSectionHeader('How you split the work');
  lines.push(frameBlank());
  for (const r of rows) {
    const label = leftFill(r.label, 14);
    const pctText = `${String(r.pct).padStart(3)}%`;
    lines.push(frameLine(`${label} ${bar(r.pct, 50)} ${pctText}`));
  }
  lines.push(frameBlank());
  return lines;
}

/**
 * Top lesson — a quoted line with context underneath. Word-wraps at
 * INNER_WIDTH so long quotes don't break the frame.
 */
function renderTopLesson(lesson: { quote: string; context: string }): string[] {
  const lines = renderSectionHeader('Most repeated lesson');
  lines.push(frameBlank());
  const quote = `"${lesson.quote}"`;
  for (const wl of wrapText(quote, INNER_WIDTH)) {
    lines.push(frameLine(wl));
  }
  if (lesson.context) {
    lines.push(frameBlank());
    for (const wl of wrapText(lesson.context, INNER_WIDTH)) {
      lines.push(frameLine(wl));
    }
  }
  lines.push(frameBlank());
  return lines;
}

/**
 * System grid — the four system-size numbers in a row. Each gets its own
 * mid-sized number (no block digits — we reserve those for the hero) plus
 * a tiny label underneath. Feels like the "Top 5 Artists" row on a Wrapped
 * card: several medium-weight stats, not one giant one.
 */
function renderSystemGrid(grid: {
  hooks: number;
  skills: number;
  scheduled: number;
  rules: number;
}): string[] {
  const cells: Array<{ value: number; label: string }> = [
    { value: grid.skills, label: 'skills' },
    { value: grid.hooks, label: 'hooks' },
    { value: grid.scheduled, label: 'scheduled' },
    { value: grid.rules, label: 'rules' },
  ];

  const lines = renderSectionHeader('The system you built');
  lines.push(frameBlank());

  const cellWidth = Math.floor(INNER_WIDTH / cells.length);
  const numberRow = cells
    .map((c) => centered(String(c.value), cellWidth))
    .join('');
  const labelRow = cells
    .map((c) => centered(c.label.toUpperCase(), cellWidth))
    .join('');
  lines.push(frameLine(numberRow));
  lines.push(frameLine(labelRow));
  lines.push(frameBlank());
  return lines;
}

/**
 * Share card — the four "memorable" counters (corrections, memories,
 * projects, prohibition ratio). Formatted as a ranked list with each stat
 * on its own line, big number on the left, human label on the right.
 */
function renderShareCard(sc: {
  corrections: number;
  memories: number;
  projects: number;
  prohibitionRatio: string;
}): string[] {
  const rows: Array<{ value: string; label: string }> = [
    { value: String(sc.corrections), label: 'course-corrections remembered' },
    { value: String(sc.memories), label: 'memories built up' },
    { value: String(sc.projects), label: 'projects managed' },
    { value: sc.prohibitionRatio, label: 'of your rules are DON\'Ts' },
  ];

  const lines = renderSectionHeader('By the numbers');
  lines.push(frameBlank());
  for (const r of rows) {
    // Right-align the number in a 4-char column so stacked rows align.
    const num = r.value.padStart(4);
    lines.push(frameLine(`  ${num}   ${r.label}`));
  }
  lines.push(frameBlank());
  return lines;
}

/** Footer — CTA + dearuser.ai. Centered, small. */
function renderFooter(): string[] {
  return [
    frameBlank(),
    frameLine(centered('── SHARE YOURS AT DEARUSER.AI ──', INNER_WIDTH)),
    frameBlank(),
  ];
}

// ---------------------------------------------------------------------------
// Word-wrap — keeps quotes from breaking the frame.
// ---------------------------------------------------------------------------

function wrapText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + (cur ? ' ' : '') + w).length > width) {
      if (cur) lines.push(cur);
      cur = w.length > width ? w.slice(0, width) : w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormatOptions {
  /** Year to show in the header — defaults to the current calendar year. */
  year?: number;
}

/**
 * Render the full Spotify-Wrapped-style text card for a Dear User analysis.
 *
 * Structure (top to bottom):
 *   1. Header: "DEAR USER WRAPPED · 2026"
 *   2. Hero: score as 5-row block digits + "OUT OF 100" + headline label
 *   3. Archetype
 *   4. Autonomy split (three bars, sorted biggest first)
 *   5. System grid (skills / hooks / scheduled / rules)
 *   6. By the numbers (corrections / memories / projects / prohibitions)
 *   7. Top lesson (optional — skipped when the report has no recurring lesson)
 *   8. Footer
 */
export function formatWrappedText(
  report: AnalysisReport,
  options: FormatOptions = {},
): string {
  const w = report.wrapped;
  const year = options.year ?? new Date().getFullYear();

  const lines: string[] = [];

  // Header row (outside the frame — acts as a title).
  const title = `DEAR USER WRAPPED  ·  ${year}`;
  lines.push('');
  lines.push(centered(title, CARD_WIDTH));
  lines.push(divider('═'));

  // Main card frame.
  lines.push(frameTop());
  lines.push(...renderHero(report.collaborationScore, w.headlineStat.label));
  lines.push(...renderArchetype(w.archetype.name, w.archetype.traits));
  lines.push(...renderAutonomySplit(w.autonomySplit));
  lines.push(...renderSystemGrid(w.systemGrid));
  lines.push(...renderShareCard(w.shareCard));
  if (w.topLesson && w.topLesson.quote) {
    lines.push(...renderTopLesson(w.topLesson));
  }
  lines.push(...renderFooter());
  lines.push(frameBottom());

  return lines.join('\n');
}

/**
 * JSON passthrough — returned directly by the MCP tool when
 * `format: 'json'` is requested.
 */
export function formatWrappedJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}
