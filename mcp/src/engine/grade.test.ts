import { describe, it, expect } from 'vitest';
import { gradeBlendedScore, gradePureSubScore } from './grade.js';

describe('grade layer', () => {
  describe('gradeBlendedScore', () => {
    // Blended corpus: p95=51, p75=39, p50=24, p25=15 (988-repo substrate)
    it('returns F for stub-level scores', () => {
      const g = gradeBlendedScore(7);
      expect(g.letter).toBe('F');
      expect(g.score).toBe(7);
    });

    it('returns D for bottom-quartile scores', () => {
      expect(gradeBlendedScore(15).letter).toBe('D');
      expect(gradeBlendedScore(20).letter).toBe('D');
      expect(gradeBlendedScore(23).letter).toBe('D');
    });

    it('returns C for median public repos', () => {
      expect(gradeBlendedScore(24).letter).toBe('C');
      expect(gradeBlendedScore(30).letter).toBe('C');
      expect(gradeBlendedScore(38).letter).toBe('C');
    });

    it('returns B for corpus top quartile', () => {
      expect(gradeBlendedScore(39).letter).toBe('B');
      expect(gradeBlendedScore(45).letter).toBe('B');
      expect(gradeBlendedScore(50).letter).toBe('B');
    });

    it('returns A for corpus top 5% and above', () => {
      expect(gradeBlendedScore(51).letter).toBe('A');
      expect(gradeBlendedScore(75).letter).toBe('A');
      expect(gradeBlendedScore(100).letter).toBe('A');
    });

    it('labels top-tier scores with "top N%"', () => {
      const g = gradeBlendedScore(60);
      expect(g.percentileLabel).toMatch(/top \d+%/);
    });

    it('gives a human-readable summary', () => {
      expect(gradeBlendedScore(60).summary).toContain('Top-tier');
      expect(gradeBlendedScore(20).summary).toContain('Thin');
      expect(gradeBlendedScore(5).summary).toContain('Stub');
    });
  });

  describe('gradePureSubScore', () => {
    it('aligns to pure-subscore v2 distribution', () => {
      // Pure corpus: p95=49, p75=33, p50=22, p25=13
      expect(gradePureSubScore(50).letter).toBe('A');
      expect(gradePureSubScore(34).letter).toBe('B');
      expect(gradePureSubScore(22).letter).toBe('C');
      expect(gradePureSubScore(13).letter).toBe('D');
    });

    it('F covers the long stub tail', () => {
      expect(gradePureSubScore(10).letter).toBe('F');
    });
  });
});
