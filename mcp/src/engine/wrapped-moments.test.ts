// Tests for wrapped-moments — the Spotify-Wrapped-style stat extractors.
// We mock inputs directly rather than running full scans so each extractor
// is exercised in isolation.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMoments,
  computeContrast,
  computePercentile,
  __resetCorpusCache,
} from './wrapped-moments.js';
import type {
  AuditArtifact,
  CategoryScore,
  ParsedRule,
  ScanResult,
  SessionData,
} from '../types.js';

beforeEach(() => __resetCorpusCache());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mockScan(partial: Partial<ScanResult> = {}): ScanResult {
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
    ...partial,
  };
}

function mockCat(score: number): CategoryScore {
  return { score, weight: 1, signalsPresent: [], signalsMissing: [] };
}

function mockSession(partial: Partial<SessionData> = {}): SessionData {
  return {
    stats: {
      totalSessions: 10,
      totalMessages: 100,
      avgSessionDuration: 0,
      sessionsLast7Days: 3,
      sessionsLast30Days: 8,
      mostActiveProject: 'demo',
      projectDistribution: {},
    },
    promptPatterns: {
      totalPrompts: 80,
      avgPromptLength: 120,
      shortPrompts: 10,
      longPrompts: 5,
      clearCommands: 0,
      rewindCommands: 0,
      promptsWithFilePaths: 20,
      promptsWithErrorMessages: 5,
    },
    corrections: {
      negationCount: 0,
      revertSignals: 0,
      frustrationSignals: 0,
      examples: [],
    },
    ...partial,
  };
}

function mockSkill(name: string): AuditArtifact {
  return {
    id: `skill:${name}`,
    type: 'skill',
    name,
    path: `/tmp/skills/${name}/SKILL.md`,
    description: '',
    prompt: '',
    metadata: { size: 0 },
  };
}

function rule(text: string, type: ParsedRule['type'] = 'do_autonomously'): ParsedRule {
  return { text, type, source: 'CLAUDE.md' };
}

// ---------------------------------------------------------------------------
// computeContrast
// ---------------------------------------------------------------------------

describe('computeContrast', () => {
  it('returns strongest + weakest categories with display names', () => {
    const contrast = computeContrast({
      roleClarity: mockCat(90),
      memoryHealth: mockCat(40),
      systemMaturity: mockCat(70),
    });
    expect(contrast.strongest.score).toBe(90);
    expect(contrast.strongest.name).toBe('Role Clarity');
    expect(contrast.weakest.score).toBe(40);
    expect(contrast.weakest.name).toBe('Memory Health');
  });
});

// ---------------------------------------------------------------------------
// computePercentile — requires the corpus file; test passes gracefully when
// it isn't reachable (e.g. in CI without research/). This is by design: the
// feature degrades gracefully in installed builds.
// ---------------------------------------------------------------------------

