import { describe, it, expect } from 'vitest';
import { detectArchetype, getArchetype, ARCHETYPE_DEFINITIONS } from './archetype-detector.js';
import type {
  AnalysisReport,
  ArchetypeResult,
  ParseResult,
  ParsedRule,
  ParsedSection,
  ScanResult,
} from '../types.js';

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    rules: [],
    sections: [],
    learnings: [],
    projectCount: 0,
    ...overrides,
  };
}

function makeScan(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    scope: 'global',
    scanRoots: [],
    globalClaudeMd: null,
    projectClaudeMd: null,
    memoryFiles: [],
    settingsFiles: [],
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    installedServers: [],
    competingFormats: { cursorrules: false, agentsMd: false, copilotInstructions: false },
    projectsObserved: 0,
    ...overrides,
  };
}

function rule(type: ParsedRule['type'], text = 'placeholder'): ParsedRule {
  return { type, text, source: 'CLAUDE.md' };
}

function section(id: string, content = ''): ParsedSection {
  return { id, header: id, content, source: 'CLAUDE.md' };
}

describe('archetype-detector', () => {
  describe('fresh_install', () => {
    it('wins when total artifacts are below threshold, even with a handful of rules', () => {
      const result = detectArchetype(
        makeParsed({ rules: [rule('do_autonomously'), rule('ask_first')] }),
        makeScan(),
      );
      expect(result.id).toBe('fresh_install');
      expect(result.nameEn).toBe('Fresh install');
      expect(result.reasons[0]).toMatch(/below the 20 threshold/);
    });

    it('wins for an entirely empty scan', () => {
      const result = detectArchetype(makeParsed(), makeScan());
      expect(result.id).toBe('fresh_install');
    });
  });

  describe('automation_orchard', () => {
    it('wins with many scheduled tasks + hooks', () => {
      const result = detectArchetype(
        makeParsed({
          rules: Array.from({ length: 5 }, () => rule('do_autonomously')),
        }),
        makeScan({
          scheduledTasksCount: 6,
          hooksCount: 4,
          skillsCount: 10,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('automation_orchard');
      expect(result.reasons[0]).toMatch(/scheduled tasks, 4 hooks/);
    });

    it('does not trigger on only hooks without schedules', () => {
      const result = detectArchetype(
        makeParsed({ rules: Array.from({ length: 5 }, () => rule('do_autonomously')) }),
        makeScan({
          scheduledTasksCount: 2,
          hooksCount: 8,
          skillsCount: 10,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).not.toBe('automation_orchard');
    });
  });

  describe('polyglot_stack', () => {
    it('wins with many MCP servers across many stacks', () => {
      const result = detectArchetype(
        makeParsed({
          rules: Array.from({ length: 6 }, () => rule('do_autonomously')),
          sections: [
            section('stack', 'We use TypeScript, Python for ML, Go for the API, and Rust for the edge layer.'),
          ],
        }),
        makeScan({
          mcpServersCount: 6,
          hooksCount: 1,
          skillsCount: 5,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('polyglot_stack');
      expect(result.signals.stacksDetected).toBeGreaterThanOrEqual(3);
    });
  });

  describe('guardrail_first', () => {
    it('wins with many prohibitions and few autonomous rules', () => {
      const result = detectArchetype(
        makeParsed({
          rules: [
            ...Array.from({ length: 10 }, () => rule('prohibition', 'never do X')),
            rule('do_autonomously', 'ship the thing'),
            rule('do_autonomously', 'tidy up'),
          ],
        }),
        makeScan({
          hooksCount: 2,
          skillsCount: 3,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('guardrail_first');
      expect(result.reasons[0]).toMatch(/prohibitions vs/);
    });
  });

  describe('trust_and_go', () => {
    it('wins with many do-rules and almost no prohibitions', () => {
      const result = detectArchetype(
        makeParsed({
          rules: [
            ...Array.from({ length: 12 }, () => rule('do_autonomously', 'ship, test, commit')),
            rule('prohibition', 'never commit secrets'),
          ],
        }),
        makeScan({
          hooksCount: 1,
          skillsCount: 3,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('trust_and_go');
      expect(result.reasons[0]).toMatch(/autonomous rules/);
    });
  });

  describe('rule_heavy_solo', () => {
    it('wins with many rules, no team signals, light automation', () => {
      const result = detectArchetype(
        makeParsed({
          rules: [
            ...Array.from({ length: 10 }, () => rule('do_autonomously', 'do solo work')),
            ...Array.from({ length: 6 }, () => rule('ask_first', 'ask before refactor')),
            ...Array.from({ length: 3 }, () => rule('prohibition', 'dont touch prod')),
          ],
        }),
        makeScan({
          hooksCount: 1,
          skillsCount: 2,
          scheduledTasksCount: 1,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('rule_heavy_solo');
      expect(result.nameEn).toBe('Rule-heavy solo');
    });

    it('does NOT match when team signals appear in rules', () => {
      const result = detectArchetype(
        makeParsed({
          rules: [
            ...Array.from({ length: 10 }, () => rule('do_autonomously', 'do work')),
            ...Array.from({ length: 6 }, () => rule('ask_first', 'ask first')),
            rule('suggest_only', 'suggest PR reviews and code review best practices'),
            ...Array.from({ length: 3 }, () => rule('prohibition', 'no')),
          ],
        }),
        makeScan({
          hooksCount: 1,
          skillsCount: 2,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).not.toBe('rule_heavy_solo');
    });
  });

  describe('balanced (fallback)', () => {
    it('wins when nothing is extreme', () => {
      const result = detectArchetype(
        makeParsed({
          rules: [
            // Moderate ruleset — below rule-heavy threshold (15), above fresh-install dimension.
            ...Array.from({ length: 5 }, () => rule('do_autonomously', 'do')),
            ...Array.from({ length: 3 }, () => rule('ask_first', 'ask')),
            ...Array.from({ length: 2 }, () => rule('suggest_only', 'suggest')),
            ...Array.from({ length: 3 }, () => rule('prohibition', 'never')),
          ],
        }),
        makeScan({
          hooksCount: 2,
          skillsCount: 3,
          scheduledTasksCount: 2,
          mcpServersCount: 2,
          memoryFiles: new Array(8).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('balanced');
      expect(result.nameEn).toBe('Balanced');
      expect(result.reasons[0]).toMatch(/balance/i);
    });
  });

  describe('priority ordering', () => {
    it('fresh_install beats trust_and_go even when do-rules are high in isolation', () => {
      // Here we have 12 do-rules but only 12 total artifacts — still below threshold.
      const result = detectArchetype(
        makeParsed({
          rules: Array.from({ length: 12 }, () => rule('do_autonomously', 'do')),
        }),
        makeScan(),
      );
      expect(result.id).toBe('fresh_install');
    });

    it('automation_orchard beats rule_heavy_solo when both could match', () => {
      const result = detectArchetype(
        makeParsed({
          rules: Array.from({ length: 20 }, () => rule('do_autonomously', 'solo work')),
        }),
        makeScan({
          scheduledTasksCount: 6,
          hooksCount: 5,
          skillsCount: 10,
          memoryFiles: new Array(10).fill({ path: 'm', content: '', size: 100 }),
        }),
      );
      expect(result.id).toBe('automation_orchard');
    });
  });

  describe('getArchetype helper', () => {
    it('returns archetype off a report', () => {
      const fakeArchetype: ArchetypeResult = {
        id: 'balanced',
        nameEn: 'Balanced',
        nameDa: 'Afbalanceret',
        description: 'x',
        strengths: [],
        watchouts: [],
        reasons: [],
        signals: {
          totalArtifacts: 0, rulesTotal: 0, doCount: 0, neverCount: 0,
          hooksCount: 0, scheduledTasksCount: 0, mcpServersCount: 0, stacksDetected: 0,
        },
      };
      const report = { archetype: fakeArchetype } as AnalysisReport;
      expect(getArchetype(report)).toBe(fakeArchetype);
    });
  });

  describe('definitions', () => {
    it('has all 7 archetype definitions with required fields', () => {
      const ids: Array<keyof typeof ARCHETYPE_DEFINITIONS> = [
        'fresh_install', 'automation_orchard', 'polyglot_stack',
        'guardrail_first', 'trust_and_go', 'rule_heavy_solo', 'balanced',
      ];
      for (const id of ids) {
        const def = ARCHETYPE_DEFINITIONS[id];
        expect(def).toBeDefined();
        expect(def.nameEn.length).toBeGreaterThan(0);
        expect(def.nameDa.length).toBeGreaterThan(0);
        expect(def.description.length).toBeGreaterThan(10);
        expect(def.strengths.length).toBeGreaterThanOrEqual(2);
        expect(def.watchouts.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
