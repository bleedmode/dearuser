import { describe, it, expect } from 'vitest';
import { detectStrengths } from './strengths-detector.js';
import type { AnalysisStats, ArchetypeResult } from '../types.js';

function makeStats(overrides: Partial<AnalysisStats> = {}): AnalysisStats {
  return {
    totalRules: 0,
    doRules: 0,
    askRules: 0,
    suggestRules: 0,
    prohibitionRules: 0,
    prohibitionRatio: 0,
    totalLearnings: 0,
    memoryFiles: 0,
    feedbackMemories: 0,
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    projectsManaged: 0,
    ...overrides,
  };
}

function makeArchetype(id: ArchetypeResult['id'] = 'balanced'): ArchetypeResult {
  return {
    id,
    nameEn: 'Balanced',
    nameDa: 'Balanceret',
    description: '',
    strengths: [],
    watchouts: [],
    reasons: [],
    signals: {
      totalArtifacts: 0,
      rulesTotal: 0,
      doCount: 0,
      neverCount: 0,
      hooksCount: 0,
      scheduledTasksCount: 0,
      mcpServersCount: 0,
      stacksDetected: 0,
    },
  };
}

const emptyFeedback = {
  totalRecommendations: 0,
  implemented: 0,
  ignored: 0,
  pending: 0,
};

describe('detectStrengths', () => {
  it('returns empty on a bare fresh install', () => {
    const wins = detectStrengths({
      stats: makeStats(),
      categories: {},
      archetype: makeArchetype('fresh_install'),
      feedback: emptyFeedback,
    });
    expect(wins).toEqual([]);
  });

  it('fires "feedback loop closes" when ≥3 recs and ≥40% implemented', () => {
    const wins = detectStrengths({
      stats: makeStats(),
      categories: {},
      archetype: makeArchetype(),
      feedback: { totalRecommendations: 5, implemented: 3, ignored: 1, pending: 1 },
    });
    expect(wins.find(w => w.title.includes('feedback loop'))).toBeDefined();
  });

  it('does NOT fire "feedback loop closes" below minimum sample size', () => {
    const wins = detectStrengths({
      stats: makeStats(),
      categories: {},
      archetype: makeArchetype(),
      feedback: { totalRecommendations: 2, implemented: 2, ignored: 0, pending: 0 },
    });
    expect(wins.find(w => w.title.includes('feedback loop'))).toBeUndefined();
  });

  it('does NOT fire "feedback loop closes" when close rate is low', () => {
    const wins = detectStrengths({
      stats: makeStats(),
      categories: {},
      archetype: makeArchetype(),
      feedback: { totalRecommendations: 10, implemented: 2, ignored: 5, pending: 3 },
    });
    expect(wins.find(w => w.title.includes('feedback loop'))).toBeUndefined();
  });

  it('fires "memory system is paying rent" when memory files + health align', () => {
    const wins = detectStrengths({
      stats: makeStats({ memoryFiles: 10 }),
      categories: { memoryHealth: { score: 85 } },
      archetype: makeArchetype(),
      feedback: emptyFeedback,
    });
    expect(wins.find(w => w.title.includes('memory system'))).toBeDefined();
  });

  it('fires "guardrails" when hooks ≥2 and quality standards ≥80', () => {
    const wins = detectStrengths({
      stats: makeStats({ hooksCount: 3 }),
      categories: { qualityStandards: { score: 85 } },
      archetype: makeArchetype(),
      feedback: emptyFeedback,
    });
    expect(wins.find(w => w.title.includes('Guardrails'))).toBeDefined();
  });

  it('fires "automation is doing real work" on automation_orchard archetype', () => {
    const wins = detectStrengths({
      stats: makeStats({ scheduledTasksCount: 3, hooksCount: 1 }),
      categories: {},
      archetype: makeArchetype('automation_orchard'),
      feedback: emptyFeedback,
    });
    expect(wins.find(w => w.title.includes('Automation'))).toBeDefined();
  });

  it('caps at 4 wins even when more would fire', () => {
    const wins = detectStrengths({
      stats: makeStats({
        memoryFiles: 12,
        feedbackMemories: 8,
        totalRules: 30,
        hooksCount: 4,
        scheduledTasksCount: 6,
      }),
      categories: {
        memoryHealth: { score: 90 },
        qualityStandards: { score: 90 },
        roleClarity: { score: 90 },
        communication: { score: 90 },
      },
      archetype: makeArchetype('automation_orchard'),
      feedback: { totalRecommendations: 10, implemented: 7, ignored: 1, pending: 2 },
    });
    expect(wins.length).toBeLessThanOrEqual(4);
  });

  it('every win has tag=win + non-empty title + non-empty body', () => {
    const wins = detectStrengths({
      stats: makeStats({
        memoryFiles: 12,
        feedbackMemories: 8,
        totalRules: 30,
        hooksCount: 4,
        scheduledTasksCount: 6,
      }),
      categories: {
        memoryHealth: { score: 90 },
        qualityStandards: { score: 90 },
        roleClarity: { score: 90 },
        communication: { score: 90 },
      },
      archetype: makeArchetype('automation_orchard'),
      feedback: { totalRecommendations: 10, implemented: 7, ignored: 1, pending: 2 },
    });
    for (const w of wins) {
      expect(w.tag).toBe('win');
      expect(w.title.length).toBeGreaterThan(0);
      expect(w.body.length).toBeGreaterThan(0);
    }
  });
});
