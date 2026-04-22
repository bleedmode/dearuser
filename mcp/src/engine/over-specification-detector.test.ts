import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectOverSpecification, scanRuleForSignals } from './over-specification-detector.js';
import type { ParsedRule, ParseResult } from '../types.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'over-specification');

/** Parse a fixture file into rules, mirroring the real parser's bullet detection. */
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

describe('over-specification-detector', () => {
  describe('true positives — genuine over-specification must be flagged', () => {
    it('flags line-number + deep path combo', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-line-and-path.md');
      const findings = detectOverSpecification(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].check).toBe('over_specified');
    });

    it('flags version pin + multi-flag command', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-version-and-flags.md');
      const findings = detectOverSpecification(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
    });

    it('flags function signature + deep path', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-signature-and-path.md');
      const findings = detectOverSpecification(parsed, filesByPath);
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  describe('negative fixtures — legitimately-specific rules must NOT be flagged', () => {
    it('does not flag security rules with single signal', () => {
      const { parsed, filesByPath } = parseFixture('negative-security-specific.md');
      expect(detectOverSpecification(parsed, filesByPath)).toEqual([]);
    });

    it('does not flag DNS rules with IP addresses', () => {
      // IP + CNAME is domain knowledge, not over-specification. No code extension.
      const { parsed, filesByPath } = parseFixture('negative-dns-ip.md');
      expect(detectOverSpecification(parsed, filesByPath)).toEqual([]);
    });

    it('does not flag intent-only rules', () => {
      const { parsed, filesByPath } = parseFixture('negative-intent-only.md');
      expect(detectOverSpecification(parsed, filesByPath)).toEqual([]);
    });

    it('does not flag compliance rules with specific numbers', () => {
      const { parsed, filesByPath } = parseFixture('negative-compliance-specific.md');
      expect(detectOverSpecification(parsed, filesByPath)).toEqual([]);
    });

    it('does not flag a rule with only a single signal (single path)', () => {
      const { parsed, filesByPath } = parseFixture('negative-single-signal-path.md');
      expect(detectOverSpecification(parsed, filesByPath)).toEqual([]);
    });
  });

  describe('swiss-cheese gate', () => {
    it('does not fire when minSignals=2 is not met', () => {
      const path = '/fake/CLAUDE.md';
      const rules: ParsedRule[] = [
        { text: 'Always pin Tailwind v3 in the project.', type: 'do_autonomously', source: path },
      ];
      const parsed: ParseResult = { rules, sections: [], learnings: [], projectCount: 0 };
      const findings = detectOverSpecification(parsed, new Map([[path, '- Always pin Tailwind v3 in the project.']]));
      expect(findings).toEqual([]);
    });

    it('fires when 2+ signals match', () => {
      const path = '/fake/CLAUDE.md';
      const rules: ParsedRule[] = [
        {
          text: 'Always pin Tailwind v3.4 and run `npm test --watch --coverage --reporter=verbose` before commit.',
          type: 'do_autonomously',
          source: path,
        },
      ];
      const parsed: ParseResult = { rules, sections: [], learnings: [], projectCount: 0 };
      const findings = detectOverSpecification(parsed, new Map([[path, '- ' + rules[0].text]]));
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  describe('stable finding identity', () => {
    it('same finding hash across runs', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-version-and-flags.md');
      const run1 = detectOverSpecification(parsed, filesByPath);
      const run2 = detectOverSpecification(parsed, filesByPath);
      expect(run1[0].id).toBe(run2[0].id);
    });
  });

  describe('output shape', () => {
    it('emits Danish title + nice_to_have severity + fix suggestion', () => {
      const { parsed, filesByPath } = parseFixture('true-positive-line-and-path.md');
      const [f] = detectOverSpecification(parsed, filesByPath);
      expect(f.title).toBe('Regel er for detaljeret til CLAUDE.md');
      expect(f.severity).toBe('nice_to_have');
      expect(f.fix).toBeTruthy();
      expect(f.description).toMatch(/Fangede:/);
    });

    it('respects maxFindings cap', () => {
      const path = '/fake/CLAUDE.md';
      const manyOverSpec = Array.from({ length: 20 }, (_, i) => ({
        text: `When editing src/mod${i}/file.ts at line ${10 + i}, pin Tailwind v3.${i}.`,
        type: 'do_autonomously' as const,
        source: path,
      }));
      const content = manyOverSpec.map(r => `- ${r.text}`).join('\n');
      const parsed: ParseResult = { rules: manyOverSpec, sections: [], learnings: [], projectCount: 0 };
      const findings = detectOverSpecification(parsed, new Map([[path, content]]), { maxFindings: 3 });
      expect(findings.length).toBeLessThanOrEqual(3);
    });
  });

  describe('signal scanner unit tests', () => {
    it('detects line_ref', () => {
      const { signals } = scanRuleForSignals('see line 42 of the file', '', undefined);
      expect(signals).toContain('line_ref');
    });

    it('detects multi_flag_cmd', () => {
      const { signals } = scanRuleForSignals('run `cmd --a --b --c --d` after', '', undefined);
      expect(signals).toContain('multi_flag_cmd');
    });

    it('detects deep_path with code extension', () => {
      const { signals } = scanRuleForSignals('edit src/foo/bar/baz.ts carefully', '', undefined);
      expect(signals).toContain('deep_path');
    });

    it('does not flag deep path without code extension', () => {
      const { signals } = scanRuleForSignals('see docs/architecture/overview.txt', '', undefined);
      expect(signals).not.toContain('deep_path');
    });

    it('does not flag URLs as deep paths', () => {
      const { signals } = scanRuleForSignals('see https://example.com/a/b/c.ts for details', '', undefined);
      expect(signals).not.toContain('deep_path');
    });

    it('detects version_pin', () => {
      const { signals } = scanRuleForSignals('We use React 18.2 in production', '', undefined);
      expect(signals).toContain('version_pin');
    });

    it('detects func_sig', () => {
      const { signals } = scanRuleForSignals('call `fetchUser(id: string): Promise<User>` here', '', undefined);
      expect(signals).toContain('func_sig');
    });
  });
});
