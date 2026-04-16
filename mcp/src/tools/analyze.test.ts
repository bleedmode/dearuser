import { describe, it, expect } from 'vitest';
import { runAnalysis, formatAnalyzeReport } from './analyze.js';
import { homedir } from 'os';

// Run analysis once — reuse across all tests (it's read-only and deterministic)
const report = runAnalysis(homedir(), { scope: 'global', includeGit: false });

describe('formatAnalyzeReport', () => {
  describe('text format (default, vibe coder)', () => {
    const output = formatAnalyzeReport(report, 'text');
    const lines = output.split('\n');

    it('starts with the report header', () => {
      expect(lines[0]).toBe('# Dear User — Collaboration Analysis');
    });

    it('includes persona and score', () => {
      expect(output).toContain('## Your Persona:');
      expect(output).toContain('## Collaboration Score:');
    });

    it('uses plain-language category names', () => {
      expect(output).toContain('**Who Does What**');
      expect(output).toContain('**Independence**');
      expect(output).toContain('**Quality Checks**');
      expect(output).toContain('**Memory**');
      expect(output).toContain('**Automation**');
      expect(output).toContain('**Setup Completeness**');
    });

    it('does NOT use technical category names', () => {
      expect(output).not.toContain('**Role Clarity**');
      expect(output).not.toContain('**Autonomy Balance**');
      expect(output).not.toContain('**Memory Health**');
      expect(output).not.toContain('**System Maturity**');
      expect(output).not.toContain('**Coverage**');
    });

    it('includes score bars', () => {
      expect(output).toMatch(/[█░]+ \d+\/100/);
    });

    it('includes recommendations section', () => {
      // At least one of these should exist
      const hasRecs = output.includes('## 👤 For You') ||
                      output.includes('## 🤖 For Your Agent') ||
                      output.includes('## No action items');
      expect(hasRecs).toBe(true);
    });

    it('does NOT include detailed-only sections', () => {
      expect(output).not.toContain('## Stats');
      expect(output).not.toContain('## Session Patterns');
      expect(output).not.toContain('## Feedback Loop');
      expect(output).not.toContain('## 🛡️ Injection Surfaces');
    });
  });

  describe('detailed format (power user)', () => {
    const output = formatAnalyzeReport(report, 'detailed');

    it('uses technical category names', () => {
      expect(output).toContain('**Role Clarity**');
      expect(output).toContain('**Autonomy Balance**');
      expect(output).toContain('**Quality Standards**');
      expect(output).toContain('**Memory Health**');
      expect(output).toContain('**System Maturity**');
      expect(output).toContain('**Coverage**');
    });

    it('does NOT use plain-language category names', () => {
      expect(output).not.toContain('**Who Does What**');
      expect(output).not.toContain('**Independence**');
      expect(output).not.toContain('**Automation**:');
    });

    it('includes stats section', () => {
      expect(output).toContain('## Stats');
      expect(output).toMatch(/\*\*\d+\*\* rules/);
    });

    it('includes session patterns section', () => {
      expect(output).toContain('## Session Patterns');
      expect(output).toMatch(/total sessions/);
    });

    it('includes feedback loop section when data exists', () => {
      if (report.feedback && report.feedback.totalRecommendations > 0) {
        expect(output).toContain('## Feedback Loop');
      }
    });
  });

  describe('json format', () => {
    const output = formatAnalyzeReport(report, 'json');

    it('returns valid JSON', () => {
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('contains all top-level report fields', () => {
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('version', '2.0');
      expect(parsed).toHaveProperty('collaborationScore');
      expect(parsed).toHaveProperty('persona');
      expect(parsed).toHaveProperty('categories');
      expect(parsed).toHaveProperty('recommendations');
      expect(parsed).toHaveProperty('stats');
      expect(parsed).toHaveProperty('session');
      expect(parsed).toHaveProperty('feedback');
      expect(parsed).toHaveProperty('wrapped');
    });

    it('score is a number between 0 and 100', () => {
      const parsed = JSON.parse(output);
      expect(parsed.collaborationScore).toBeGreaterThanOrEqual(0);
      expect(parsed.collaborationScore).toBeLessThanOrEqual(100);
    });
  });

  describe('format consistency', () => {
    const text = formatAnalyzeReport(report, 'text');
    const detailed = formatAnalyzeReport(report, 'detailed');

    it('both text and detailed have the same score', () => {
      const scoreRegex = /## Collaboration Score: (\d+)\/100/;
      const textScore = text.match(scoreRegex)?.[1];
      const detailedScore = detailed.match(scoreRegex)?.[1];
      expect(textScore).toBe(detailedScore);
    });

    it('both text and detailed have the same persona', () => {
      const personaRegex = /## Your Persona: (.+)/;
      const textPersona = text.match(personaRegex)?.[1];
      const detailedPersona = detailed.match(personaRegex)?.[1];
      expect(textPersona).toBe(detailedPersona);
    });

    it('text is shorter than detailed', () => {
      expect(text.split('\n').length).toBeLessThan(detailed.split('\n').length);
    });
  });

  describe('default format', () => {
    it('defaults to text when no format specified', () => {
      const defaultOutput = formatAnalyzeReport(report);
      const textOutput = formatAnalyzeReport(report, 'text');
      expect(defaultOutput).toBe(textOutput);
    });
  });
});
