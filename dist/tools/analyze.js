// analyze tool — full collaboration analysis
import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { detectPersona } from '../engine/persona-detector.js';
import { score } from '../engine/scorer.js';
import { analyzeFriction } from '../engine/friction-analyzer.js';
import { detectGaps } from '../engine/gap-detector.js';
import { generateRecommendations } from '../templates/recommendations.js';
function buildStats(parsed, scanResult) {
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
function buildWrapped(stats, persona, friction) {
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
export function runAnalysis(projectRoot) {
    // 1. Scan filesystem
    const scanResult = scan(projectRoot);
    // 2. Parse content
    const parsed = parse(scanResult);
    // 3. Detect persona
    const persona = detectPersona(parsed, scanResult);
    // 4. Score categories
    const { categories, collaborationScore } = score(parsed, scanResult);
    // 5. Analyze friction
    const frictionPatterns = analyzeFriction(parsed, scanResult);
    // 6. Detect gaps
    const gaps = detectGaps(parsed, scanResult, persona.detected);
    // 7. Generate recommendations
    const recommendations = generateRecommendations(gaps, persona.detected);
    // 8. Build stats
    const stats = buildStats(parsed, scanResult);
    // 9. Build wrapped data
    const wrapped = buildWrapped(stats, persona, frictionPatterns);
    return {
        version: '1.0',
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
    };
}
//# sourceMappingURL=analyze.js.map