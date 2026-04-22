import { describe, it, expect } from 'vitest';
import { score } from './scorer.js';
import type { ParseResult, ScanResult, ParsedRule, ParsedSection } from '../types.js';

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

function rule(type: ParsedRule['type'], text: string): ParsedRule {
  return { type, text, source: 'CLAUDE.md' };
}

function section(id: string, header: string, content = ''): ParsedSection {
  return { id, header, content, source: 'CLAUDE.md' };
}

describe('score() — calibration R1 + R3 changes', () => {
  it('computes claudeMdSubScore renormalising 4 pure categories', () => {
    const parsed = makeParsed({
      rules: [
        rule('do_autonomously', 'build before you ship — run npm test first'),
        rule('do_autonomously', 'commit changes with conventional messages'),
        rule('do_autonomously', 'document any new public API'),
        rule('ask_first', 'when renaming a public export'),
        rule('prohibition', 'never force-push to main'),
      ],
      sections: [
        section('roles', 'Roles'),
        section('communication', 'Communication'),
        section('autonomy', 'Autonomy'),
        section('commands', 'Commands'),
      ],
    });

    const result = score(parsed, makeScan());

    // Sub-score excludes memoryHealth/systemMaturity/qualityStandards.
    // It should be strictly >= blended score when substrate is empty.
    expect(result.claudeMdSubScore).toBeGreaterThanOrEqual(result.collaborationScore);
    expect(result.substrateEmpty).toBe(true);
  });

  it('flags substrateEmpty=false when any substrate is present', () => {
    const scan = makeScan({ hooksCount: 2 });
    const result = score(makeParsed(), scan);
    expect(result.substrateEmpty).toBe(false);
  });

  it('R3: awards softer autonomy bonus when a starter 3-tier pattern is present', () => {
    // Has 3 do-rules + 1 ask + 1 prohibition — no suggest_only tier.
    // Previously this hit base 30 + 0 = 30 with no tier credit.
    // After R3, this should award +15 via hasMeaningfulBalance.
    const rules: ParsedRule[] = [
      rule('do_autonomously', 'run build before committing changes'),
      rule('do_autonomously', 'use conventional commits for all commits'),
      rule('do_autonomously', 'update memory when a correction sticks'),
      rule('ask_first', 'before deleting a file with business logic'),
      rule('prohibition', 'never skip pre-commit hooks without explicit permission'),
    ];

    const withStarter = score(makeParsed({ rules }), makeScan());

    // No-rules control — pure base + no tier credit
    const noRules = score(makeParsed(), makeScan());

    expect(withStarter.categories.autonomyBalance.score).toBeGreaterThan(
      noRules.categories.autonomyBalance.score,
    );
    expect(
      withStarter.categories.autonomyBalance.signalsPresent.some(s =>
        /meaningful autonomy balance/i.test(s),
      ),
    ).toBe(true);
  });

  it('still awards the bigger hasAllTiers bonus when all 3 action tiers are present', () => {
    const allTiers: ParsedRule[] = [
      rule('do_autonomously', 'run tests'),
      rule('do_autonomously', 'update docs'),
      rule('do_autonomously', 'lint before committing'),
      rule('ask_first', 'before merging to main'),
      rule('suggest_only', 'raise technology migrations'),
      rule('prohibition', 'never force-push'),
    ];
    const starterOnly: ParsedRule[] = [
      rule('do_autonomously', 'run tests'),
      rule('do_autonomously', 'update docs'),
      rule('do_autonomously', 'lint before committing'),
      rule('ask_first', 'before merging to main'),
      rule('prohibition', 'never force-push'),
    ];

    const withAllTiers = score(makeParsed({ rules: allTiers }), makeScan());
    const withStarter = score(makeParsed({ rules: starterOnly }), makeScan());

    // All-tier bonus is still worth more than the softer starter.
    expect(withAllTiers.categories.autonomyBalance.score).toBeGreaterThan(
      withStarter.categories.autonomyBalance.score,
    );
  });
});