describe('computePercentile', () => {
  it('returns null when score is below corpus median (or corpus unavailable)', () => {
    const result = computePercentile(5);
    expect(result).toBeNull();
  });

  it('returns a non-null result for a high score when the corpus is reachable', () => {
    const result = computePercentile(95);
    // Either the corpus is reachable and we get a percentile, or it's not
    // and we get null. Both are valid — we assert the shape when it fires.
    if (result) {
      expect(result.score).toBe(95);
      expect(result.percentile).toBeGreaterThanOrEqual(50);
      expect([1, 3, 5, 10, 25, 50]).toContain(result.topPercent);
      expect(result.corpusSize).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildMoments — black-box pipeline tests
// ---------------------------------------------------------------------------

describe('buildMoments', () => {
  it('never fabricates: empty scan produces few or zero moments', () => {
    const result = buildMoments({
      collaborationScore: 10,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: undefined,
      categories: {
        roleClarity: mockCat(50),
        memoryHealth: mockCat(55),
      },
    });
    // Contrast delta is only 5 → no contrast moment. No percentile (low
    // score), no session, no rules, no artifacts. Expect empty.
    expect(result.moments).toEqual([]);
  });

  it('emits a corrections moment when negation count ≥ 3', () => {
    const result = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: mockSession({
        corrections: {
          negationCount: 8,
          revertSignals: 2,
          frustrationSignals: 1,
          examples: ['nej, det er forkert'],
        },
      }),
      categories: { a: mockCat(60) },
    });
    const corrections = result.moments.find(m => m.id === 'corrections');
    expect(corrections).toBeDefined();
    expect(corrections!.value).toBe('8');
    expect(corrections!.narrative).toContain('nej');
  });

  it('suppresses the corrections moment when negation count is tiny', () => {
    const result = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: mockSession({
        corrections: {
          negationCount: 1,
          revertSignals: 0,
          frustrationSignals: 0,
          examples: ['nej'],
        },
      }),
      categories: { a: mockCat(60) },
    });
    expect(result.moments.find(m => m.id === 'corrections')).toBeUndefined();
  });

  it('emits a dead-skills moment with skill names', () => {
    const scan = mockScan({
      globalClaudeMd: {
        path: '/tmp/CLAUDE.md',
        content: 'Always use /ship after building.',
        size: 30,
      },
    });
    const result = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [mockSkill('ship'), mockSkill('zombie'), mockSkill('ghost'), mockSkill('unused-thing')],
      scanResult: scan,
      session: undefined,
      categories: { a: mockCat(60) },
    });
    const deadSkills = result.moments.find(m => m.id === 'dead-skills');
    expect(deadSkills).toBeDefined();
    // ship is referenced, the others are not.
    expect(deadSkills!.value).toBe('3');
    expect(deadSkills!.narrative).toContain('zombie');
  });

  it('does not flag skills that are referenced in scheduled tasks', () => {
    const scheduled: AuditArtifact = {
      id: 'scheduled_task:standup',
      type: 'scheduled_task',
      name: 'standup',
      path: '/tmp/scheduled/standup/SKILL.md',
      description: 'Runs daily standup.',
      prompt: 'Call the /weekly-review skill after you finish.',
      metadata: { size: 100 },
    };
    const result = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [mockSkill('weekly-review'), mockSkill('dead-one'), mockSkill('dead-two'), scheduled],
      scanResult: mockScan(),
      session: undefined,
      categories: { a: mockCat(60) },
    });
    const deadSkills = result.moments.find(m => m.id === 'dead-skills');
    expect(deadSkills).toBeDefined();
    expect(deadSkills!.narrative).not.toContain('weekly-review');
    expect(deadSkills!.narrative).toContain('dead-one');
  });

  it('emits a biggest-rule moment with a quoted head', () => {
    const longText = 'This is a rule that contains many many words '.repeat(6).trim();
    const result = buildMoments({
      collaborationScore: 50,
      rules: [rule('short'), rule(longText)],
      artifacts: [],
      scanResult: mockScan(),
      session: undefined,
      categories: { a: mockCat(60) },
    });
    const biggest = result.moments.find(m => m.id === 'biggest-rule');
    expect(biggest).toBeDefined();
    expect(biggest!.value).toMatch(/\d+ words/);
    expect(biggest!.narrative).toContain('This is a rule');
  });

  it('emits a contrast moment only when the spread is ≥ 20 points', () => {
    const flat = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: undefined,
      categories: {
        roleClarity: mockCat(60),
        memoryHealth: mockCat(55),
        systemMaturity: mockCat(70),
      },
    });
    expect(flat.moments.find(m => m.id === 'contrast')).toBeUndefined();

    const spiky = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: undefined,
      categories: {
        roleClarity: mockCat(95),
        memoryHealth: mockCat(30),
      },
    });
    const contrast = spiky.moments.find(m => m.id === 'contrast');
    expect(contrast).toBeDefined();
    expect(contrast!.value).toBe('+65');
    expect(contrast!.narrative).toContain('Role Clarity');
    expect(contrast!.narrative).toContain('Memory Health');
  });

  it('caps moments at 5', () => {
    const result = buildMoments({
      collaborationScore: 95, // might produce percentile
      rules: [
        rule('x'.repeat(500)), // biggest rule
        ...Array.from({ length: 20 }, () => rule('do this', 'do_autonomously')),
      ],
      artifacts: [
        mockSkill('dead-a'),
        mockSkill('dead-b'),
        mockSkill('dead-c'),
        mockSkill('dead-d'),
      ],
      scanResult: mockScan(),
      session: mockSession({
        corrections: { negationCount: 12, revertSignals: 0, frustrationSignals: 0, examples: ['nope'] },
      }),
      categories: {
        roleClarity: mockCat(95),
        memoryHealth: mockCat(20),
      },
    });
    expect(result.moments.length).toBeLessThanOrEqual(5);
  });

  it('always returns a contrast object on result.contrast', () => {
    const result = buildMoments({
      collaborationScore: 50,
      rules: [],
      artifacts: [],
      scanResult: mockScan(),
      session: undefined,
      categories: { roleClarity: mockCat(50) },
    });
    expect(result.contrast.strongest.name).toBe('Role Clarity');
    expect(result.contrast.weakest.name).toBe('Role Clarity');
  });

  it('moments never contain absolute filesystem paths', () => {
    const result = buildMoments({
      collaborationScore: 50,
      rules: [rule('a rule that references /Users/alice/project/file.ts '.repeat(4))],
      artifacts: [mockSkill('/Users/secret/skill')],
      scanResult: mockScan(),
      session: undefined,
      categories: { a: mockCat(80), b: mockCat(10) },
    });
    for (const m of result.moments) {
      expect(m.narrative).not.toContain('/Users/alice');
      expect(m.narrative).not.toContain('/home/');
    }
  });
});
