#!/usr/bin/env node

// Dear User — MCP Server
// Helps humans and AI agents understand each other better

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAnalysis, formatAnalyzeReport } from './tools/analyze.js';
import type { AnalyzeFormat } from './tools/analyze.js';
import { runAudit, formatAuditReport } from './tools/audit.js';
import { runOnboard, formatOnboardResult } from './tools/onboard.js';
import { runSecurity, formatSecurityReport } from './tools/security.js';
import { updateRunDetails } from './engine/db.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Dashboard URL captured at MCP boot so we can include it as a CTA at the
// bottom of long reports. Null means the dashboard didn't start (port busy,
// dependency missing, etc.) — in that case we just skip the CTA.
let DASHBOARD_URL: string | null = null;

/**
 * Wrap a report body with a "read the full version" CTA pointing at the local
 * dashboard, and persist the body in du_agent_runs.details so /r/:id can
 * render it. Silent no-ops when no agent_run id or no dashboard URL — the
 * report is returned unchanged.
 */
function attachDashboardLink(body: string, agentRunId: string | undefined): string {
  // Always persist if we have an id — even if the dashboard didn't boot,
  // future sessions may start it and find the run.
  if (agentRunId) {
    try { updateRunDetails(agentRunId, body); } catch { /* non-fatal */ }
  }
  if (!DASHBOARD_URL || !agentRunId) return body;
  return `${body}\n\n---\n\n📊 **Se fuld rapport + historik:** ${DASHBOARD_URL}/r/${agentRunId}`;
}

// __filename and __dirname are provided by the esbuild banner in the bundled output.
// For tsc-only builds (dev, tests), they're available as ESM globals via Node's --experimental-specifier-resolution.
// Declare them to satisfy TypeScript's strict mode:
declare const __filename: string;
declare const __dirname: string;

// Read version from package.json at startup
let PKG_VERSION = '1.0.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  PKG_VERSION = pkg.version;
} catch { /* fallback to hardcoded */ }

const server = new McpServer({
  name: 'dearuser',
  version: PKG_VERSION,
});

