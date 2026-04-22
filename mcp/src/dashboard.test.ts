import { describe, it, expect } from 'vitest';
import { renderSubScoreNote } from './dashboard.js';

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
    expect(html).toContain('CLAUDE.md alene');
    expect(html).toContain('CLAUDE.md only');
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
