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

// Tool 2: onboard — conversational onboarding that generates CLAUDE.md
server.tool(
  'onboard',
  `Help a human and their agent get to know each other. Scans existing setup first, then returns what's already configured and what's missing — so the agent can ask ONLY about gaps.

This tool does NOT ask questions itself. It returns structured data about what exists and what's missing. The calling agent should use this data to have a natural conversation with the user, asking about gaps one at a time.

Flow:
1. Call onboard → get back what exists + what's missing
2. Agent asks user about missing items conversationally (one at a time, not a form)
3. Agent shares something about itself too (capabilities, limitations) — it's mutual
4. When done, agent generates CLAUDE.md sections from answers`,
  {
    projectRoot: z.string().optional().describe('Project root directory to analyze. Defaults to current working directory.'),
  },
  async ({ projectRoot }) => {
    try {
      const root = projectRoot || process.cwd();
      const report = runAnalysis(root);

      // What we already know (from files)
      const known: string[] = [];
      const missing: Array<{ id: string; question: string; why: string; example: string }> = [];

      // Check each dimension
      const hasRoles = report.categories.roleClarity.score >= 70;
      const hasComm = report.categories.communication.score >= 70;
      const hasAutonomy = report.categories.autonomyBalance.score >= 50;
      const hasQuality = report.categories.qualityStandards.score >= 50;
      const hasNorthStar = report.gaps.every(g => g.id !== 'missing_north_star');
      const hasTechStack = report.gaps.every(g => g.id !== 'missing_tech_stack');

      if (hasRoles) known.push('Roles are defined — I can see who does what');
      else missing.push({
        id: 'roles',
        question: 'What is your role? Are you the coder, the product owner, or something else?',
        why: 'This helps calibrate how technical the agent should be and what it handles autonomously.',
        example: 'Example: "I\'m a CEO who can\'t code. You handle all technical work."',
      });

      if (hasComm) known.push('Communication style is defined');
      else missing.push({
        id: 'communication',
        question: 'How do you prefer communication? Short and direct? Detailed explanations? What language?',
        why: 'Without this, the agent defaults to technical English — which may not be what you need.',
        example: 'Example: "Danish, business language, no jargon, keep it short."',
      });

      if (hasAutonomy) known.push('Autonomy levels are configured');
      else missing.push({
        id: 'autonomy',
        question: 'What should the agent do without asking? What should it always ask about first?',
        why: 'Too much autonomy → scope creep. Too little → constant interruptions.',
        example: 'Example: "Fix bugs and commit yourself. Ask before changing architecture or adding dependencies."',
      });

      if (hasQuality) known.push('Quality standards are in place');
      else missing.push({
        id: 'quality',
        question: 'How do you know something is "done"? What checks should pass?',
        why: 'Without quality gates, the agent may ship broken code.',
        example: 'Example: "It builds without errors, existing features still work, code is committed."',
      });

      if (hasNorthStar) known.push('Goals/north star is defined');
      else missing.push({
        id: 'north_star',
        question: 'What is your main goal? Revenue target? Learning? Building a portfolio?',
        why: 'Every recommendation gets evaluated against your goal.',
        example: 'Example: "$10K MRR in 6 months" or "Learn React by building a side project."',
      });

      if (hasTechStack) known.push('Tech stack is documented');
      else missing.push({
        id: 'tech_stack',
        question: 'What tools and technologies are you using? (or should the agent choose?)',
        why: 'Prevents the agent from suggesting incompatible solutions.',
        example: 'Example: "Astro for websites, Expo for apps, Supabase for database, Vercel for hosting."',
      });

      // Memory health
      if (report.stats.memoryFiles > 3) known.push(`${report.stats.memoryFiles} memory files — good learning history`);
      else missing.push({
        id: 'memory',
        question: 'Has your agent been correcting and learning from mistakes? (This builds up over time)',
        why: 'Without memory, the agent forgets corrections every session.',
        example: 'Tip: After corrections, say "remember this for next time."',
      });

      // System maturity
      if (report.stats.hooksCount > 0) known.push(`${report.stats.hooksCount} hooks — automated guardrails in place`);
      if (report.stats.skillsCount > 0) known.push(`${report.stats.skillsCount} skills — reusable workflows defined`);
      if (report.stats.scheduledTasksCount > 0) known.push(`${report.stats.scheduledTasksCount} scheduled tasks — automation running`);

      // Build response
      const lines: string[] = [
        `# Onboarding Assessment`,
        ``,
        `**Persona detected:** ${report.persona.archetypeName} (${report.persona.detected.replace('_', ' ')}, ${report.persona.confidence}% confidence)`,
        `**Collaboration score:** ${report.collaborationScore}/100`,
        ``,
      ];

      if (known.length > 0) {
        lines.push(`## Already configured (${known.length} items)`, '');
        for (const k of known) lines.push(`- ✅ ${k}`);
        lines.push('');
      }

      if (missing.length > 0) {
        lines.push(`## Gaps to fill (${missing.length} items)`, '');
        lines.push(`Ask the user about these one at a time, conversationally. Share something about yourself (your capabilities, limitations) between questions. Don't make it feel like a form.`, '');
        for (const m of missing) {
          lines.push(`### ${m.id}`);
          lines.push(`**Ask:** ${m.question}`);
          lines.push(`**Why it matters:** ${m.why}`);
          lines.push(`**${m.example}**`);
          lines.push('');
        }
      } else {
        lines.push('## No gaps found!', '', 'This setup looks comprehensive. Run `analyze` for detailed scoring and recommendations.');
      }

      lines.push(
        '',
        '## What the agent should share about itself',
        '',
        'Between questions, the agent should tell the user:',
        '- "I work like a colleague with amnesia — I read my briefing (CLAUDE.md) every morning but don\'t remember yesterday"',
        '- "I\'m good at: writing code, research, git, deploys, repetitive tasks"',
        '- "I struggle with: knowing what YOU want without clear instructions, admitting uncertainty, stopping when I should ask"',
        '- "The best way to correct me: be specific. \'Don\'t do X because Y\' works better than just \'no\'"',
        '',
        '## After the conversation',
        '',
        'Generate CLAUDE.md sections from the answers. Use the `analyze` tool to verify the score improved.',
      );

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Onboarding failed: ${error instanceof Error ? error.message : String(error)}` }],
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
