/**
 * Smoke tests for the wrapped formatter. We don't try to snapshot the exact
 * ASCII art (would be brittle to tweak) — instead we assert the structural
 * properties that make the card shareable:
 *   - Card width is stable at 80 cols
 *   - Hero number renders as 5 rows of block glyphs
 *   - All frame lines are the same width (no visual gaps)
 *   - Labels + data from the report show up
 *   - No emoji, no ANSI escapes, no paths leak
 */

import { describe, it, expect } from 'vitest';
import { formatWrappedText, renderBlockNumber } from './wrapped.js';
import type { AnalysisReport } from '../types.js';

function mockReport(partial: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    collaborationScore: 87,
    projectName: 'example-project',
    wrapped: {
      headlineStat: { value: '47', label: '47 conversations across 3 projects' },
      topLesson: {
        quote: 'Verify the fix before saying it works',
        context: 'Repeated across 4 sessions',
      },
      autonomySplit: { doSelf: 60, askFirst: 28, suggest: 12 },
      archetype: {
        name: 'The Solo Builder',
        traits: ['Pragmatic', 'Iterative', 'Memory-first'],
        description: 'Ships steadily with a single agent.',
      },
      systemGrid: { hooks: 4, skills: 18, scheduled: 6, rules: 32 },
      shareCard: {
        corrections: 23,
        memories: 41,
        projects: 3,
        prohibitionRatio: '18%',
      },
      moments: [
        {
          id: 'percentile',
          value: 'Top 5%',
          label: 'Where you rank',
          narrative: 'Your setup scores higher than 94% of 988 public Claude Code setups.',
          detail: 'Score 87 — corpus median is 32.',
        },
        {
          id: 'corrections',
          value: '12',
          label: 'Times you corrected me',
          narrative: 'You pushed back 12 times. I\'m keeping track.',
        },
        {
          id: 'dead-skills',
          value: '3',
          label: 'Skills never called',
          narrative: 'You built `alpha`, `beta`, `gamma` — I\'ve never seen you use them.',
        },
      ],
      percentile: {
        score: 87,
        percentile: 94,
        topPercent: 5,
        corpusSize: 50,
      },
      contrast: {
        strongest: { key: 'roleClarity', name: 'Role Clarity', score: 92 },
        weakest: { key: 'memoryHealth', name: 'Memory Health', score: 40 },
      },
    },
    // The formatter never touches these — pass minimal stubs so the type
    // checker stays happy.
    ...(partial as Partial<AnalysisReport>),
  } as unknown as AnalysisReport;
}

describe('renderBlockNumber', () => {
  it('produces exactly 5 rows for any input', () => {
    expect(renderBlockNumber('87')).toHaveLength(5);
    expect(renderBlockNumber('100')).toHaveLength(5);
    expect(renderBlockNumber('0')).toHaveLength(5);
  });

  it('falls back to blanks for unknown characters', () => {
    const rows = renderBlockNumber('?!');
    expect(rows).toHaveLength(5);
    // Unknown chars become spaces — the row is whitespace only.
    rows.forEach((r) => expect(r.trim()).toBe(''));
  });
});

describe('formatWrappedText', () => {
  it('renders an 80-col card with stable framing', () => {
    const text = formatWrappedText(mockReport());
    const lines = text.split('\n');

    // Every frame line (starts with │) must be exactly 80 chars so the
    // right border aligns — this is the "does it look broken?" smoke test.
    const frameLines = lines.filter((l) => l.startsWith('│'));
    expect(frameLines.length).toBeGreaterThan(10);
    frameLines.forEach((l) => {
      expect(l.length).toBe(80);
      expect(l.endsWith('│')).toBe(true);
    });
  });

  it('has a top and bottom frame corner', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('╭');
    expect(text).toContain('╮');
    expect(text).toContain('╰');
    expect(text).toContain('╯');
  });

  it('renders the hero score using block digits', () => {
    const text = formatWrappedText(mockReport({ collaborationScore: 87 } as any));
    // Block glyphs use the █ char; the hero should have many of them clustered.
    const heroBlock = text.split('\n').filter((l) => l.includes('█')).length;
    expect(heroBlock).toBeGreaterThanOrEqual(5);
    expect(text).toContain('OUT OF 100');
  });

  it('surfaces archetype name and traits', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('The Solo Builder');
    expect(text).toContain('Pragmatic');
    expect(text).toContain('Memory-first');
  });

  it('renders all three autonomy bars with percentages', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('Do yourself');
    expect(text).toContain('Ask first');
    expect(text).toContain('Suggest only');
    expect(text).toContain(' 60%');
    expect(text).toContain(' 28%');
    expect(text).toContain(' 12%');
  });

  it('renders the system grid with four labels', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('SKILLS');
    expect(text).toContain('HOOKS');
    expect(text).toContain('SCHEDULED');
    expect(text).toContain('RULES');
  });

  it('renders the by-the-numbers block', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('course-corrections');
    expect(text).toContain('memories built up');
    expect(text).toContain('projects managed');
    expect(text.toLowerCase()).toContain("don't");
  });

  it('includes the top lesson when present', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('Verify the fix before saying it works');
    expect(text).toContain('Repeated across 4 sessions');
  });

  it('omits the top lesson section gracefully when null', () => {
    const report = mockReport();
    (report as any).wrapped.topLesson = null;
    const text = formatWrappedText(report);
    expect(text).not.toContain('Most repeated lesson');
  });

  it('uses the current year in the title by default', () => {
    const year = new Date().getFullYear();
    const text = formatWrappedText(mockReport());
    expect(text).toContain(`DEAR USER WRAPPED`);
    expect(text).toContain(String(year));
  });

  it('honours a pinned year option for deterministic rendering', () => {
    const text = formatWrappedText(mockReport(), { year: 2026 });
    expect(text).toContain('2026');
  });

  it('contains no emoji or ANSI escapes', () => {
    const text = formatWrappedText(mockReport());
    // Stripped-down "no emoji" check — matches typical emoji ranges.
    // (Full emoji detection is very expensive; this catches the common case.)
    // eslint-disable-next-line no-control-regex
    const ansi = /\x1b\[/;
    expect(ansi.test(text)).toBe(false);
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(emoji.test(text)).toBe(false);
  });

  it('does not leak absolute filesystem paths', () => {
    const text = formatWrappedText(mockReport());
    expect(text).not.toMatch(/\/Users\//);
    expect(text).not.toMatch(/\/home\//);
    expect(text).not.toMatch(/C:\\/);
  });

  it('ends with a share CTA pointing to dearuser.ai', () => {
    const text = formatWrappedText(mockReport());
    expect(text.toLowerCase()).toContain('dearuser.ai');
  });

  it('renders the moments section with values, labels and narratives', () => {
    const text = formatWrappedText(mockReport());
    expect(text).toContain('YOUR YEAR IN MOMENTS');
    // Values
    expect(text).toContain('Top 5%');
    expect(text).toContain('12');
    // Labels (uppercased)
    expect(text).toContain('WHERE YOU RANK');
    expect(text).toContain('TIMES YOU CORRECTED ME');
    expect(text).toContain('SKILLS NEVER CALLED');
    // Narratives
    expect(text).toContain('94%');
    expect(text).toContain('alpha');
  });

  it('omits the moments section cleanly when the moments array is empty', () => {
    const report = mockReport();
    (report as any).wrapped.moments = [];
    const text = formatWrappedText(report);
    expect(text).not.toContain('YOUR YEAR IN MOMENTS');
  });
});
