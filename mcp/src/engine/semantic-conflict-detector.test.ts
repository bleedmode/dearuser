import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectSemanticConflicts } from './semantic-conflict-detector.js';
import type { ParsedRule, ParseResult } from '../types.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'semantic-conflicts');

/** Extract rules from a fixture file, mimicking the real parser's bullet
 *  detection but keeping the test self-contained. */
function parseFixture(name: string): {
  parsed: ParseResult;
  filesByPath: Map<string, string>;
} {
  const path = join(FIXTURE_DIR, name);
  const content = readFileSync(path, 'utf-8');
  const rules: ParsedRule[] = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*[-*]\s+(.+)/);
    if (!m) continue;
    const text = m[1].trim();
    if (text.length > 10 && text.length < 500) {
      rules.push({ text, type: 'do_autonomously', source: path });
    }
  }
  const parsed: ParseResult = { rules, sections: [], learnings: [], projectCount: 0 };
  return { parsed, filesByPath: new Map([[path, content]]) };
}

describe('semantic-conflict-detector', () => {
  describe('true positives — genuine conflicts must be flagged', () => {
    it('flags force-push always vs never', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-force-push.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].check).toBe('semantic_rule_conflict');
      expect(findings[0].excerpt).toMatch(/force push/i);
    });

    it('flags run-tests always vs never', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-tests.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].excerpt).toMatch(/test/i);
    });

    it('flags commit-to-main conflict in Danish', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-commits-danish.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].excerpt.toLowerCase()).toMatch(/commit|main/);
    });
  });

  describe('negative fixtures — intentional nuance must NOT be flagged', () => {
    it('does not flag when one rule has "unless" escape hatch', () => {
      const { parsed, filesByPath } = parseFixture('negative-escape-hatch.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings).toEqual([]);
    });

    it('does not flag rules about different topics', () => {
      const { parsed, filesByPath } = parseFixture('negative-different-topics.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings).toEqual([]);
    });

    it('does not flag short / low-content-word rules', () => {
      const { parsed, filesByPath } = parseFixture('negative-short-rules.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings).toEqual([]);
    });

    it('does not flag rules with same polarity (both positive)', () => {
      const { parsed, filesByPath } = parseFixture('negative-same-polarity.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings).toEqual([]);
    });

    it('does not flag neutral / suggestion-style rules', () => {
      const { parsed, filesByPath } = parseFixture('negative-neutral-rules.md');
      const findings = detectSemanticConflicts(parsed, filesByPath);
      expect(findings).toEqual([]);
    });
  });

  describe('stable finding identity', () => {
    it('produces the same finding hash across runs for the same pair', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-force-push.md');
      const run1 = detectSemanticConflicts(parsed, filesByPath);
      const run2 = detectSemanticConflicts(parsed, filesByPath);
      expect(run1[0].id).toBe(run2[0].id);
    });

    it('uses the same hash regardless of rule order (A,B) == (B,A)', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-force-push.md');
      const run1 = detectSemanticConflicts(parsed, filesByPath);
      const reversed: ParseResult = { ...parsed, rules: [...parsed.rules].reverse() };
      const run2 = detectSemanticConflicts(reversed, filesByPath);
      expect(run1[0].id).toBe(run2[0].id);
    });
  });

  describe('output shape', () => {
    it('emits findings with a user-facing Danish title and no jargon', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-tests.md');
      const [f] = detectSemanticConflicts(parsed, filesByPath);
      expect(f.title).toBe('To regler kan modsige hinanden');
      expect(f.severity).toBe('nice_to_have');
      expect(f.description.length).toBeGreaterThan(40);
      expect(f.fix).toBeTruthy();
    });

    it('respects maxFindings cap', () => {
      // Build a synthetic ParseResult with many conflicting pairs
      const path = '/fake/CLAUDE.md';
      const rules: ParsedRule[] = [
        { text: 'Always force push to the main branch when refactoring', type: 'do_autonomously', source: path },
        { text: 'Never force push to the main branch under any circumstance', type: 'prohibition', source: path },
        { text: 'Always run tests before committing code changes', type: 'do_autonomously', source: path },
        { text: 'Never run tests before committing code changes', type: 'prohibition', source: path },
        { text: 'Always use the staging server for database migrations', type: 'do_autonomously', source: path },
        { text: 'Never use the staging server for database migrations', type: 'prohibition', source: path },
      ];
      const parsed: ParseResult = { rules, sections: [], learnings: [], projectCount: 0 };
      const content = rules.map(r => `- ${r.text}`).join('\n');
      const findings = detectSemanticConflicts(parsed, new Map([[path, content]]), { maxFindings: 2 });
      expect(findings.length).toBeLessThanOrEqual(2);
    });
  });
});
