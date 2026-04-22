import { describe, it, expect } from 'vitest';
import { gradeBlendedScore, gradePureSubScore } from './grade.js';

describe('grade layer (calibration study R6)', () => {
  describe('gradeBlendedScore', () => {
    it('returns F for stub-level scores', () => {
      const g = gradeBlendedScore(7);
      expect(g.letter).toBe('F');
      expect(g.score).toBe(7);
    });

    it('returns D for bottom-quartile scores', () => {
      expect(gradeBlendedScore(12).letter).toBe('D');
      expect(gradeBlendedScore(15).letter).toBe('D');
    });

    it('returns C for median public repos', () => {
      expect(gradeBlendedScore(18).letter).toBe('C');
      expect(gradeBlendedScore(19).letter).toBe('C');
      expect(gradeBlendedScore(23).letter).toBe('C');
    });

    it('returns B for corpus top decile', () => {
      expect(gradeBlendedScore(24).letter).toBe('B');
      expect(gradeBlendedScore(26).letter).toBe('B');
    });

    it('returns A for corpus top 2% and above', () => {
      expect(gradeBlendedScore(30).letter).toBe('A');
      expect(gradeBlendedScore(32).letter).toBe('A');
      expect(gradeBlendedScore(75).letter).toBe('A');
      expect(gradeBlendedScore(100).letter).toBe('A');
    });

    it('labels top-tier scores with "top N%"', () => {
      const g = gradeBlendedScore(32);
      expect(g.percentileLabel).toMatch(/top \d+%/);
    });

    it('gives a human-readable summary', () => {
      expect(gradeBlendedScore(32).summary).toContain('Top-tier');
      expect(gradeBlendedScore(19).summary).toContain('Average');
      expect(gradeBlendedScore(5).summary).toContain('Stub');
    });
  });

  describe('gradePureSubScore', () => {
    it('uses slightly different thresholds to match pure-subscore distribution', () => {
      // Pure subscore corpus has max 42 — so 40 is A territory, not B.
      expect(gradePureSubScore(40).letter).toBe('A');
      expect(gradePureSubScore(32).letter).toBe('B');
      expect(gradePureSubScore(24).letter).toBe('C');
    });

    it('F covers the long stub tail', () => {
      expect(gradePureSubScore(11).letter).toBe('F');
    });
  });
});
