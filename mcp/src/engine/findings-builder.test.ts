import { describe, it, expect } from 'vitest';
import { buildFindings } from './findings-builder.js';
import type { Finding, FrictionPattern } from '../types.js';

function fp(overrides: Partial<FrictionPattern> = {}): FrictionPattern {
  return {
    rank: 2,
    title: 'A friction',
    description: 'Something the user pushed back on repeatedly',
    evidence: ['example evidence quote'],
    theme: 'communication',
    ...overrides,
  };
}

function win(title = 'A strength'): Finding {
  return { tag: 'win', title, body: 'Body for the strength.' };
}

describe('buildFindings', () => {
  it('returns empty when nothing is passed in', () => {
    expect(buildFindings({ frictionPatterns: [], strengths: [] })).toEqual([]);
  });

  it('rank-1 friction always becomes a risk', () => {
    const out = buildFindings({
      frictionPatterns: [fp({ rank: 1, theme: 'communication' })],
      strengths: [],
    });
    expect(out[0].tag).toBe('risk');
  });

  it('quality theme becomes a risk even at rank 3', () => {
    const out = buildFindings({
      frictionPatterns: [fp({ rank: 3, theme: 'quality' })],
      strengths: [],
    });
    expect(out[0].tag).toBe('risk');
  });

  it('scope_creep theme becomes a risk', () => {
    const out = buildFindings({
      frictionPatterns: [fp({ rank: 4, theme: 'scope_creep' })],
      strengths: [],
    });
    expect(out[0].tag).toBe('risk');
  });

  it('tooling + communication + process at rank >1 are neutral patterns', () => {
    const out = buildFindings({
      frictionPatterns: [
        fp({ rank: 2, theme: 'tooling', title: 'tooling friction' }),
        fp({ rank: 3, theme: 'communication', title: 'comms friction' }),
        fp({ rank: 4, theme: 'process', title: 'process friction' }),
      ],
      strengths: [],
    });
    const tags = out.map((f) => f.tag);
    expect(tags).toEqual(['pattern', 'pattern', 'pattern']);
  });

  it('leads with up to 2 wins, then risks, then patterns', () => {
    const out = buildFindings({
      frictionPatterns: [
        fp({ rank: 1, theme: 'quality', title: 'risky thing' }),
        fp({ rank: 3, theme: 'process', title: 'pattern thing' }),
      ],
      strengths: [win('win one'), win('win two'), win('win three')],
    });
    // Expect: win1, win2, risk, win3, pattern → slice to 6 → full list
    expect(out[0].title).toBe('win one');
    expect(out[1].title).toBe('win two');
    expect(out[2].title).toBe('risky thing');
    expect(out[2].tag).toBe('risk');
  });

  it('caps output at 6 findings', () => {
    const out = buildFindings({
      frictionPatterns: [
        fp({ rank: 1, theme: 'quality', title: 'r1' }),
        fp({ rank: 2, theme: 'scope_creep', title: 'r2' }),
        fp({ rank: 3, theme: 'communication', title: 'p1' }),
        fp({ rank: 4, theme: 'process', title: 'p2' }),
        fp({ rank: 5, theme: 'tooling', title: 'p3' }),
      ],
      strengths: [win('w1'), win('w2'), win('w3'), win('w4')],
    });
    expect(out.length).toBe(6);
  });

  it('body includes the user\'s own evidence when available', () => {
    const out = buildFindings({
      frictionPatterns: [fp({ evidence: ['the exact words I wrote'] })],
      strengths: [],
    });
    expect(out[0].body).toContain('the exact words I wrote');
  });

  it('body works even when evidence is empty', () => {
    const out = buildFindings({
      frictionPatterns: [fp({ evidence: [] })],
      strengths: [],
    });
    expect(out[0].body.length).toBeGreaterThan(0);
  });
});
