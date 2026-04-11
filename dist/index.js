#!/usr/bin/env node
// Agent Wrapped MCP Server
// Analyzes human-agent collaboration and helps improve it
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAnalysis } from './tools/analyze.js';
const server = new McpServer({
    name: 'agent-wrapped',
    version: '0.1.0',
});
// Tool 1: analyze — full collaboration analysis
server.tool('analyze', 'Analyze your human-agent collaboration. Scans CLAUDE.md, memory files, hooks, skills, and more to produce a collaboration report with persona detection, scoring, friction analysis, and recommendations.', {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
}, async ({ projectRoot }) => {
    try {
        const root = projectRoot || process.cwd();
        const report = runAnalysis(root);
        // Format key insights as readable text
        const lines = [
            `# Agent Wrapped — Collaboration Analysis`,
            ``,
            `## Your Persona: ${report.persona.archetypeName}`,
            `**${report.persona.detected.replace('_', ' ')}** (${report.persona.confidence}% confidence)`,
            report.persona.archetypeDescription,
            ``,
            `**Traits:** ${report.persona.traits.join(', ')}`,
            ``,
            `## Collaboration Score: ${report.collaborationScore}/100`,
            ``,
            `### Category Scores`,
        ];
        const categoryNames = {
            roleClarity: 'Role Clarity',
            communication: 'Communication',
            autonomyBalance: 'Autonomy Balance',
            qualityStandards: 'Quality Standards',
            memoryHealth: 'Memory Health',
            systemMaturity: 'System Maturity',
            coverage: 'Coverage',
        };
        for (const [key, name] of Object.entries(categoryNames)) {
            const cat = report.categories[key];
            const bar = '█'.repeat(Math.round(cat.score / 10)) + '░'.repeat(10 - Math.round(cat.score / 10));
            lines.push(`- **${name}**: ${bar} ${cat.score}/100`);
        }
        // Friction patterns
        if (report.frictionPatterns.length > 0) {
            lines.push('', '## Top Friction Points');
            for (const fp of report.frictionPatterns) {
                lines.push(`${fp.rank}. **${fp.title}** — ${fp.description}`);
                if (fp.evidence.length > 0) {
                    lines.push(`   Evidence: ${fp.evidence.slice(0, 2).join('; ')}`);
                }
            }
        }
        // Gaps
        if (report.gaps.length > 0) {
            lines.push('', '## Identified Gaps');
            for (const gap of report.gaps) {
                const icon = gap.severity === 'critical' ? '🔴' : gap.severity === 'recommended' ? '🟡' : '🟢';
                lines.push(`- ${icon} **${gap.section}** (${gap.severity}) — ${gap.personaRelevance}`);
            }
        }
        // Top recommendations
        if (report.recommendations.length > 0) {
            lines.push('', '## Top Recommendations');
            for (const rec of report.recommendations.slice(0, 3)) {
                lines.push(``, `### ${rec.title}`, rec.description, '', '```markdown', rec.textBlock, '```', `*${rec.placementHint}*`);
            }
        }
        // Stats
        lines.push('', '## Stats', `- **${report.stats.totalRules}** rules (${report.stats.doRules} autonomous, ${report.stats.askRules} ask-first, ${report.stats.suggestRules} suggest-only, ${report.stats.prohibitionRules} prohibitions)`, `- **${report.stats.memoryFiles}** memory files (${report.stats.feedbackMemories} feedback)`, `- **${report.stats.totalLearnings}** learnings documented`, `- **${report.stats.hooksCount}** hooks, **${report.stats.skillsCount}** skills, **${report.stats.scheduledTasksCount}** scheduled tasks`, `- **${report.stats.mcpServersCount}** MCP servers connected`, `- **${report.stats.projectsManaged}** projects managed`);
        return {
            content: [
                { type: 'text', text: lines.join('\n') },
                { type: 'text', text: '\n\n---\n*Raw JSON report available via the wrapped tool*' },
            ],
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Analysis failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});
// Tool 2: suggest — get specific recommendations
server.tool('suggest', 'Get specific, actionable recommendations to improve your agent collaboration. Returns text blocks you can add to your CLAUDE.md or settings.', {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
    focus: z.enum(['roles', 'autonomy', 'communication', 'quality', 'memory', 'all']).optional().describe('Focus area for recommendations. Defaults to all.'),
}, async ({ projectRoot, focus }) => {
    try {
        const root = projectRoot || process.cwd();
        const report = runAnalysis(root);
        let recs = report.recommendations;
        if (focus && focus !== 'all') {
            const focusMap = {
                roles: ['missing_roles'],
                autonomy: ['missing_autonomy'],
                communication: ['missing_communication'],
                quality: ['missing_quality', 'no_hooks'],
                memory: ['no_memory'],
            };
            const ids = focusMap[focus] || [];
            recs = recs.filter(r => ids.some(id => r.title.toLowerCase().includes(id.replace('missing_', '').replace('no_', ''))));
        }
        if (recs.length === 0) {
            return {
                content: [{ type: 'text', text: `No recommendations for focus area "${focus}". Your ${focus} setup looks good!` }],
            };
        }
        const lines = [
            `# Recommendations for ${report.persona.archetypeName}`,
            `Persona: **${report.persona.detected.replace('_', ' ')}** | Score: **${report.collaborationScore}/100**`,
            '',
        ];
        for (const rec of recs) {
            const icon = rec.priority === 'critical' ? '🔴' : rec.priority === 'recommended' ? '🟡' : '🟢';
            lines.push(`## ${icon} ${rec.title}`, rec.description, '', '```markdown', rec.textBlock, '```', `*${rec.placementHint}*`, '');
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Suggestion generation failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});
// Tool 3: wrapped — shareable collaboration stats
server.tool('wrapped', 'Generate your Agent Wrapped — shareable stats about your human-agent collaboration in a fun, Spotify Wrapped-style format.', {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. "text" for terminal display, "json" for raw data. Defaults to text.'),
}, async ({ projectRoot, format }) => {
    try {
        const root = projectRoot || process.cwd();
        const report = runAnalysis(root);
        const w = report.wrapped;
        if (format === 'json') {
            return {
                content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
            };
        }
        const lines = [
            `╔══════════════════════════════════════╗`,
            `║       AGENT WRAPPED 2026             ║`,
            `╚══════════════════════════════════════╝`,
            ``,
            `  ${w.headlineStat.value} ${w.headlineStat.label}`,
            ``,
            `  ┌─────────────────────────────────┐`,
            `  │  YOUR ARCHETYPE                 │`,
            `  │  ${w.archetype.name.padEnd(32)}│`,
            `  │  ${w.archetype.traits.slice(0, 3).join(' · ').padEnd(32)}│`,
            `  └─────────────────────────────────┘`,
            ``,
            `  AUTONOMY SPLIT`,
            `  Do yourself:  ${'█'.repeat(Math.round(w.autonomySplit.doSelf / 5))}${'░'.repeat(20 - Math.round(w.autonomySplit.doSelf / 5))} ${w.autonomySplit.doSelf}%`,
            `  Ask first:    ${'█'.repeat(Math.round(w.autonomySplit.askFirst / 5))}${'░'.repeat(20 - Math.round(w.autonomySplit.askFirst / 5))} ${w.autonomySplit.askFirst}%`,
            `  Suggest only: ${'█'.repeat(Math.round(w.autonomySplit.suggest / 5))}${'░'.repeat(20 - Math.round(w.autonomySplit.suggest / 5))} ${w.autonomySplit.suggest}%`,
            ``,
            `  THE SYSTEM YOU BUILT`,
            `  ${w.systemGrid.hooks} hooks · ${w.systemGrid.skills} skills · ${w.systemGrid.scheduled} scheduled · ${w.systemGrid.rules} rules`,
            ``,
            `  ┌─────────────────────────────────┐`,
            `  │  ${String(w.shareCard.corrections).padStart(3)} corrections remembered     │`,
            `  │  ${String(w.shareCard.memories).padStart(3)} memories built up            │`,
            `  │  ${String(w.shareCard.projects).padStart(3)} projects managed             │`,
            `  │  ${w.shareCard.prohibitionRatio.padStart(3)} rules are "DON'T" rules     │`,
            `  └─────────────────────────────────┘`,
            ``,
            `  Collaboration Score: ${report.collaborationScore}/100`,
            ``,
            `  agentwrapped.com`,
        ];
        if (w.topLesson) {
            lines.splice(5, 0, ``, `  TOP LESSON: "${w.topLesson.quote}"`, `  ${w.topLesson.context}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Wrapped generation failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Agent Wrapped MCP server running');
}
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map