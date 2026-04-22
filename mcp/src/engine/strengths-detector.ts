// Strengths detector — finds things the user's setup does well.
//
// Strengths are STRENGTH findings (tag: 'win'). They don't require action —
// they're acknowledgment. A report without strengths reads like a nag ("fix
// these 8 things"); a report with 2-3 earned strengths reads like feedback
// from a colleague who actually noticed what works.
//
// Every strength gates on minimum sample size. False-positive strengths are
// worse than missing ones — "feedback loop closes" off 1 implemented rec
// would be embarrassing.

import type { AnalysisStats, ArchetypeResult, Finding } from '../types.js';

interface StrengthSignals {
  stats: AnalysisStats;
  categories: Record<string, { score: number }>;
  archetype: ArchetypeResult;
  feedback: {
    totalRecommendations: number;
    implemented: number;
    ignored: number;
    pending: number;
  };
}

/**
 * Detect strengths in the user's setup. Returns 0-4 findings, ordered by
 * signal strength. Each body cites the concrete number that triggered it.
 */
export function detectStrengths(signals: StrengthSignals): Finding[] {
  const { stats, categories, archetype, feedback } = signals;
  const wins: Array<Finding & { _weight: number }> = [];

  // 1. Feedback loop actually closes — recommendations land somewhere.
  //    Gate: need at least 3 tracked recs to avoid noise on fresh installs.
  if (feedback.totalRecommendations >= 3) {
    const closeRate = feedback.implemented / feedback.totalRecommendations;
    if (closeRate >= 0.4) {
      wins.push({
        tag: 'win',
        title: 'Your feedback loop actually closes',
        body: `${feedback.implemented} of ${feedback.totalRecommendations} recommendations have actually been implemented. Most setups produce recommendations that never land — the habit of acting on them is doing real work.`,
        _weight: 100 + Math.round(closeRate * 20),
      });
    }
  }

  // 2. Memory system that's paying rent — thorough memory + healthy category.
  const memoryHealth = categories.memoryHealth?.score ?? 0;
  if (stats.memoryFiles >= 8 && memoryHealth >= 80) {
    wins.push({
      tag: 'win',
      title: 'Your memory system is paying rent',
      body: `${stats.memoryFiles} memory files with a memory-health score of ${memoryHealth}/100. This is the layer that keeps corrections from evaporating between sessions.`,
      _weight: 80 + memoryHealth / 5,
    });
  }

  // 3. Clear rules with a correction loop — user writes feedback files and
  //    the rule count is substantive.
  if (stats.feedbackMemories >= 5 && stats.totalRules >= 10) {
    wins.push({
      tag: 'win',
      title: 'Clear rules with a correction loop',
      body: `${stats.feedbackMemories} feedback memories on top of ${stats.totalRules} rules. You're not just writing a config — you're writing lessons back to it after mistakes.`,
      _weight: 70 + Math.min(stats.feedbackMemories, 20),
    });
  }

  // 4. Guardrails catching things — hooks + strong qualityStandards score.
  const qualityStandards = categories.qualityStandards?.score ?? 0;
  if (stats.hooksCount >= 2 && qualityStandards >= 80) {
    wins.push({
      tag: 'win',
      title: 'Guardrails that actually catch things',
      body: `${stats.hooksCount} hooks configured and a Quality Standards score of ${qualityStandards}/100. Your setup catches mistakes before they reach you — the automation layer is earning its keep.`,
      _weight: 60 + qualityStandards / 10,
    });
  }

  // 5. Automation is doing real work — archetype-driven or raw signal-driven.
  const isOrchard = archetype.id === 'automation_orchard';
  const strongAutomationSignals = stats.scheduledTasksCount >= 5 && stats.hooksCount >= 2;
  if (isOrchard || strongAutomationSignals) {
    wins.push({
      tag: 'win',
      title: 'Automation is doing real work',
      body: `${stats.scheduledTasksCount} scheduled task${stats.scheduledTasksCount === 1 ? '' : 's'} and ${stats.hooksCount} hook${stats.hooksCount === 1 ? '' : 's'} running in the background. The work happens whether you're there or not.`,
      _weight: 55 + stats.scheduledTasksCount,
    });
  }

  // 6. CLAUDE.md is load-bearing — role/communication categories both strong
  //    and rule count is substantive.
  const roleClarity = categories.roleClarity?.score ?? 0;
  const communication = categories.communication?.score ?? 0;
  if (roleClarity >= 75 && communication >= 75 && stats.totalRules >= 10) {
    wins.push({
      tag: 'win',
      title: 'CLAUDE.md is load-bearing, not decorative',
      body: `Role Clarity ${roleClarity}/100 and Communication ${communication}/100 with ${stats.totalRules} rules. Your instructions file is actually telling your agent who does what — not just listing your tech stack.`,
      _weight: 50 + (roleClarity + communication) / 10,
    });
  }

  // Rank by weight, cap at 4, strip internal weight field.
  return wins
    .sort((a, b) => b._weight - a._weight)
    .slice(0, 4)
    .map(({ _weight: _w, ...f }) => f);
}
