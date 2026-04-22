// analyze tool — full collaboration analysis

import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { detectPersona } from '../engine/persona-detector.js';
import { detectArchetype } from '../engine/archetype-detector.js';
import { score } from '../engine/scorer.js';
import { computeCeiling } from '../engine/ceiling-scorer.js';
import { analyzeFriction } from '../engine/friction-analyzer.js';
import { detectStrengths } from '../engine/strengths-detector.js';
import { buildFindings } from '../engine/findings-builder.js';
import { detectGaps } from '../engine/gap-detector.js';
import { generateRecommendations } from '../templates/recommendations.js';
import { generateUserCoaching } from '../templates/user-coaching.js';
import { analyzeSession } from '../engine/session-analyzer.js';
import { trackRecommendations, trackToolRecommendations, checkImplementation } from '../engine/feedback-tracker.js';
import { friendlyLabel } from '../engine/friendly-labels.js';
import { insertAgentRun, insertScoreHistory } from '../engine/db.js';
import { scanGitRepos } from '../engine/git-scanner.js';
import type { GitScanResult } from '../engine/git-scanner.js';
import { scanArtifacts } from '../engine/audit-scanner.js';
import { detectInjection } from '../engine/injection-detector.js';
import { generateProactiveRecommendations } from '../engine/proactive-recommender.js';
import { recommendTools } from '../templates/tool-catalog.js';
import { lintClaudeMd } from '../engine/lint-checks.js';
import { buildMoments } from '../engine/wrapped-moments.js';
import { feedbackFooter, firstRunWelcome } from '../engine/feedback-nudge.js';
import { gradeBlendedScore, gradePureSubScore } from '../engine/grade.js';
import { followAgentsMdRedirect } from '../engine/agents-md-redirect.js';
import type { AnalysisReport, AnalysisStats, WrappedData, Scope, GitSummary, LintSummary, LintFinding } from '../types.js';

export type AnalyzeFormat = 'text' | 'detailed' | 'json';

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

