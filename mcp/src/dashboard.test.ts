import { describe, it, expect } from 'vitest';
import { renderSubScoreNote, renderWhatISaw, renderCollabSuggestions } from './dashboard.js';

describe('renderSubScoreNote — R1 surfacing', () => {
  it('renders nothing when substrate is not empty', () => {
    const html = renderSubScoreNote({
      substrateEmpty: false,
      claudeMdSubScore: 76,
      collaborationScore: 53,
      subScoreGrade: { letter: 'A', percentileLabel: 'Top 10%' },
    });
    expect(html).toBe('');
  });

  it('renders nothing when sub-score equals blended (no gap to explain)', () => {
    const html = renderSubScoreNote({
      substrateEmpty: true,
      claudeMdSubScore: 82,
      collaborationScore: 82,
      subScoreGrade: { letter: 'B', percentileLabel: 'Top 25%' },
    });
    expect(html).toBe('');
  });

  it('renders nothing when sub-score is missing', () => {
    const html = renderSubScoreNote({ substrateEmpty: true, collaborationScore: 53 });
    expect(html).toBe('');
  });

  it('renders the sub-score when substrate is empty and there is a gap', () => {
    // Starter fixture from calibration harness: blended 53, sub 76
    const html = renderSubScoreNote({
      substrateEmpty: true,
      claudeMdSubScore: 76,
      collaborationScore: 53,
      subScoreGrade: { letter: 'A', percentileLabel: 'Top 10%' },
    });
    expect(html).toContain('Agent-kontrakt alene');
    expect(html).toContain('Agent contract only');
    expect(html).toContain('>76<');
    expect(html).toContain('A');
    expect(html).toContain('Top 10%');
    expect(html).toMatch(/text-(emerald|amber|rose)-700/);
  });

  it('uses amber color band for sub-score in the 70-84 range', () => {
    const html = renderSubScoreNote({
      substrateEmpty: true,
      claudeMdSubScore: 76,
      collaborationScore: 53,
      subScoreGrade: { letter: 'B', percentileLabel: '' },
    });
    expect(html).toContain('text-amber-700');
  });

  it('uses emerald color band for sub-score >= 85', () => {
    const html = renderSubScoreNote({
      substrateEmpty: true,
      claudeMdSubScore: 90,
      collaborationScore: 60,
      subScoreGrade: { letter: 'A', percentileLabel: '' },
    });
    expect(html).toContain('text-emerald-700');
  });

  it('handles missing subScoreGrade gracefully (no grade suffix)', () => {
    const html = renderSubScoreNote({
      substrateEmpty: true,
      claudeMdSubScore: 76,
      collaborationScore: 53,
    });
    expect(html).toContain('>76<');
    expect(html).not.toContain('Grade');
    expect(html).not.toContain('Karakter');
  });
});

describe('renderWhatISaw — strengths only', () => {
  const findings = [
    { tag: 'win',     title: 'Feedback loop closes', body: 'wins body' },
    { tag: 'risk',    title: 'Quality Gaps',         body: 'risks body' },
    { tag: 'pattern', title: 'Prompt shortness',     body: 'patterns body' },
    { tag: 'win',     title: 'Automation live',      body: 'automation' },
  ];

  it('includes only tag=win findings', () => {
    const html = renderWhatISaw({ findings });
    expect(html).toContain('Feedback loop closes');
    expect(html).toContain('Automation live');
    expect(html).not.toContain('Quality Gaps');
    expect(html).not.toContain('Prompt shortness');
  });

  it('uses the green strength pill', () => {
    const html = renderWhatISaw({ findings });
    expect(html).toContain('bg-green-100');
    expect(html).not.toContain('bg-rose-100');
    expect(html).not.toContain('bg-blue-100');
  });

  it('renders nothing when no strengths exist', () => {
    expect(renderWhatISaw({ findings: [{ tag: 'risk', title: 'x', body: '' }] })).toBe('');
    expect(renderWhatISaw({ findings: [] })).toBe('');
    expect(renderWhatISaw({})).toBe('');
  });

  it('numbers strengths 01, 02, ... (fresh count per section)', () => {
    const html = renderWhatISaw({ findings });
    expect(html).toMatch(/>01</);
    expect(html).toMatch(/>02</);
    expect(html).not.toMatch(/>03</);
  });
});

describe('renderCollabSuggestions — risks + patterns + recommendations', () => {
  const findings = [
    { tag: 'win',     title: 'Strong point',   body: 'strength body' },
    { tag: 'risk',    title: 'Quality Gaps',   body: 'code breaks sometimes' },
    { tag: 'pattern', title: 'Short prompts',  body: 'many short prompts observed' },
  ];
  const topAction = {
    title: 'add-tested-rule',
    practiceStep: 'Add "never say something works unless you have tested it" to CLAUDE.md.',
    why: 'Fewer setbacks.',
  };
  const smallThings = [
    { title: { da: 'Ret tonen', en: 'Adjust tone' }, summary: { da: 'Sig det hvis tonen er skæv.', en: 'Say so when the tone is off.' }, benefit: { da: 'Agent tilpasser sig.', en: 'Agent adapts.' } },
  ];

  it('excludes strengths', () => {
    const html = renderCollabSuggestions({ findings }, topAction, smallThings);
    expect(html).not.toContain('Strong point');
    expect(html).not.toContain('strength body');
  });

  it('includes risks with rose pill', () => {
    const html = renderCollabSuggestions({ findings }, null, []);
    expect(html).toContain('Quality Gaps');
    expect(html).toContain('code breaks sometimes');
    expect(html).toContain('bg-rose-100');
  });

  it('includes patterns with blue pill', () => {
    const html = renderCollabSuggestions({ findings }, null, []);
    expect(html).toContain('Short prompts');
    expect(html).toContain('bg-blue-100');
  });

  it('includes topAction with amber pill + Try this action line', () => {
    const html = renderCollabSuggestions({ findings: [] }, topAction, []);
    expect(html).toContain('bg-amber-100');
    expect(html).toContain('Try this next time');
    expect(html).toContain('never say something works');
  });

  it('includes smallThings with "What gets better?" label', () => {
    const html = renderCollabSuggestions({ findings: [] }, null, smallThings);
    expect(html).toContain('Adjust tone');
    expect(html).toContain('What gets better?');
    expect(html).toContain('Agent adapts');
  });

  it('renders risks first, then topAction, then patterns, then smallThings', () => {
    const html = renderCollabSuggestions({ findings }, topAction, smallThings);
    const iRisk     = html.indexOf('Quality Gaps');
    const iTop      = html.indexOf('never say something works');
    const iPattern  = html.indexOf('Short prompts');
    const iSmall    = html.indexOf('Adjust tone');
    expect(iRisk).toBeGreaterThan(-1);
    expect(iTop).toBeGreaterThan(iRisk);
    expect(iPattern).toBeGreaterThan(iTop);
    expect(iSmall).toBeGreaterThan(iPattern);
  });

  it('renders nothing when there are no risks, patterns, or recommendations', () => {
    expect(renderCollabSuggestions({ findings: [] }, null, [])).toBe('');
  });

  it('does NOT render a Try this line for risks (no associated action)', () => {
    const html = renderCollabSuggestions({ findings: [{ tag: 'risk', title: 'Bare risk', body: 'no action' }] }, null, []);
    expect(html).toContain('Bare risk');
    expect(html).not.toContain('Try this next time');
    expect(html).not.toContain('What gets better?');
  });
});
