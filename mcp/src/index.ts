#!/usr/bin/env node

// Dear User — MCP Server
// Helps humans and AI agents understand each other better

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAnalysis } from './tools/analyze.js';
import { runAudit, formatAuditReport } from './tools/audit.js';
import { recommendTools } from './templates/tool-catalog.js';

const server = new McpServer({
  name: 'dearuser',
  version: '1.0.0',
});

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
    projectRoot: z.string().optional().describe('Project root to analyze when scope="project". Defaults to current working directory. Ignored for scope="global".'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) aggregates across every project in ~/.claude/projects/ — the right mode for collaboration analysis, since the human↔agent relationship spans projects. "project" narrows to a single directory.'),
    includeGit: z.boolean().optional().describe('Scan local .git directories in observed projects for commit activity, stale repos, and revert-signal patterns. Defaults to true. Set false for faster runs or when you only want config-level insights.'),
  },
  async ({ projectRoot, scope, includeGit }) => {
    try {
      const root = projectRoot || process.cwd();
      const effectiveScope = scope || 'global';
      const report = runAnalysis(root, {
        scope: effectiveScope,
        includeGit: includeGit !== false,
      });

      // Format key insights as readable text
      const scopeBanner = report.scope === 'global'
        ? `*Scope: global — aggregated across ${report.projectsObserved} project${report.projectsObserved === 1 ? '' : 's'} in ~/.claude/projects/*`
        : `*Scope: project — ${report.scanRoot}*`;

      const lines: string[] = [
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

      // === Action items split by audience ===
      // Two distinct tracks: agent-changes (copy-paste into files/config) and
      // user-changes (behavior coaching with why/how/practice). They demand
      // different actions from the reader and must not be mixed in one list.
      const priorityLabel = (p: string) =>
        p === 'critical' ? '🔴 Critical' : p === 'recommended' ? '🟡 Recommended' : '🟢 Nice to have';

      const priorityOrder = (p: string) => (p === 'critical' ? 0 : p === 'recommended' ? 1 : 2);

      const agentRecs = report.recommendations
        .filter(r => r.audience === 'agent' || r.audience === 'both')
        .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

      const userRecs = report.recommendations
        .filter(r => r.audience === 'user' || r.audience === 'both')
        .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

      // --- 🤖 Agent changes ---
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
            lines.push('');
            lines.push('**Evidence:**');
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

      // --- 👤 User coaching ---
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
            lines.push('');
            lines.push('**Evidence from your own setup:**');
            for (const ev of rec.evidence) {
              lines.push(`- 💬 *"${ev.excerpt}"*  — ${ev.source}`);
            }
          }

          if (rec.why) {
            lines.push('', `**Why it matters:** ${rec.why}`);
          }
          if (rec.howItLooks) {
            lines.push('', '**How it looks when done right:**', '```', rec.howItLooks, '```');
          }
          if (rec.practiceStep) {
            lines.push('', `**Practice this next time:** ${rec.practiceStep}`);
          }
          lines.push('');
        }
      }

      // If no recommendations in either bucket, explain that.
      if (agentRecs.length === 0 && userRecs.length === 0) {
        lines.push(
          '', '## No action items',
          'No critical gaps detected in your setup, and no friction patterns had enough evidence to recommend a behavior change. Your collaboration looks healthy on the dimensions we can see.',
        );
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

      // Git activity — project-level signals from local .git directories.
      // Only show if scanning was enabled AND we found at least one repo.
      if (report.git && report.git.totalScanned > 0) {
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
      }

      // Injection findings — static pattern-matching for prompt-injection surfaces.
      // Only surface critical/recommended to avoid overwhelming with nice_to_have.
      const injection = report.injection || [];
      const importantInjection = injection.filter(i => i.severity !== 'nice_to_have');
      if (importantInjection.length > 0) {
        lines.push(
          '', '## 🛡️ Injection Surfaces',
          `Pattern-matched hooks, skills, and MCP configs for prompt-injection risks. Flagging ${importantInjection.length} item${importantInjection.length === 1 ? '' : 's'} worth a manual review — false positives are possible.`,
          '',
        );
        for (const finding of importantInjection.slice(0, 5)) {
          const label = finding.severity === 'critical' ? '🔴 Critical' : '🟡 Recommended';
          lines.push(`### ${label}: ${finding.title}`);
          lines.push(`**Why it matters:** ${finding.why}`);
          lines.push('');
          lines.push(`**In:** \`${finding.artifactPath}\``);
          lines.push('');
          lines.push('```');
          lines.push(finding.excerpt);
          lines.push('```');
          lines.push('');
          lines.push(`**Fix:** ${finding.recommendation}`);
          lines.push('');
        }
      }

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

      // Feedback loop section — show which specific recommendations are
      // pending/implemented/ignored, not just the totals. Users can't act
      // on "1 pending" without knowing what that 1 is.
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
      }

      // Tool recommendations based on detected problems.
      const problemIds = [
        ...report.frictionPatterns.map(f => f.theme),
        ...report.gaps.map(g => g.id),
        ...(report.stats.hooksCount === 0 ? ['no_build_verification', 'destructive_commands', 'safety'] : []),
        ...(report.session.corrections.negationCount > 3 ? ['vague_prompts'] : []),
      ];

      // Installed MCP servers are now scanned from ~/.claude/mcp.json,
      // ~/.claude/settings.json, and .mcp.json — so we don't re-recommend
      // tools the user already has.
      const toolRecs = recommendTools(problemIds, report.persona.detected, report.installedServers);

      if (toolRecs.length > 0) {
        lines.push('', '## Recommended Tools', '');
        for (const tool of toolRecs.slice(0, 5)) {
          const typeLabel = tool.type === 'mcp_server' ? 'MCP' : tool.type === 'hook' ? 'Hook' : tool.type === 'github_repo' ? 'GitHub' : 'Skill';
          const starsStr = tool.stars ? ` · ${(tool.stars / 1000).toFixed(0)}K⭐` : '';
          lines.push(`### ${tool.name} [${typeLabel}${starsStr}]`);
          lines.push(tool.description);
          // Multi-line install configs get a proper code block so users can
          // actually copy-paste the JSON/command. Previously we only showed
          // the first line which truncated all the hook configs.
          const install = tool.install.trim();
          if (install.includes('\n')) {
            lines.push('', '```', install, '```');
          } else {
            lines.push('', `\`${install}\``);
          }
          lines.push('');
        }
      }

      // Onboarding — conversation starters for gaps the agent should learn about.
      // Show both critical and recommended gaps so a mature setup (with only
      // minor gaps) still gets useful prompts, not an empty section.
      const GAP_QUESTIONS: Record<string, { ask: string; why: string }> = {
        missing_roles: { ask: 'What is your role? Are you the coder, the product owner, or something else?', why: 'Calibrates how technical the agent should be.' },
        missing_autonomy: { ask: 'What should the agent do without asking? What should it always ask first?', why: 'Too much autonomy → scope creep. Too little → constant interruptions.' },
        missing_communication: { ask: 'How do you prefer communication? Language, detail level, tone?', why: 'Without this, the agent defaults to technical English.' },
        missing_quality: { ask: 'How do you know something is done? What checks should pass?', why: 'Without quality gates, broken code gets shipped.' },
        missing_north_star: { ask: 'What is your main goal? Revenue target, user growth, learning?', why: 'Every recommendation gets evaluated against your goal.' },
        missing_tech_stack: { ask: 'What is your standard tech stack for new projects?', why: 'Prevents the agent from suggesting frameworks you don\'t use.' },
        missing_learnings: { ask: 'What lesson from the last 3 months should your agent never forget?', why: 'Surfaces tacit knowledge that would otherwise stay in your head.' },
        no_hooks: { ask: 'Should we add automated guardrails? (build check, destructive-command blocker, protected-files guard)', why: 'Hooks catch errors before they reach you.' },
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

// Tool 2: audit — system coherence (vs analyze which looks at language)
server.tool(
  'audit',
  `Audit your AI setup for structural incoherence. Complement to analyze: where analyze looks at collaboration language, audit looks at system architecture.

Detects:
- **Orphan scheduled jobs** — task produces output nothing reads
- **Overlap** — skills/tasks/commands with similar purpose or same output path
- **Missing closure** — non-scheduled producers with no downstream reader
- **Substrate mismatch** — memory files that look like databases in disguise

IMPORTANT — When presenting results:
- Show the closure rate prominently
- Lead with critical findings, then recommended, then nice-to-have
- Each finding has a stable id users can reference to dismiss
- Be careful: heuristic-based detection has some false positives — frame findings as "likely" not "definitely"`,
  {
    projectRoot: z.string().optional().describe('Project root. Defaults to cwd. Audit is most useful in global scope.'),
    scope: z.enum(['global', 'project']).optional().describe('Default global.'),
    focus: z.enum(['orphan', 'overlap', 'closure', 'substrate', 'all']).optional()
      .describe('Narrow to one finding type, or "all" (default).'),
  },
  async ({ projectRoot, scope, focus }) => {
    try {
      const report = runAudit({
        projectRoot: projectRoot || process.cwd(),
        scope: scope || 'global',
        focus: focus || 'all',
      });
      return { content: [{ type: 'text', text: formatAuditReport(report) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Audit failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: wrapped — shareable collaboration stats
server.tool(
  'wrapped',
  'Generate your Dear User — shareable stats about your human-agent collaboration in a fun, Spotify Wrapped-style format.',
  {
    projectRoot: z.string().optional().describe('Project root when scope="project". Ignored for scope="global".'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) aggregates across all projects; "project" narrows to one directory.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. "text" for terminal display, "json" for raw data. Defaults to text.'),
  },
  async ({ projectRoot, scope, format }) => {
    try {
      const root = projectRoot || process.cwd();
      const report = runAnalysis(root, scope || 'global');
      const w = report.wrapped;

      if (format === 'json') {
        return {
          content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
        };
      }

      const lines: string[] = [
        `╔══════════════════════════════════════╗`,
        `║       DEAR USER WRAPPED 2026         ║`,
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
        `  dearuser.ai`,
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