function buildWrapped(
  stats: AnalysisStats,
  persona: ReturnType<typeof detectPersona>,
  friction: ReturnType<typeof analyzeFriction>,
  momentsInput: Parameters<typeof buildMoments>[0],
): WrappedData {
  const total = stats.doRules + stats.askRules + stats.suggestRules;
  const doSelf = total > 0 ? Math.round((stats.doRules / total) * 100) : 0;
  const askFirst = total > 0 ? Math.round((stats.askRules / total) * 100) : 0;
  const suggest = total > 0 ? Math.round((stats.suggestRules / total) * 100) : 0;

  const { moments, percentile, contrast } = buildMoments(momentsInput);

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
    moments,
    percentile,
    contrast,
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
  /**
   * When false, skip the SQLite writes (agent_run, score_history,
   * recommendation tracking). Used by the `wrapped` tool which calls
   * runAnalysis for its data but doesn't want to log itself as a new
   * "analyze" run in the user's history. Default true.
   */
  persist?: boolean;
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

  // 1b. R2 (calibration study): if CLAUDE.md is a trivial AGENTS.md redirect
  //     (small file + mentions AGENTS.md), follow the pointer and score the
  //     AGENTS.md content instead. Users on the Linux Foundation cross-tool
  //     standard shouldn't be penalised for keeping agent guidance in the
  //     canonical location.
  const scoredAgentsMdRedirect = followAgentsMdRedirect(scanResult);

  // 2. Parse content
  const parsed = parse(scanResult);

  // 3. Session analysis (before scoring so it can inform scores)
  const sessionData = analyzeSession(projectRoot);

  // 4. Detect persona + archetype (orthogonal axes)
  const persona = detectPersona(parsed, scanResult);
  const archetype = detectArchetype(parsed, scanResult);

  // 5. Analyze friction — pass session data so correction examples contribute
  const frictionPatterns = analyzeFriction(parsed, scanResult, sessionData);

  // 6. Detect gaps
  const gaps = detectGaps(parsed, scanResult, persona.detected);

  // 7. Git scanning — local .git activity across observed project roots
  //    Opt-out via includeGit=false for fast analyse-only runs or CI contexts.
  const git: GitScanResult | null = includeGit
    ? scanGitRepos(scanResult.scanRoots)
    : null;

  // 8. Lint CLAUDE.md for instruction quality issues
  const lint = lintClaudeMd(scanResult, parsed);

  // 9. Artifact discovery (reused from audit) + injection detection
  //    These are cheap reads — we always do them in analyze now so the
  //    "proactive" recs have a real surface to reason about.
  const artifacts = scanArtifacts();
  const injection = detectInjection(artifacts);

  // 10. Score categories (with session data for friction-based adjustments).
  //     Moved up so proactive recommender can see `intentionalAutonomy` — it
  //     drives whether corrections-friction is a full recommendation or a soft
  //     refinement note.
  const { categories, collaborationScore, claudeMdSubScore, substrateEmpty, intentionalAutonomy } = score(parsed, scanResult, sessionData);
  const grade = gradeBlendedScore(collaborationScore);
  const subScoreGrade = gradePureSubScore(claudeMdSubScore);

  // 11. Generate recommendations — three tracks:
  //    (a) agent-facing gap fills (file/config fixes)
  //    (b) user-facing behavior coaching (from friction patterns)
  //    (c) proactive pattern-based (from repeated CLIs, stale repos, /clear
  //        overuse, revert hotspots, correction friction, short prompts).
  //        These now cover every session signal that trims score — so a low
  //        score always comes with a path to raise it.
  const agentRecs = generateRecommendations(gaps, persona.detected);
  const userRecs = generateUserCoaching(frictionPatterns);
  const proactiveRecs = generateProactiveRecommendations({
    artifacts,
    session: sessionData,
    git,
    intentionalAutonomy,
  });
  const recommendations = [...agentRecs, ...userRecs, ...proactiveRecs];

  // 12. Build stats
  const stats = buildStats(parsed, scanResult);

  // 12b. Compute score ceiling — where the user would reach if every current
  //      recommendation is implemented. Surfaced so the user sees a concrete
  //      reachable target instead of a mystery score.
  const scoreCeiling = computeCeiling(parsed, scanResult, sessionData, categories, intentionalAutonomy);

  // 13. Build wrapped data — includes mined "moments" (specific, shareable
  //     stats per the Spotify Wrapped pattern). buildMoments reads from
  //     artifacts/rules/session/categories so we pass the whole bundle.
  const wrapped = buildWrapped(stats, persona, frictionPatterns, {
    collaborationScore,
    rules: parsed.rules,
    artifacts,
    scanResult,
    session: sessionData,
    categories: categories as unknown as Record<string, import('../types.js').CategoryScore>,
  });

  // 14. Feedback loop — check previous recommendations + track new ones
  const claudeMdContent = [scanResult.globalClaudeMd?.content, scanResult.projectClaudeMd?.content]
    .filter(Boolean).join('\n');
  const settingsContent = scanResult.settingsFiles.map(f => f.content).join('\n');
  const feedback = checkImplementation(claudeMdContent, settingsContent, collaborationScore, {
    installedServers: scanResult.installedServers,
    skillNames: artifacts.filter(a => a.type === 'skill').map(a => a.name),
    hooksCount: scanResult.hooksCount,
  });

  // 15. Compute tool recommendations (MCP servers, hooks, skills, repos we
  //     suggest based on their problems + persona). These used to be
  //     computed only when formatting the markdown — which meant they were
  //     never persisted to du_recommendations and never showed up in the
  //     dashboard's /forbedringer view. Fix: compute here, attach to the
  //     report, persist alongside the text recommendations.
  const problemIds = [
    ...frictionPatterns.map(f => f.theme),
    ...gaps.map(g => g.id),
    ...(stats.hooksCount === 0 ? ['no_build_verification', 'destructive_commands', 'safety'] : []),
    ...(sessionData.corrections.negationCount > 3 ? ['vague_prompts'] : []),
  ];
  const toolRecs = recommendTools(
    problemIds,
    persona.detected,
    scanResult.installedServers,
    { installedSkills: artifacts.filter(a => a.type === 'skill').map(a => a.name) },
  );

  // 15b. Build narrative findings layer — "What I saw" in the share report.
  //      Strengths come from a dedicated detector (gated on min sample size);
  //      frictionPatterns are surfaced as pattern/risk findings. Wins lead the
  //      list so every report acknowledges what works before naming what to fix.
  const strengths = detectStrengths({
    stats,
    categories: categories as unknown as Record<string, { score: number }>,
    archetype,
    feedback,
  });
  const findings = buildFindings({ frictionPatterns, strengths });

  // 16. Persist to SQLite — agent run + score history + recommendations.
  // Skipped when persist:false (wrapped tool does this to avoid duplicate
  // "analyze" rows in the user's run history).
  let agentRunId: string | undefined;
  if (options.persist !== false) {
    try {
      const recCrit = recommendations.filter(r => r.priority === 'critical').length;
      const recRec = recommendations.filter(r => r.priority === 'recommended').length;
      const recNice = recommendations.filter(r => r.priority === 'nice_to_have').length;
      agentRunId = insertAgentRun({
        toolName: 'collab',
        summary: `${recCrit + recRec + recNice} findings (${recCrit} critical, ${recRec} recommended, ${recNice} nice-to-have)`,
        score: collaborationScore,
        status: 'success',
      });

      const catScores: Record<string, number> = {};
      for (const [key, cat] of Object.entries(categories)) {
        catScores[key] = cat.score;
      }
      insertScoreHistory({
        scope: scanResult.scope,
        score: collaborationScore,
        persona: persona.detected,
        categoryScores: catScores,
      });
    } catch {
      // DB write failure should never break the analysis
    }

    trackRecommendations(recommendations, collaborationScore, agentRunId);
    trackToolRecommendations(toolRecs, collaborationScore, agentRunId);
  }

  return {
    version: '2.0',
    generatedAt: new Date().toISOString(),
    scanRoot: projectRoot,
    scope: scanResult.scope,
    projectsObserved: scanResult.projectsObserved,
    installedServers: scanResult.installedServers,
    installedSkills: artifacts.filter(a => a.type === 'skill').map(a => a.name),
    persona,
    archetype,
    collaborationScore,
    claudeMdSubScore,
    substrateEmpty,
    grade,
    subScoreGrade,
    ...(scoredAgentsMdRedirect ? { scoredAgentsMdRedirect } : {}),
    scoreCeiling,
    categories,
    frictionPatterns,
    findings,
    gaps,
    stats,
    recommendations,
    wrapped,
    session: sessionData,
    git: git ? buildGitSummary(git) : null,
    injection,
    lint: { ...lint.summary, findings: lint.findings },
    feedback,
    toolRecs,
    // Internal — used by index.ts to store the rendered report in du_agent_runs
    // so the local dashboard's /r/:id route can display it. Undefined if the
    // DB write failed (silent degradation — not user-facing).
    _agentRunId: agentRunId,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Human-readable "3 days ago" / "5 weeks ago" from an ISO timestamp. */
function daysSince(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return 'recently';
  const days = Math.round((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const priorityLabel = (p: string) =>
  p === 'critical' ? '🔴 Critical' : p === 'recommended' ? '🟡 Recommended' : '🟢 Nice to have';

const priorityOrder = (p: string) => (p === 'critical' ? 0 : p === 'recommended' ? 1 : 2);

// -- Shared sections used by both text and detailed --------------------------

/** Persona + score header — identical in both formats. */
function formatHeader(report: AnalysisReport): string[] {
  const scopeBanner = report.scope === 'global'
    ? `*Scope: global — aggregated across ${report.projectsObserved} project${report.projectsObserved === 1 ? '' : 's'} in ~/.claude/projects/*`
    : `*Scope: project — ${report.scanRoot}*`;

  return [
    `# Dear User — Collaboration Analysis`,
    ``,
    scopeBanner,
    ``,
    `## Your Persona: ${report.persona.archetypeName}`,
    `**${report.persona.detected.replace('_', ' ')}** (${report.persona.confidence}% confidence)`,
    report.persona.archetypeDescription,
    ``,
    `**Traits:** ${report.persona.traits.join(', ')}`,
    ``,
    `## Your Setup Archetype: ${report.archetype.nameEn} · ${report.archetype.nameDa}`,
    report.archetype.description,
    ``,
    `## Collaboration Score: ${report.collaborationScore}/100 — Grade ${report.grade.letter} (${report.grade.percentileLabel})`,
    `*${report.grade.summary} · Style: ${report.archetype.nameEn}*`,
    ``,
    ...formatSubScore(report),
    ...formatRedirectNote(report),
    ...formatCeiling(report),
  ];
}

/**
 * R1 (calibration study): when substrate is empty — no memory, hooks, or
 * skills on disk — the blended 7-category score is depressed ~6 points by
 * things the user hasn't set up yet. Surface a CLAUDE.md-only sub-score so
 * fresh-install users see both numbers and understand the gap.
 */
function formatSubScore(report: AnalysisReport): string[] {
  if (!report.substrateEmpty) return [];
  if (report.claudeMdSubScore === report.collaborationScore) return [];

  return [
    `**CLAUDE.md-only sub-score: ${report.claudeMdSubScore}/100 — Grade ${report.subScoreGrade.letter} (${report.subScoreGrade.percentileLabel})**`,
    `*The sub-score ignores memory/hooks/skills — use it while substrate is still empty. The blended score rises automatically as you set those up.*`,
    ``,
  ];
}

/**
 * R2 (calibration study): if we followed an AGENTS.md redirect, tell the
 * user. Transparency matters — the score they see comes from AGENTS.md, not
 * the CLAUDE.md stub they may expect us to read.
 */
function formatRedirectNote(report: AnalysisReport): string[] {
  if (!report.scoredAgentsMdRedirect) return [];
  return [
    `*Note: your CLAUDE.md is a ${report.scoredAgentsMdRedirect.claudeMdSize}-byte redirect to AGENTS.md. We followed the pointer and scored \`${report.scoredAgentsMdRedirect.agentsMdPath}\` instead.*`,
    ``,
  ];
}

/**
 * Ceiling block — shows the user what score they'd reach by following the
 * report, and surfaces any structural caps (systemMaturity tops at 85).
 * This closes the old gap where a user could do everything the report said
 * and still not know why they weren't at 100.
 */
function formatCeiling(report: AnalysisReport): string[] {
  const c = report.scoreCeiling;
  if (!c) return [];

  const lines: string[] = [];
  if (c.delta > 0) {
    lines.push(
      `**Reachable ceiling: ${c.ceilingScore}/100** (+${c.delta} if you implement every recommendation below).`,
    );
  } else if (c.delta === 0 && c.ceilingScore < 100) {
    lines.push(
      `**Reachable ceiling: ${c.ceilingScore}/100** — you're already at it. New recommendations would need to surface before this number changes.`,
    );
  } else if (c.ceilingScore === 100) {
    lines.push(
      `**Reachable ceiling: 100/100** — implementing everything in this report takes you all the way.`,
    );
  }

  if (c.unreachable.length > 0) {
    lines.push(``, `*Why ${c.ceilingScore < 100 ? `${c.ceilingScore}` : 'the ceiling'}, not 100:*`);
    for (const reason of c.unreachable) {
      lines.push(`- ${reason}`);
    }
  }

  lines.push(``);
  return lines;
}

/** Category score bars with human-friendly or technical signal labels. */
function formatCategories(report: AnalysisReport, plain: boolean): string[] {
  const lines: string[] = ['### Category Scores'];

  // Plain-language translations for vibe coders
  const plainSignal: Record<string, string> = {
    'Roles section exists': 'Your agent knows who does what',
    'Specific role definitions (not generic)': 'Roles are clearly defined',
    'Scope boundaries defined': 'Clear boundaries on what the agent can do',
    'Ask-first rules with specific examples': 'Your agent knows when to check with you',
    'User skill level / role indicated': 'Your agent knows your skill level',
    'Language preference set': 'Language preference set',
    'Verbosity preference set': 'Communication style defined',
    'Tone/style guidance': 'Tone and style preferences set',
    'Uncertainty handling defined': 'Your agent knows what to do when unsure',
    'Feedback mechanism defined': 'Feedback loop is active',
    'Testing strategy mentioned': 'Testing approach defined',
    'Build/lint verification': 'Build checks in place',
    'Definition of done exists': 'Clear "done" criteria',
    'Sensitive file protection': 'Sensitive files are protected',
    'No custom commands': 'No shortcuts set up yet',
    'No destructive command protection — rm -rf, force push, terraform destroy are unblocked':
      'Your agent can delete files or force-push without asking — consider adding a safety check',
    'Project architecture — not documented':
      "Your agent doesn't know how your project is structured",
  };

  // Translate signal counts in signals to plain language
  const translateSignal = (sig: string): string => {
    if (!plain) return sig;
    // Check exact match first
    if (plainSignal[sig]) return plainSignal[sig];
    // Pattern-based translations
    if (/^\d+ autonomous rules$/.test(sig)) return sig.replace(/(\d+) autonomous rules/, '$1 things your agent does without asking');
    if (/^\d+ ask-first rules$/.test(sig)) return sig.replace(/(\d+) ask-first rules/, '$1 things it always checks with you first');
    if (/^\d+ hooks$/.test(sig)) return sig.replace(/(\d+) hooks/, '$1 automatic checks running');
    if (/^\d+ skills$/.test(sig)) return sig.replace(/(\d+) skills/, '$1 skills available');
    if (/^\d+ scheduled tasks$/.test(sig)) return sig.replace(/(\d+) scheduled tasks/, '$1 automated tasks running');
    if (/^\d+ memory files/.test(sig)) return sig.replace(/(\d+) memory files/, '$1 things your agent remembers');
    if (/^\d+ feedback memories/.test(sig)) return sig.replace(/(\d+) feedback memories/, '$1 corrections your agent learned from');
    if (/correction signals/.test(sig)) return sig.replace(/correction signals/, 'times you corrected your agent');
    if (/hooks configured/.test(sig)) return sig.replace(/hooks configured/, 'automatic checks running');
    if (/MCP servers/.test(sig)) return sig.replace(/MCP servers/, 'tools connected');
    // Intentional autonomy explanation — simplify
    if (sig.includes('Explicit autonomous-operation section')) return 'High autonomy is intentional — your agent acts independently by design';
    if (sig.includes('Suggest-only tier skipped')) return 'Your agent acts rather than just suggesting';
    if (sig.includes('Healthy prohibition ratio')) return 'Good balance of permissions and restrictions';
    if (sig.includes('Rules are specific enough')) return 'Rules are clear enough to follow';
    return sig;
  };

  const categoryConfig: Array<{ key: string; name: string; plainName?: string }> = [
    { key: 'roleClarity', name: 'Role Clarity', plainName: 'Who Does What' },
    { key: 'communication', name: 'Communication', plainName: 'Communication' },
    { key: 'autonomyBalance', name: 'Autonomy Balance', plainName: 'Independence' },
    { key: 'qualityStandards', name: 'Quality Standards', plainName: 'Quality Checks' },
    { key: 'memoryHealth', name: 'Memory Health', plainName: 'Memory' },
    { key: 'systemMaturity', name: 'System Maturity', plainName: 'Automation' },
    { key: 'coverage', name: 'Coverage', plainName: 'Setup Completeness' },
  ];

  for (const { key, name, plainName } of categoryConfig) {
    const cat = report.categories[key as keyof typeof report.categories];
    const bar = '█'.repeat(Math.round(cat.score / 10)) + '░'.repeat(10 - Math.round(cat.score / 10));

    let status: string;
    if (cat.score >= 85) status = 'Strong';
    else if (cat.score >= 70) status = 'Good';
    else if (cat.score >= 50) status = 'Needs work';
    else status = 'Weak — action needed';

    const displayName = plain && plainName ? plainName : name;
    lines.push(`- **${displayName}**: ${bar} ${cat.score}/100 — *${status}*`);

    if (cat.signalsPresent.length > 0) {
      for (const present of cat.signalsPresent.slice(0, 2)) {
        lines.push(`  - ✓ ${translateSignal(present)}`);
      }
    }

    if (cat.score < 100 && cat.signalsMissing.length > 0) {
      for (const missing of cat.signalsMissing.slice(0, 2)) {
        lines.push(`  - → ${translateSignal(missing)}`);
      }
    }
  }

  return lines;
}

/**
 * "What I saw" narrative layer — strengths, patterns and risks observed in
 * the user's setup. Renders between categories and recommendations so the
 * report reads: score → observations → actions. Old reports without findings
 * render nothing; empty array hides the section.
 */
function formatFindings(report: AnalysisReport): string[] {
  const findings = report.findings || [];
  if (findings.length === 0) return [];

  const label: Record<string, string> = {
    win: '💚 Strength',
    pattern: '🔵 Pattern',
    risk: '🟠 Risk',
  };

  const lines: string[] = ['', '## What I saw', ''];
  findings.forEach((f, i) => {
    const num = String(i + 1).padStart(2, '0');
    const tag = label[f.tag] || f.tag;
    lines.push(`**${num} — ${tag}: ${f.title}**`);
    if (f.body) lines.push(f.body);
    lines.push('');
  });
  return lines;
}

/** Recommendations split by audience. */
function formatRecommendations(report: AnalysisReport): string[] {
  const lines: string[] = [];

  const agentRecs = report.recommendations
    .filter(r => r.audience === 'agent' || r.audience === 'both')
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  const userRecs = report.recommendations
    .filter(r => r.audience === 'user' || r.audience === 'both')
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  if (agentRecs.length > 0) {
    lines.push(
      '', '## 🤖 For Your Agent',
      '*Copy-paste these into your config. Your agent can apply them for you.*',
      '',
    );

    for (const rec of agentRecs.slice(0, 5)) {
      lines.push(`### ${priorityLabel(rec.priority)}: ${rec.title}`);
      lines.push(`${rec.description}`);

      if (rec.evidence.length > 0) {
        lines.push('', '**Evidence:**');
        for (const ev of rec.evidence) {
          const prefix = ev.kind === 'missing' ? '🔍' : ev.kind === 'quote' ? '💬' : '📊';
          lines.push(`- ${prefix} \`${ev.source}\` — ${ev.excerpt}`);
        }
      }

      lines.push('', `**Where:** ${rec.placementHint}`);
      if (rec.textBlock.trim()) {
        lines.push('', '```', rec.textBlock, '```');
      }
      lines.push('');
    }
  }

  if (userRecs.length > 0) {
    lines.push(
      '', '## 👤 For You',
      '*These are behavior changes. No file to edit — you\'re the one changing. One at a time works best.*',
      '',
    );

    for (const rec of userRecs.slice(0, 3)) {
      lines.push(`### ${priorityLabel(rec.priority)}: ${rec.title}`);
      lines.push(`${rec.description}`);

      if (rec.evidence.length > 0) {
        lines.push('', '**Evidence from your own setup:**');
        for (const ev of rec.evidence) {
          lines.push(`- 💬 *"${ev.excerpt}"*  — ${ev.source}`);
        }
      }

      if (rec.why) lines.push('', `**Why it matters:** ${rec.why}`);
      if (rec.howItLooks) lines.push('', '**How it looks when done right:**', '```', rec.howItLooks, '```');
      if (rec.practiceStep) lines.push('', `**Practice this next time:** ${rec.practiceStep}`);
      lines.push('');
    }
  }

  if (agentRecs.length === 0 && userRecs.length === 0) {
    lines.push(
      '', '## No action items',
      'No critical gaps detected in your setup, and no friction patterns had enough evidence to recommend a behavior change. Your collaboration looks healthy on the dimensions we can see.',
    );
  }

  return lines;
}

/**
 * Map a tool's `solves` tags to the collaboration score category it most
 * directly lifts. Returned to the user so tool recommendations are visibly
 * tied to the score — not floating suggestions disconnected from the number.
 */
const CATEGORY_TECHNICAL_NAMES: Record<string, string> = {
  qualityStandards: 'Quality Standards',
  memoryHealth: 'Memory Health',
  communication: 'Communication',
  autonomyBalance: 'Autonomy Balance',
  systemMaturity: 'System Maturity',
  roleClarity: 'Role Clarity',
  coverage: 'Coverage',
};

function toolSolvesCategory(solves: string[] | undefined): { id: string; label: string } | null {
  if (!solves || solves.length === 0) return null;
  for (const tag of solves) {
    if (/safety|destructive|protected_files|accidental_secret/i.test(tag)) {
      return { id: 'qualityStandards', label: 'Quality Checks' };
    }
    if (/build|quality_gaps|no_testing/i.test(tag)) {
      return { id: 'qualityStandards', label: 'Quality Checks' };
    }
    if (/memory|learning_loop|corrections_lost|session_amnesia/i.test(tag)) {
      return { id: 'memoryHealth', label: 'Memory' };
    }
    if (/vague_prompts|prompt_quality/i.test(tag)) {
      return { id: 'communication', label: 'Communication' };
    }
    if (/scope_creep|autonomy/i.test(tag)) {
      return { id: 'autonomyBalance', label: 'Independence' };
    }
    if (/daily_overview|missing_priorities|context_loss_between_sessions|process_friction/i.test(tag)) {
      return { id: 'systemMaturity', label: 'Automation' };
    }
    if (/missing_context|research|documentation|hallucination|outdated_docs|wrong_api/i.test(tag)) {
      return { id: 'roleClarity', label: 'Who Does What' };
    }
  }
  // Fallback: installing any tool adds an artifact, which contributes to system maturity
  return { id: 'systemMaturity', label: 'Automation' };
}

/** Tool recommendations section. Reads from report.toolRecs (computed in
 *  runAnalysis and persisted to du_recommendations). */
function formatToolRecs(report: AnalysisReport, isDetailed = false): string[] {
  const lines: string[] = [];
  const toolRecs = report.toolRecs;

  if (toolRecs.length > 0) {
    lines.push('', '## Værktøjer jeg kan anbefale', '');
    lines.push('*Disse værktøjer adresserer konkrete ting jeg fandt i dit setup. Jeg kan installere de fleste for dig — sig bare hvilke du vil have.*', '');
    for (const tool of toolRecs.slice(0, 5)) {
      const typeLabel = tool.type === 'mcp_server' ? 'MCP-server'
        : tool.type === 'hook' ? 'Automatisk tjek'
        : tool.type === 'github_repo' ? 'GitHub-projekt'
        : 'Skill';
      const starsStr = tool.stars ? ` · ${(tool.stars / 1000).toFixed(0)}K⭐` : '';
      const f = friendlyLabel(tool.name);
      lines.push(`### ${f.title} [${typeLabel}${starsStr}]`);
      if (f.summary) {
        lines.push('**Hvad er det:** ' + f.summary);
      } else {
        lines.push(tool.userFriendlyDescription || tool.description);
      }
      if (f.benefit) lines.push('**Hvad bliver bedre:** ' + f.benefit);

      const category = toolSolvesCategory(tool.solves);
      if (category && report.scoreCeiling) {
        const cat = report.scoreCeiling.byCategory[category.id];
        const label = isDetailed ? (CATEGORY_TECHNICAL_NAMES[category.id] || category.label) : category.label;
        if (cat && cat.ceiling > cat.current) {
          lines.push(`**Score-impact:** Lifts **${label}** from ${cat.current} toward ${cat.ceiling}.`);
        } else {
          lines.push(`**Score-impact:** Contributes to **${label}**.`);
        }
      }

      if (tool.whoActs) lines.push('', `_${tool.whoActs}_`);
      const install = tool.install.trim();
      if (install.includes('\n')) {
        lines.push('', '```', install, '```');
      } else {
        lines.push('', `\`${install}\``);
      }
      lines.push('');
    }
  }

  return lines;
}

/** Onboarding gap questions. */
function formatOnboardingGaps(report: AnalysisReport): string[] {
  const lines: string[] = [];

  const GAP_QUESTIONS: Record<string, { ask: string; why: string }> = {
    missing_roles: { ask: 'What is your role? Are you the coder, the product owner, or something else?', why: 'Calibrates how technical the agent should be.' },
    missing_autonomy: { ask: 'What should the agent do without asking? What should it always ask first?', why: 'Too much autonomy → scope creep. Too little → constant interruptions.' },
    missing_communication: { ask: 'How do you prefer communication? Language, detail level, tone?', why: 'Without this, the agent defaults to technical English.' },
    missing_quality: { ask: 'How do you know something is done? What checks should pass?', why: 'Without quality gates, broken code gets shipped.' },
    missing_north_star: { ask: 'What is your main goal? Revenue target, user growth, learning?', why: 'Every recommendation gets evaluated against your goal.' },
    missing_tech_stack: { ask: 'What is your standard tech stack for new projects?', why: 'Prevents the agent from suggesting frameworks you don\'t use.' },
    missing_learnings: { ask: 'What lesson from the last 3 months should your agent never forget?', why: 'Surfaces tacit knowledge that would otherwise stay in your head.' },
    no_hooks: { ask: 'Should we add automated guardrails? (build check, destructive-command blocker, protected-files guard)', why: 'Catches errors before they reach you.' },
    no_memory: { ask: 'Your agent has no memory system. Want to enable it?', why: 'Without memory, corrections are forgotten every session.' },
    no_learn_skill: { ask: 'Want a /learn skill that captures session lessons into memory automatically?', why: 'Turns every correction into persistent learning with no extra effort.' },
    no_ship_skill: { ask: 'Want a /ship skill that bundles build + test + commit + push into one safe command?', why: 'Fewer steps to remember, fewer ways to ship broken code.' },
    no_standup_skill: { ask: 'Want a /standup skill that gives you a daily project overview on command?', why: 'Removes the "where was I?" startup cost each morning.' },
  };

  const onboardingGaps = report.gaps.filter(g =>
    (g.severity === 'critical' || g.severity === 'recommended') && GAP_QUESTIONS[g.id]
  );

  if (onboardingGaps.length > 0) {
    lines.push(
      '', '## Onboarding: Get to Know Each Other',
      '',
      'These areas are missing or thin in your setup. Ask one question at a time — like meeting a new colleague, not filling out a form.',
      '',
    );

    for (const gap of onboardingGaps.slice(0, 6)) {
      const q = GAP_QUESTIONS[gap.id];
      const marker = gap.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`- ${marker} **${q.ask}**`);
      lines.push(`  *Why:* ${q.why}`);
    }

    lines.push(
      '',
      '*Tip: The agent should also tell you about itself: "I work like a colleague with amnesia — I read my briefing every morning but don\'t remember yesterday. The best way to correct me: be specific."*'
    );
  }

  return lines;
}

// -- Detailed-only sections --------------------------------------------------

/** Stats — technical metrics for power users. */
function formatStats(report: AnalysisReport): string[] {
  const s = report.stats;
  const rulesCtx = s.totalRules < 5 ? ' (sparse — most setups have 10-30)' : s.totalRules > 50 ? ' (extensive — well-documented)' : '';
  const memCtx = s.memoryFiles === 0 ? ' (your agent forgets everything between sessions)'
    : s.memoryFiles < 5 ? ' (minimal — consider adding project-specific memories)'
    : s.memoryFiles > 20 ? ' (thorough knowledge base — most users have 5-10)' : '';
  const fbCtx = s.feedbackMemories === 0 ? ' — no correction loop active'
    : s.feedbackMemories > 5 ? ` — strong learning loop: ${s.feedbackMemories} corrections remembered` : '';
  const hookCtx = s.hooksCount === 0 ? ' (no automated guardrails)' : s.hooksCount > 3 ? ' (solid automation layer)' : '';

  return [
    '', '## Stats',
    `- **${s.totalRules}** rules${rulesCtx} (${s.doRules} autonomous, ${s.askRules} ask-first, ${s.suggestRules} suggest-only, ${s.prohibitionRules} prohibitions)`,
    `- **${s.memoryFiles}** memory files${memCtx} (${s.feedbackMemories} feedback${fbCtx})`,
    `- **${s.totalLearnings}** learnings documented`,
    `- **${s.hooksCount}** hooks${hookCtx}, **${s.skillsCount}** skills, **${s.scheduledTasksCount}** scheduled tasks`,
    `- **${s.mcpServersCount}** MCP servers connected`,
    `- **${s.projectsManaged}** projects managed`,
  ];
}

/** Git activity section. */
function formatGitActivity(report: AnalysisReport): string[] {
  const lines: string[] = [];
  if (!report.git || report.git.totalScanned === 0) return lines;

  lines.push(
    '', '## Project Activity',
    `- **${report.git.totalScanned}** git repos scanned — **${report.git.active}** active (commits last 7 days), **${report.git.stale}** stale (60+ days)`,
  );
  if (report.git.reposWithRevertSignals > 0) {
    lines.push(`- ⚠️  **${report.git.reposWithRevertSignals}** repo${report.git.reposWithRevertSignals === 1 ? '' : 's'} with "fix again" / "revert" patterns in recent commits`);
  }
  if (report.git.reposWithUncommittedPile > 0) {
    lines.push(`- 📦 **${report.git.reposWithUncommittedPile}** repo${report.git.reposWithUncommittedPile === 1 ? '' : 's'} with 10+ uncommitted files`);
  }

  if (report.git.topActive.length > 0) {
    lines.push('', '**Most active this week:**');
    for (const r of report.git.topActive.slice(0, 3)) {
      lines.push(`- ${r.name}: ${r.commits7d} commit${r.commits7d === 1 ? '' : 's'} last 7 days (${r.commits30d} last 30)`);
    }
  }

  return lines;
}

/** Injection findings section. */
function formatInjection(report: AnalysisReport): string[] {
  const lines: string[] = [];
  const injection = report.injection || [];
  const importantInjection = injection.filter(i => i.severity !== 'nice_to_have');
  if (importantInjection.length === 0) return lines;

  lines.push(
    '', '## 🛡️ Injection Surfaces',
    `Pattern-matched hooks, skills, and MCP configs for prompt-injection risks. Flagging ${importantInjection.length} item${importantInjection.length === 1 ? '' : 's'} worth a manual review — false positives are possible.`,
    '',
  );
  for (const finding of importantInjection.slice(0, 5)) {
    const label = finding.severity === 'critical' ? '🔴 Critical' : '🟡 Recommended';
    lines.push(`### ${label}: ${finding.title}`);
    lines.push(`**Why it matters:** ${finding.why}`);
    lines.push('', `**In:** \`${finding.artifactPath}\``, '', '```', finding.excerpt, '```', '');
    lines.push(`**Fix:** ${finding.recommendation}`, '');
  }

  return lines;
}

/** Session patterns section. */
function formatSessionPatterns(report: AnalysisReport): string[] {
  const lines: string[] = [];
  if (!report.session) return lines;

  const s = report.session;
  lines.push(
    '', '## Session Patterns',
    `- **${s.stats.totalSessions}** total sessions (**${s.stats.sessionsLast30Days}** last 30 days)`,
    `- **${s.promptPatterns.totalPrompts}** prompts analyzed (avg length: ${s.promptPatterns.avgPromptLength} chars)`,
    `- **${s.promptPatterns.shortPrompts}** short prompts (<20 chars) — may indicate vague instructions`,
    `- **${s.corrections.negationCount}** correction signals detected ("nej", "stop", "wrong", etc.)`,
    `- **${s.corrections.frustrationSignals}** frustration signals ("why did you", "again", "still wrong")`,
    `- **${s.promptPatterns.clearCommands}** /clear commands — context resets`,
  );

  if (s.corrections.examples.length > 0) {
    lines.push('', 'Recent correction examples:');
    for (const ex of s.corrections.examples.slice(0, 3)) {
      lines.push(`  - "${ex}"`);
    }
  }

  return lines;
}

/** Feedback loop section. */
function formatFeedbackLoop(report: AnalysisReport): string[] {
  const lines: string[] = [];
  if (!report.feedback || report.feedback.totalRecommendations === 0) return lines;

  lines.push(
    '', '## Feedback Loop',
    `- **${report.feedback.totalRecommendations}** previous recommendations tracked`,
    `- **${report.feedback.implemented}** implemented, **${report.feedback.ignored}** ignored, **${report.feedback.pending}** pending`,
  );
  if (report.feedback.avgScoreImprovement !== null) {
    const dir = report.feedback.avgScoreImprovement >= 0 ? '+' : '';
    lines.push(`- Average score change after implementation: **${dir}${report.feedback.avgScoreImprovement}** points`);
  }

  if (report.feedback.history && report.feedback.history.length > 0) {
    lines.push('');
    const pending = report.feedback.history.filter(h => h.status === 'pending').slice(0, 3);
    const implemented = report.feedback.history.filter(h => h.status === 'implemented').slice(0, 2);
    if (pending.length > 0) {
      lines.push('**Still pending:**');
      for (const h of pending) {
        const age = daysSince(h.givenAt);
        lines.push(`- ⏳ *${h.title}* — suggested ${age}`);
      }
    }
    if (implemented.length > 0) {
      lines.push('', '**Recently implemented:**');
      for (const h of implemented) {
        const delta = h.scoreAtCheck !== undefined ? ` (${h.scoreAtCheck - h.scoreAtGiven >= 0 ? '+' : ''}${h.scoreAtCheck - h.scoreAtGiven} pts)` : '';
        lines.push(`- ✅ *${h.title}*${delta}`);
      }
    }
  }

  return lines;
}

/** Lint findings — CLAUDE.md quality issues. */
function formatLintFindings(report: AnalysisReport, plain: boolean): string[] {
  const lines: string[] = [];
  const lint = report.lint;

  if (!lint || lint.totalFindings === 0) return lines;

  const label = plain ? 'Prompt & Config Quality' : 'Prompt & Config Quality';
  lines.push('', `## ${label}`);

  if (plain) {
    lines.push(`Found **${lint.totalFindings}** issue${lint.totalFindings === 1 ? '' : 's'} in your instructions file that could confuse your agent.`);
  } else {
    lines.push(`**${lint.totalChecks}** checks ran — **${lint.totalFindings}** finding${lint.totalFindings === 1 ? '' : 's'}` +
      ` (${lint.bySeverity.critical} critical, ${lint.bySeverity.recommended} recommended, ${lint.bySeverity.nice_to_have} nice-to-have)`);
  }
  lines.push('');

  const severityLabel = (s: string) =>
    s === 'critical' ? '🔴' : s === 'recommended' ? '🟡' : '🟢';

  // In text mode: show max 8, grouped by severity
  // In detailed mode: show all
  const maxFindings = plain ? 8 : lint.findings.length;
  const shown = lint.findings.slice(0, maxFindings);

  for (const f of shown) {
    const loc = f.line ? `:${f.line}` : '';
    lines.push(`${severityLabel(f.severity)} **${f.title}**`);
    if (!plain) {
      const shortPath = f.file.replace(/.*\.claude\//, '~/.claude/');
      lines.push(`  *${shortPath}${loc}*`);
    }
    lines.push(`  ${f.description}`);
    if (f.fix) {
      lines.push(`  → Fix: ${f.fix}`);
    }
    lines.push('');
  }

  if (lint.totalFindings > maxFindings) {
    lines.push(`*…and ${lint.totalFindings - maxFindings} more. Run with format="detailed" to see all.*`);
  }

  // CTA — make lint findings actionable
  if (plain) {
    lines.push('', `**Your agent can fix ${lint.totalFindings === 1 ? 'this' : 'most of these'} directly** — ask it to restructure your CLAUDE.md based on the findings above.`);
  }

  return lines;
}

// -- Public formatter --------------------------------------------------------

/**
 * Format an AnalysisReport as a string.
 *
 * - "text" (default): concise, plain-language report for non-technical users.
 * - "detailed": full technical report with stats, session patterns, injection findings.
 * - "json": raw JSON for programmatic use.
 */
export function formatAnalyzeReport(report: AnalysisReport, format: AnalyzeFormat = 'text'): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const isDetailed = format === 'detailed';
  const lines: string[] = [
    ...formatHeader(report),
    ...formatCategories(report, !isDetailed),
    ...formatFindings(report),
    ...formatLintFindings(report, !isDetailed),
    ...formatRecommendations(report),
  ];

  if (isDetailed) {
    // Detailed-only sections: stats, git, injection, sessions, feedback loop
    lines.push(...formatStats(report));
    lines.push(...formatGitActivity(report));
    lines.push(...formatInjection(report));
    lines.push(...formatSessionPatterns(report));
    lines.push(...formatFeedbackLoop(report));
  }

  // Tool recommendations and onboarding gaps — in both formats
  lines.push(...formatToolRecs(report, isDetailed));
  lines.push(...formatOnboardingGaps(report));

  lines.push(...firstRunWelcome());
  lines.push(...feedbackFooter());

  return lines.join('\n');
}
