import { describe, it, expect } from 'vitest';
import { runAnalysis, formatAnalyzeReport } from './analyze.js';
import { homedir } from 'os';

// Run analysis once — reuse across all tests (it's read-only and deterministic)
const report = runAnalysis(homedir(), { scope: 'global', includeGit: false });

describe('formatAnalyzeReport', () => {
  describe('text format (default, compact)', () => {
    // v1.0.12: text format is now compact (~10 lines): header + score line +
    // one-line takeaway. Categories, lint findings, recommendations and tool
    // catalog all moved to dashboard letter and the action menu prepended by
    // attachDashboardLink. Rationale: MCP-protocol limitation means agents
    // sometimes summarise long tool outputs — short outputs are agent-stable.
    const output = formatAnalyzeReport(report, 'text');
    const lines = output.split('\n');

    it('starts with the compact header', () => {
      expect(lines[0]).toBe('# Dear User — Collaboration check');
    });

    it('includes the score and grade on the subtitle line', () => {
      expect(output).toMatch(/\*\*\d+\/100\*\* · Grade [A-F]/);
    });

    it('includes a one-line takeaway', () => {
      // Either a ceiling-based lift sentence or a "no obvious next step"
      // fallback — both are short, single-paragraph statements.
      const hasTakeaway = /actions below would lift|Small lift available|takes you to|You're at the top|No obvious next step/.test(output);
      expect(hasTakeaway).toBe(true);
    });

    it('does NOT include category breakdowns (moved to detailed)', () => {
      expect(output).not.toContain('**Who Does What**');
      expect(output).not.toContain('**Independence**');
      expect(output).not.toContain('**Quality Checks**');
    });

    it('does NOT include detailed-only sections', () => {
      expect(output).not.toContain('## Stats');
      expect(output).not.toContain('## Session Patterns');
      expect(output).not.toContain('## Feedback Loop');
      expect(output).not.toContain('## 🛡️ Injection Surfaces');
    });

    it('stays under 25 lines (compact contract)', () => {
      // Hard contract: terminal output must stay short so the agent has
      // less surface to summarise. If new sections are added here, they
      // belong in detailed format or in the action menu instead.
      expect(lines.length).toBeLessThanOrEqual(25);
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

    it('both formats include the same score number', () => {
      // Score line shape differs between formats (compact: `**70/100**`,
      // detailed: `## Collaboration Score: 70/100`) — match either.
      const compactMatch = text.match(/\*\*(\d+)\/100\*\*/)?.[1];
      const detailedMatch = detailed.match(/## Collaboration Score: (\d+)\/100/)?.[1];
      expect(compactMatch).toBeDefined();
      expect(detailedMatch).toBeDefined();
      expect(compactMatch).toBe(detailedMatch);
    });

    it('text is much shorter than detailed', () => {
      // Compact contract: text format must be a clear minority of the
      // detailed bytes. Anything within ~20% of detailed means we're
      // re-bloating the compact format and should reconsider.
      expect(text.length).toBeLessThan(detailed.length * 0.2);
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