// Tool 1: analyze — full collaboration analysis
server.tool(
  'analyze',
  `Analyze your human-agent collaboration. Scans CLAUDE.md, memory files, hooks, skills, and more to produce a collaboration report with persona detection, scoring, friction analysis, and recommendations.

Returns a pre-formatted markdown report. Use the format parameter to control detail level:
- "text" (default): concise, plain-language report designed for non-technical users
- "detailed": full technical report with stats, session patterns, injection findings, feedback loop
- "json": raw structured data for programmatic use

Everything runs locally — no data leaves the machine, no API keys needed, files are only read (never modified).

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize, shorten, or add commentary around it. The report is pre-formatted for direct display. After showing the report, offer to implement any recommendation marked "Actionable". Tool recommendations with a "whoActs" line indicate whether you (the agent) can install it or the user needs to act — present accordingly.

Example prompts that should trigger this tool:
- "Analyze my collaboration with Claude"
- "How good is my Claude setup?"
- "What should I improve in my CLAUDE.md?"
- "Score my agent configuration"`,
  {
    projectRoot: z.string().optional().describe('Project root to analyze when scope="project". Defaults to current working directory. Ignored for scope="global".'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) aggregates across every project in ~/.claude/projects/. "project" narrows to a single directory.'),
    includeGit: z.boolean().optional().describe('Scan local .git directories for commit activity, stale repos, and revert-signal patterns. Defaults to true. Set false for faster runs.'),
    format: z.enum(['text', 'detailed', 'json']).optional().describe('"text" (default): concise plain-language report. "detailed": full technical report with stats, sessions, injection findings. "json": raw structured data.'),
  },
  async ({ projectRoot, scope, includeGit, format }) => {
    try {
      const root = projectRoot || process.cwd();
      const effectiveScope = scope || 'global';
      const effectiveFormat: AnalyzeFormat = format || 'text';
      const report = runAnalysis(root, {
        scope: effectiveScope,
        includeGit: includeGit !== false,
      });

      const text = formatAnalyzeReport(report, effectiveFormat);
      return {
        content: [
          { type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId) },
        ],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('EACCES') ? ' Check file permissions on ~/.claude/.'
        : msg.includes('ENOENT') ? ' The specified path does not exist — try omitting projectRoot to use the current directory.'
        : msg.includes('EISDIR') ? ' A directory was found where a file was expected — your ~/.claude/ layout may be unusual.'
        : ' Try running with scope="project" to narrow the scan, or check that ~/.claude/ exists.';
      return {
        content: [{ type: 'text', text: `Analysis failed: ${msg}${hint}` }],
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

What this tool does NOT do:
- Does NOT fix problems — it identifies them for you to decide
- Does NOT delete or modify any files, skills, or hooks
- Does NOT contact external services — pure local filesystem analysis

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize, shorten, or add commentary around it. The report is pre-formatted for direct display. Show the closure rate prominently. Lead with critical findings, then recommended, then nice-to-have. Each finding has a stable id users can reference to dismiss. Be careful: heuristic-based detection has some false positives — frame findings as "likely" not "definitely".

Example prompts that should trigger this tool:
- "Audit my Claude setup for structural issues"
- "Are any of my scheduled tasks orphaned?"
- "Check if my hooks and skills overlap"
- "Is my agent substrate well-structured?"`,
  {
    projectRoot: z.string().optional().describe('Project root (e.g., "/Users/me/my-project"). Defaults to cwd. Audit is most useful in global scope.'),
    scope: z.enum(['global', 'project']).optional().describe('Default global.'),
    focus: z.enum(['orphan', 'overlap', 'closure', 'substrate', 'mcp_refs', 'backup', 'all']).optional()
      .describe('Narrow to one finding type, or "all" (default). `mcp_refs` = tools calling unregistered MCP servers; `backup` = ~/.claude/ not in version control.'),
  },
  async ({ projectRoot, scope, focus }) => {
    try {
      const report = runAudit({
        projectRoot: projectRoot || process.cwd(),
        scope: scope || 'global',
        focus: focus || 'all',
      });
      const text = formatAuditReport(report);
      return { content: [{ type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('EACCES') ? ' Check file permissions on ~/.claude/.'
        : msg.includes('ENOENT') ? ' The specified path does not exist — try omitting projectRoot.'
        : ' Try running with focus="orphan" to narrow the scan.';
      return {
        content: [{ type: 'text', text: `Audit failed: ${msg}${hint}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: onboard — conversational setup dialog
server.tool(
  'onboard',
  `Conversational setup. Walks the user through 5 steps (intro → goals → stack+pains → substrate → plan) and produces a tailored setup plan — tailored CLAUDE.md template, skill recommendations, hook recommendations, and next 3 steps.

How to use (for the agent):
1. First call: no arguments. The tool returns an intro question + nextStep.
2. Present the question to the user and collect their answer.
3. Call again with step=<nextStep from previous>, answer=<user answer>, state=<state from previous>.
4. Continue until done=true, then show the plan.

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output each step's response text as your response — do NOT summarize, rephrase, or wrap it in your own words. The questions and final plan are pre-formatted for direct display. Just show what the tool returns, then collect the user's answer for the next step.

IMPORTANT: The \`state\` parameter is opaque. Pass it back verbatim. Do not parse or modify it.

What this tool does NOT do:
- Does NOT write files automatically — it produces a plan for the user/agent to apply
- Does NOT require prior Claude Code experience — designed for first-time users
- Does NOT collect or transmit any answers — state is a local opaque blob passed between calls

Good for: new users, non-technical professionals, anyone setting up Claude Code for the first time, or someone revisiting goals after a while.

Example prompts that should trigger this tool:
- "Set up Dear User for me"
- "I'm new to Claude Code, help me configure it"
- "Onboard me"
- "Help me create a CLAUDE.md"`,
  {
    step: z.string().optional().describe('Current step (e.g., "role", "goals", "stack"). Omit to start from intro.'),
    answer: z.string().optional().describe('User answer from the previous step (e.g., "I\'m a solo developer building SaaS products"). Required for all steps after intro.'),
    state: z.string().optional().describe('Opaque state blob from the previous call. Pass back unchanged — do not parse or modify.'),
  },
  async ({ step, answer, state }) => {
    try {
      const result = runOnboard({ step, answer, state });
      return { content: [{ type: 'text', text: formatOnboardResult(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('step') ? ' Valid steps: intro, goals, stack-pains, substrate, plan. Omit step to start fresh.'
        : msg.includes('state') ? ' The state blob may be corrupted — omit the state parameter to restart onboarding.'
        : ' Try calling onboard with no arguments to start a fresh session.';
      return {
        content: [{ type: 'text', text: `Onboard failed: ${msg}${hint}` }],
        isError: true,
      };
    }
  }
);

// Tool 4: security — secrets + injection + rule-conflict scan
server.tool(
  'security',
  `Security audit of your AI setup. Scans for:

- **Leaked secrets** — API keys, tokens, credentials in CLAUDE.md, memory, skills, or settings
- **Prompt-injection surfaces** — hooks/skills that pass user input to shell unsafely
- **Rule conflicts** — CLAUDE.md says one thing but a hook/skill does another (e.g., "never force-push" but a hook runs \`git push --force\`)

Presents findings sorted by severity (critical → recommended → nice-to-have). Secrets and rule conflicts are the highest-trust signals because false positives are rare; injection findings are pattern-based and may warrant manual review.

What this tool does NOT do:
- Does NOT access your passwords, keychains, or browser saved credentials
- Does NOT send findings to any external service — everything stays local
- Does NOT auto-rotate or revoke credentials — it reports, you act
- Does NOT scan source code repositories — only your agent config files (~/.claude/, memory, skills, hooks)

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize, shorten, or add commentary around it. The report is pre-formatted for direct display. Lead with secrets (rotate any found credentials immediately). Be precise about rule conflicts — show the rule AND the conflicting action. Don't minimize: "no findings" is a REAL signal of clean setup, not evidence of a broken scanner.

Example prompts that should trigger this tool:
- "Scan my Claude setup for security issues"
- "Are there any leaked API keys in my config?"
- "Check my hooks for prompt injection risks"
- "Security audit of my agent setup"`,
  {
    projectRoot: z.string().optional().describe('Project root (e.g., "/Users/me/my-project"). Defaults to cwd.'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) scans ~/.claude/ agent setup; "project" scans a single directory.'),
  },
  async ({ projectRoot, scope }) => {
    try {
      const report = await runSecurity({ projectRoot, scope });
      const text = formatSecurityReport(report);
      return { content: [{ type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('EACCES') ? ' Check file permissions on ~/.claude/ and your project directory.'
        : msg.includes('ENOENT') ? ' The specified path does not exist — try omitting projectRoot.'
        : msg.includes('timeout') || msg.includes('ETIMEDOUT') ? ' A platform advisor timed out — the scan still covers agent-setup security.'
        : ' Try running with scope="project" to narrow the scan.';
      return {
        content: [{ type: 'text', text: `Security scan failed: ${msg}${hint}` }],
        isError: true,
      };
    }
  }
);

// Tool 5: wrapped — shareable collaboration stats
server.tool(
  'wrapped',
  `Generate your Dear User — shareable stats about your human-agent collaboration in a fun, Spotify Wrapped-style format.

What this tool does NOT do:
- Does NOT share anything automatically — it generates text you can copy/paste if you choose
- Does NOT access external accounts or profiles
- Does NOT store or upload the generated stats anywhere

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize, shorten, or add commentary around it. The report is pre-formatted for direct display.

Example prompts that should trigger this tool:
- "Give me my Dear User Wrapped"
- "Show my collaboration stats"
- "Generate shareable stats about my Claude usage"`,
  {
    projectRoot: z.string().optional().describe('Project root when scope="project" (e.g., "/Users/me/my-project"). Ignored for scope="global".'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) aggregates across all projects; "project" narrows to one directory.'),
    format: z.enum(['text', 'json']).optional().describe('Output format. "text" (default) for terminal-friendly ASCII art, "json" for raw analysis data.'),
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
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('EACCES') ? ' Check file permissions on ~/.claude/.'
        : msg.includes('ENOENT') ? ' The specified path does not exist — try omitting projectRoot.'
        : ' Try running with format="json" for raw data, or scope="project" to narrow the scan.';
      return {
        content: [{ type: 'text', text: `Wrapped generation failed: ${msg}${hint}` }],
        isError: true,
      };
    }
  }
);

// Tool 6: help — discovery/capabilities menu
server.tool(
  'help',
  `Show Dear User's capabilities to the user. Call this whenever the user asks "what can Dear User do?", "hvad kan DearUser?", "show me the options", "help", or seems uncertain about which tool fits their need. Also call proactively the first time a user mentions Dear User if they haven't used it before.

What this tool does NOT do:
- Does NOT run any analysis — it only describes what Dear User can do
- Does NOT access or read any user files

When presenting: return the text verbatim. Do NOT summarize or re-wrap — the formatting is designed for direct chat display.`,
  {},
  async () => {
    const text = [
      `# Dear User — what I can do for you`,
      ``,
      `Dear User analyzes how you and your AI agent work together. Everything runs locally — no data leaves your machine.`,
      ``,
      `## Five tools`,
      ``,
      `**1. \`analyze\`** — Full collaboration report`,
      `   Scans your CLAUDE.md, memory, hooks, skills, sessions. Detects your persona, scores collaboration,`,
      `   surfaces friction, and recommends concrete fixes.`,
      `   → *"Analyze my collaboration with Claude"*`,
      ``,
      `**2. \`audit\`** — System coherence check`,
      `   Finds structural problems: orphan scheduled jobs, dead hooks, unregistered MCP references,`,
      `   unbacked-up substrate. Complement to analyze (architecture vs. language).`,
      `   → *"Audit my Claude setup for structural issues"*`,
      ``,
      `**3. \`security\`** — Secret & injection scan`,
      `   Looks for leaked API keys/tokens in CLAUDE.md, memory, skills, settings.`,
      `   Finds prompt-injection surfaces and unsafe hooks.`,
      `   → *"Scan my Claude setup for security issues"*`,
      ``,
      `**4. \`onboard\`** — Guided 7-step setup (for new users)`,
      `   Conversational walkthrough: role → goals → stack → pains → substrate → plan.`,
      `   Outputs a tailored CLAUDE.md + skill/hook recommendations.`,
      `   → *"Onboard me to Dear User"*`,
      ``,
      `**5. \`wrapped\`** — Shareable stats (Spotify Wrapped style)`,
      `   Your archetype, autonomy split, system size, top lesson — fun and shareable.`,
      `   → *"Give me my Dear User Wrapped"*`,
      ``,
      `## First time?`,
      `Start with \`onboard\` (tailors Dear User to your setup) or \`analyze\` (deep dive on current state).`,
      ``,
      `## Regular use`,
      `\`analyze\` for depth · \`wrapped\` for sharing · \`audit\` + \`security\` periodically.`,
      ``,
      `v${PKG_VERSION} · Learn more: dearuser.ai`,
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Dear User MCP server running');

  // Start the local dashboard in the same process. Non-fatal if it fails —
  // the MCP server keeps working even without a dashboard. Lazy-import so
  // MCP usage without the dashboard doesn't pay the startup cost of Hono.
  try {
    const { startDashboard } = await import('./dashboard.js');
    DASHBOARD_URL = await startDashboard();
  } catch (err) {
    console.error('Dashboard boot skipped:', err instanceof Error ? err.message : err);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
