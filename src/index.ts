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
server.tool(
  'analyze',
  `Analyze your human-agent collaboration. Scans CLAUDE.md, memory files, hooks, skills, and more to produce a collaboration report with persona detection, scoring, friction analysis, and recommendations.

IMPORTANT — When presenting results to the user:
- ALWAYS show the evidence rating (A/B/C/D) for each claim
- ALWAYS show the caveat for each recommendation
- NEVER present D-rated sources as "findings" — say "one practitioner reports..."
- NEVER combine multiple recommendations into a single claim
- Show the collaboration score prominently
- If score categories have signals_missing, mention the top 1-2 gaps
- Present recommendations sorted by severity (critical first)`,
  {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
  },
  async ({ projectRoot }) => {
    try {
      const root = projectRoot || process.cwd();
      const report = runAnalysis(root);

      // Format key insights as readable text
      const lines: string[] = [
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

      const categoryNames: Record<string, string> = {
        roleClarity: 'Role Clarity',
        communication: 'Communication',
        autonomyBalance: 'Autonomy Balance',
        qualityStandards: 'Quality Standards',
        memoryHealth: 'Memory Health',
        systemMaturity: 'System Maturity',
        coverage: 'Coverage',
      };

      for (const [key, name] of Object.entries(categoryNames)) {
        const cat = report.categories[key as keyof typeof report.categories];
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
      lines.push(
        '', '## Stats',
        `- **${report.stats.totalRules}** rules (${report.stats.doRules} autonomous, ${report.stats.askRules} ask-first, ${report.stats.suggestRules} suggest-only, ${report.stats.prohibitionRules} prohibitions)`,
        `- **${report.stats.memoryFiles}** memory files (${report.stats.feedbackMemories} feedback)`,
        `- **${report.stats.totalLearnings}** learnings documented`,
        `- **${report.stats.hooksCount}** hooks, **${report.stats.skillsCount}** skills, **${report.stats.scheduledTasksCount}** scheduled tasks`,
        `- **${report.stats.mcpServersCount}** MCP servers connected`,
        `- **${report.stats.projectsManaged}** projects managed`,
      );

      // Session data
      if (report.session) {
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
      }

      // Feedback loop section
      if (report.feedback && report.feedback.totalRecommendations > 0) {
        lines.push(
          '', '## Feedback Loop',
          `- **${report.feedback.totalRecommendations}** previous recommendations tracked`,
          `- **${report.feedback.implemented}** implemented, **${report.feedback.ignored}** ignored, **${report.feedback.pending}** pending`,
        );
        if (report.feedback.avgScoreImprovement !== null) {
          const dir = report.feedback.avgScoreImprovement >= 0 ? '+' : '';
          lines.push(`- Average score change after implementation: **${dir}${report.feedback.avgScoreImprovement}** points`);
        }
      }

      return {
        content: [
          { type: 'text', text: lines.join('\n') },
          { type: 'text', text: '\n\n---\n*Raw JSON report available via the wrapped tool*' },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Analysis failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: suggest — get specific recommendations
server.tool(
  'suggest',
  'Get specific, actionable recommendations to improve your agent collaboration. Returns text blocks you can add to your CLAUDE.md or settings.',
  {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
    focus: z.enum(['roles', 'autonomy', 'communication', 'quality', 'memory', 'all']).optional().describe('Focus area for recommendations. Defaults to all.'),
  },
  async ({ projectRoot, focus }) => {
    try {
      const root = projectRoot || process.cwd();
      const report = runAnalysis(root);

      let recs = report.recommendations;
      if (focus && focus !== 'all') {
        const focusMap: Record<string, string[]> = {
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

      const lines: string[] = [
        `# Recommendations for ${report.persona.archetypeName}`,
        `Persona: **${report.persona.detected.replace('_', ' ')}** | Score: **${report.collaborationScore}/100**`,
        '',
      ];

      for (const rec of recs) {
        const icon = rec.priority === 'critical' ? '🔴' : rec.priority === 'recommended' ? '🟡' : '🟢';
        lines.push(
          `## ${icon} ${rec.title}`,
          rec.description,
          '',
          '```markdown',
          rec.textBlock,
          '```',
          `*${rec.placementHint}*`,
          '',
        );
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Suggestion generation failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: wrapped — shareable collaboration stats
server.tool(
  'wrapped',
  'Generate your Agent Wrapped — shareable stats about your human-agent collaboration in a fun, Spotify Wrapped-style format.',
  {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. "text" for terminal display, "json" for raw data. Defaults to text.'),
  },
  async ({ projectRoot, format }) => {
    try {
      const root = projectRoot || process.cwd();
      const report = runAnalysis(root);
      const w = report.wrapped;

      if (format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        };
      }

      const lines: string[] = [
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
        lines.splice(5, 0,
          ``,
          `  TOP LESSON: "${w.topLesson.quote}"`,
          `  ${w.topLesson.context}`,
        );
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Wrapped generation failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

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
