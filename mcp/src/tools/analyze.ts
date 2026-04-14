// analyze tool — full collaboration analysis

import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { detectPersona } from '../engine/persona-detector.js';
import { score } from '../engine/scorer.js';
import { analyzeFriction } from '../engine/friction-analyzer.js';
import { detectGaps } from '../engine/gap-detector.js';
import { generateRecommendations } from '../templates/recommendations.js';
import { generateUserCoaching } from '../templates/user-coaching.js';
import { analyzeSession } from '../engine/session-analyzer.js';
import { trackRecommendations, checkImplementation } from '../engine/feedback-tracker.js';
import { scanGitRepos } from '../engine/git-scanner.js';
import type { GitScanResult } from '../engine/git-scanner.js';
import { scanArtifacts } from '../engine/audit-scanner.js';
import { detectInjection } from '../engine/injection-detector.js';
import { generateProactiveRecommendations } from '../engine/proactive-recommender.js';
import type { AnalysisReport, AnalysisStats, WrappedData, Scope, GitSummary } from '../types.js';

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

/** Build the aggregated GitSummary shown in the report from a raw scan result. */
function buildGitSummary(git: GitScanResult): GitSummary {
  const reposWithRevertSignals = git.repos.filter(r => r.revertSignals.length > 0).length;
  const reposWithUncommittedPile = git.repos.filter(r => r.uncommittedFiles >= 10).length;

  const topActive = git.repos
    .filter(r => r.commits7d > 0)
    .sort((a, b) => b.commits7d - a.commits7d)
    .slice(0, 5)
    .map(r => ({ name: r.name, path: r.path, commits7d: r.commits7d, commits30d: r.commits30d }));

  const topStale = git.repos
    .filter(r => r.staleDays !== null && r.staleDays > 60)
    .sort((a, b) => (b.staleDays || 0) - (a.staleDays || 0))
    .slice(0, 5)
    .map(r => ({ name: r.name, path: r.path, staleDays: r.staleDays as number }));

  return {
    totalScanned: git.totalScanned,
    active: git.active.length,
    stale: git.stale.length,
    reposWithRevertSignals,
    reposWithUncommittedPile,
    topActive,
    topStale,
  };
}

export interface AnalysisOptions {
  scope?: Scope;
  /** Scan local .git directories for activity signals. Defaults to true. */
  includeGit?: boolean;
}

export function runAnalysis(
  projectRoot: string,
  scopeOrOptions: Scope | AnalysisOptions = 'global',
): AnalysisReport {
  const options: AnalysisOptions = typeof scopeOrOptions === 'string'
    ? { scope: scopeOrOptions }
    : scopeOrOptions;
  const scope = options.scope || 'global';
  const includeGit = options.includeGit !== false;

  // 1. Scan filesystem — global by default. Collaboration quality is a
  //    property of the human↔agent pair, not a single project.
  const scanResult = scan(projectRoot, scope);

  // 2. Parse content
  const parsed = parse(scanResult);

  // 3. Session analysis (before scoring so it can inform scores)
  const sessionData = analyzeSession(projectRoot);

  // 4. Detect persona
  const persona = detectPersona(parsed, scanResult);

  // 5. Analyze friction — pass session data so correction examples contribute
  const frictionPatterns = analyzeFriction(parsed, scanResult, sessionData);

  // 6. Detect gaps
  const gaps = detectGaps(parsed, scanResult, persona.detected);

  // 7. Git scanning — local .git activity across observed project roots
  //    Opt-out via includeGit=false for fast analyse-only runs or CI contexts.
  const git: GitScanResult | null = includeGit
    ? scanGitRepos(scanResult.scanRoots)
    : null;

  // 8. Artifact discovery (reused from audit) + injection detection
  //    These are cheap reads — we always do them in analyze now so the
  //    "proactive" recs have a real surface to reason about.
  const artifacts = scanArtifacts();
  const injection = detectInjection(artifacts);

  // 9. Generate recommendations — three tracks now:
  //    (a) agent-facing gap fills (file/config fixes)
  //    (b) user-facing behavior coaching (from friction patterns)
  //    (c) proactive pattern-based (from repeated CLIs, stale repos, /clear
  //        overuse, revert hotspots — things analyze never surfaced before)
  const agentRecs = generateRecommendations(gaps, persona.detected);
  const userRecs = generateUserCoaching(frictionPatterns);
  const proactiveRecs = generateProactiveRecommendations({
    artifacts,
    session: sessionData,
    git,
  });
  const recommendations = [...agentRecs, ...userRecs, ...proactiveRecs];

  // 10. Build stats
  const stats = buildStats(parsed, scanResult);

  // 11. Score categories (with session data for friction-based adjustments)
  const { categories, collaborationScore } = score(parsed, scanResult, sessionData);

  // 12. Build wrapped data
  const wrapped = buildWrapped(stats, persona, frictionPatterns);

  // 13. Feedback loop — check previous recommendations + track new ones
  const claudeMdContent = [scanResult.globalClaudeMd?.content, scanResult.projectClaudeMd?.content]
    .filter(Boolean).join('\n');
  const settingsContent = scanResult.settingsFiles.map(f => f.content).join('\n');
  const feedback = checkImplementation(claudeMdContent, settingsContent, collaborationScore);
  trackRecommendations(recommendations, collaborationScore);

  return {
    version: '2.0',
    generatedAt: new Date().toISOString(),
    scanRoot: projectRoot,
    scope: scanResult.scope,
    projectsObserved: scanResult.projectsObserved,
    installedServers: scanResult.installedServers,
    persona,
    collaborationScore,
    categories,
    frictionPatterns,
    gaps,
    stats,
    recommendations,
    wrapped,
    session: sessionData,
    git: git ? buildGitSummary(git) : null,
    injection,
    feedback,
  };
}
