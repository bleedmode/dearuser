#!/usr/bin/env node

// Dear User — MCP Server
// Helps humans and AI agents understand each other better

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAnalysis } from './tools/analyze.js';
import { recommendTools } from './templates/tool-catalog.js';

const server = new McpServer({
  name: 'dearuser',
  version: '1.0.0',
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
        `# Dear User — Collaboration Analysis`,
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

      // Category scores with status labels and what's missing
      const categoryConfig: Array<{ key: string; name: string }> = [
        { key: 'roleClarity', name: 'Role Clarity' },
        { key: 'communication', name: 'Communication' },
        { key: 'autonomyBalance', name: 'Autonomy Balance' },
        { key: 'qualityStandards', name: 'Quality Standards' },
        { key: 'memoryHealth', name: 'Memory Health' },
        { key: 'systemMaturity', name: 'System Maturity' },
        { key: 'coverage', name: 'Coverage' },
      ];

      for (const { key, name } of categoryConfig) {
        const cat = report.categories[key as keyof typeof report.categories];
        const bar = '█'.repeat(Math.round(cat.score / 10)) + '░'.repeat(10 - Math.round(cat.score / 10));

        // Status label
        let status: string;
        if (cat.score >= 85) status = 'Strong';
        else if (cat.score >= 70) status = 'Good';
        else if (cat.score >= 50) status = 'Needs work';
        else status = 'Weak — action needed';

        lines.push(`- **${name}**: ${bar} ${cat.score}/100 — *${status}*`);

        // Show what's missing for anything below 85
        if (cat.score < 85 && cat.signalsMissing.length > 0) {
          for (const missing of cat.signalsMissing.slice(0, 2)) {
            lines.push(`  - ${missing}`);
          }
        }
      }

      // Action items — the most important part
      // Combine gaps + recommendations into clear action items
      const actionItems: Array<{ priority: string; title: string; why: string; how: string }> = [];

      for (const gap of report.gaps) {
        const rec = report.recommendations.find(r =>
          r.title.toLowerCase().includes(gap.id.replace('missing_', '').replace('no_', ''))
        );

        actionItems.push({
          priority: gap.severity === 'critical' ? '🔴 Critical' : gap.severity === 'recommended' ? '🟡 Recommended' : '🟢 Nice to have',
          title: gap.section,
          why: gap.personaRelevance,
          how: rec ? rec.textBlock : 'See recommendations below.',
        });
      }

      if (actionItems.length > 0) {
        lines.push('', '## What To Do (prioritized)');
        for (const item of actionItems.slice(0, 5)) {
          lines.push(
            ``,
            `### ${item.priority}: ${item.title}`,
            `**Why:** ${item.why}`,
            `**How:**`,
            '```',
            item.how,
            '```',
          );
        }
      }

      // Friction patterns — shorter, focused
      if (report.frictionPatterns.length > 0) {
        lines.push('', '## Friction Patterns (from your history)');
        for (const fp of report.frictionPatterns.slice(0, 3)) {
          lines.push(`${fp.rank}. **${fp.title}** — ${fp.description}`);
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

      // Tool recommendations based on detected problems
      const problemIds = [
        ...report.frictionPatterns.map(f => f.theme),
        ...report.gaps.map(g => g.id),
        ...(report.stats.hooksCount === 0 ? ['no_build_verification', 'destructive_commands', 'safety'] : []),
        ...(report.session.corrections.negationCount > 3 ? ['vague_prompts'] : []),
      ];

      // Get installed MCP servers from scan
      const installedServers: string[] = []; // TODO: extract from scan
      const toolRecs = recommendTools(problemIds, report.persona.detected, installedServers);

      if (toolRecs.length > 0) {
        lines.push('', '## Recommended Tools');
        for (const tool of toolRecs.slice(0, 5)) {
          const typeLabel = tool.type === 'mcp_server' ? 'MCP' : tool.type === 'hook' ? 'Hook' : tool.type === 'github_repo' ? 'GitHub' : 'Skill';
          const starsStr = tool.stars ? ` (${(tool.stars / 1000).toFixed(0)}K stars)` : '';
          lines.push(`- **${tool.name}** [${typeLabel}]${starsStr} — ${tool.description}`);
          lines.push(`  Install: \`${tool.install.split('\n')[0]}\``);
        }
      }

      // Onboarding gaps (if significant gaps exist)
      const significantGaps = report.gaps.filter(g => g.severity === 'critical');
      if (significantGaps.length > 0) {
        lines.push(
          '', '## Onboarding: Get to Know Each Other',
          '', 'These areas are missing from your setup. Ask about them one at a time — like meeting a new colleague, not filling out a form.',
        );

        const gapQuestions: Record<string, { ask: string; why: string }> = {
          missing_roles: { ask: 'What is your role? Are you the coder, the product owner, or something else?', why: 'Calibrates how technical the agent should be.' },
          missing_autonomy: { ask: 'What should the agent do without asking? What should it always ask first?', why: 'Too much autonomy → scope creep. Too little → constant interruptions.' },
          missing_communication: { ask: 'How do you prefer communication? Language, detail level, tone?', why: 'Without this, the agent defaults to technical English.' },
          missing_quality: { ask: 'How do you know something is done? What checks should pass?', why: 'Without quality gates, broken code gets shipped.' },
          missing_north_star: { ask: 'What is your main goal? Revenue target? Learning?', why: 'Every recommendation gets evaluated against your goal.' },
          no_hooks: { ask: 'Should we add automated guardrails? (builds check, destructive command blocker)', why: 'Hooks catch errors before they reach you.' },
          no_memory: { ask: 'Your agent has no memory system. Want to enable it?', why: 'Without memory, corrections are forgotten every session.' },
        };

        for (const gap of significantGaps) {
          const q = gapQuestions[gap.id];
          if (q) {
            lines.push(`- **${q.ask}**`);
            lines.push(`  *Why:* ${q.why}`);
          }
        }

        lines.push(
          '',
          '*Tip: The agent should also tell you about itself: "I work like a colleague with amnesia — I read my briefing every morning but don\'t remember yesterday. The best way to correct me: be specific."*'
        );
      }

      return {
        content: [
          { type: 'text', text: lines.join('\n') },
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

// Tool 2: wrapped — shareable collaboration stats
server.tool(
  'wrapped',
  'Generate your Dear User — shareable stats about your human-agent collaboration in a fun, Spotify Wrapped-style format.',
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
  console.error('Dear User MCP server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
