import { describe, it, expect } from 'vitest';
import { gradeBlendedScore, gradePureSubScore } from './grade.js';

describe('grade layer (v2 corpus)', () => {
  describe('gradeBlendedScore', () => {
    it('returns F for stub-level scores', () => {
      const g = gradeBlendedScore(7);
      expect(g.letter).toBe('F');
      expect(g.score).toBe(7);
    });

    it('returns D for bottom-quartile scores', () => {
      expect(gradeBlendedScore(10).letter).toBe('D');
      expect(gradeBlendedScore(15).letter).toBe('D');
    });

    it('returns C for median public repos', () => {
      expect(gradeBlendedScore(18).letter).toBe('C');
      expect(gradeBlendedScore(22).letter).toBe('C');
      expect(gradeBlendedScore(27).letter).toBe('C');
    });

    it('returns B for corpus top quartile', () => {
      expect(gradeBlendedScore(28).letter).toBe('B');
      expect(gradeBlendedScore(35).letter).toBe('B');
      expect(gradeBlendedScore(39).letter).toBe('B');
    });

    it('returns A for corpus top 4% and above', () => {
      expect(gradeBlendedScore(40).letter).toBe('A');
      expect(gradeBlendedScore(50).letter).toBe('A');
      expect(gradeBlendedScore(100).letter).toBe('A');
    });

    it('labels top-tier scores with "top N%"', () => {
      const g = gradeBlendedScore(45);
      expect(g.percentileLabel).toMatch(/top \d+%/);
    });

    it('gives a human-readable summary', () => {
      expect(gradeBlendedScore(45).summary).toContain('Top-tier');
      expect(gradeBlendedScore(20).summary).toContain('Average');
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
