// analyze tool — full collaboration analysis

import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { detectPersona } from '../engine/persona-detector.js';
import { score } from '../engine/scorer.js';
import { analyzeFriction } from '../engine/friction-analyzer.js';
import { detectGaps } from '../engine/gap-detector.js';
import { generateRecommendations } from '../templates/recommendations.js';
import { analyzeSession } from '../engine/session-analyzer.js';
import { trackRecommendations, checkImplementation } from '../engine/feedback-tracker.js';
import type { AnalysisReport, AnalysisStats, WrappedData } from '../types.js';

function buildStats(parsed: ReturnType<typeof parse>, scanResult: ReturnType<typeof scan>): AnalysisStats {
  const doRules = parsed.rules.filter(r => r.type === 'do_autonomously').length;
  const askRules = parsed.rules.filter(r => r.type === 'ask_first').length;
  const suggestRules = parsed.rules.filter(r => r.type === 'suggest_only').length;
  const prohibitionRules = parsed.rules.filter(r => r.type === 'prohibition').length;
  const feedbackMemories = scanResult.memoryFiles.filter(m => m.path.includes('feedback_')).length;

  return {
    totalRules: parsed.rules.length,
    doRules,
    askRules,
    suggestRules,
    prohibitionRules,
    prohibitionRatio: parsed.rules.length > 0 ? prohibitionRules / parsed.rules.length : 0,
    totalLearnings: parsed.learnings.length,
    memoryFiles: scanResult.memoryFiles.length,
    feedbackMemories,
    hooksCount: scanResult.hooksCount,
    skillsCount: scanResult.skillsCount,
    scheduledTasksCount: scanResult.scheduledTasksCount,
    commandsCount: scanResult.commandsCount,
    mcpServersCount: scanResult.mcpServersCount,
    projectsManaged: parsed.projectCount,
  };
}

function buildWrapped(stats: AnalysisStats, persona: ReturnType<typeof detectPersona>, friction: ReturnType<typeof analyzeFriction>): WrappedData {
  const total = stats.doRules + stats.askRules + stats.suggestRules;
  const doSelf = total > 0 ? Math.round((stats.doRules / total) * 100) : 0;
  const askFirst = total > 0 ? Math.round((stats.askRules / total) * 100) : 0;
  const suggest = total > 0 ? Math.round((stats.suggestRules / total) * 100) : 0;

  return {
    headlineStat: {
      value: String(stats.feedbackMemories),
      label: 'times your agent was corrected — and remembered every single one',
    },
    topLesson: friction.length > 0
      ? { quote: friction[0].title, context: friction[0].description }
      : null,
    autonomySplit: { doSelf, askFirst, suggest },
    archetype: {
      name: persona.archetypeName,
      traits: persona.traits,
      description: persona.archetypeDescription,
    },
    systemGrid: {
      hooks: stats.hooksCount,
      skills: stats.skillsCount,
      scheduled: stats.scheduledTasksCount,
      rules: stats.totalRules,
    },
    shareCard: {
      corrections: stats.feedbackMemories,
      memories: stats.memoryFiles,
      projects: stats.projectsManaged,
      prohibitionRatio: `${Math.round(stats.prohibitionRatio * 100)}%`,
    },
  };
}

export function runAnalysis(projectRoot: string): AnalysisReport {
  // 1. Scan filesystem
  const scanResult = scan(projectRoot);

  // 2. Parse content
  const parsed = parse(scanResult);

  // 3. Session analysis (before scoring so it can inform scores)
  const sessionData = analyzeSession(projectRoot);

  // 4. Detect persona
  const persona = detectPersona(parsed, scanResult);

  // 5. Analyze friction
  const frictionPatterns = analyzeFriction(parsed, scanResult);

  // 6. Detect gaps
  const gaps = detectGaps(parsed, scanResult, persona.detected);

  // 7. Generate recommendations
  const recommendations = generateRecommendations(gaps, persona.detected);

  // 8. Build stats
  const stats = buildStats(parsed, scanResult);

  // 9. Score categories (with session data for friction-based adjustments)
  const { categories, collaborationScore } = score(parsed, scanResult, sessionData);

  // 10. Build wrapped data
  const wrapped = buildWrapped(stats, persona, frictionPatterns);

  // 11. Feedback loop — check previous recommendations + track new ones
  const claudeMdContent = [scanResult.globalClaudeMd?.content, scanResult.projectClaudeMd?.content]
    .filter(Boolean).join('\n');
  const settingsContent = scanResult.settingsFiles.map(f => f.content).join('\n');
  const feedback = checkImplementation(claudeMdContent, settingsContent, collaborationScore);
  trackRecommendations(recommendations, collaborationScore);

  return {
    version: '2.0',
    generatedAt: new Date().toISOString(),
    scanRoot: projectRoot,
    persona,
    collaborationScore,
    categories,
    frictionPatterns,
    gaps,
    stats,
    recommendations,
    wrapped,
    session: sessionData,
    feedback,
  };
}
