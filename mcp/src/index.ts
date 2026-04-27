#!/usr/bin/env node

// Dear User — MCP Server
// Helps humans and AI agents understand each other better

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAnalysis, formatAnalyzeReport } from './tools/analyze.js';
import type { AnalyzeFormat } from './tools/analyze.js';
import { formatWrappedText, formatWrappedJson } from './tools/wrapped.js';
import { runAudit, formatAuditReport } from './tools/audit.js';
import { runOnboard, formatOnboardResult } from './tools/onboard.js';
import { runSecurity, formatSecurityReport } from './tools/security.js';
import { runHistory } from './tools/history.js';
import { runShareReport } from './tools/share.js';
import { sendFeedback, formatFeedbackResult } from './tools/feedback.js';
import { insertAgentRun, updateRunDetails, updateRunJson, getRecommendationById, updateRecommendationStatus, getRecommendations } from './engine/db.js';
import { reconcilePendingRecommendations } from './engine/reconcile-recommendations.js';
import { implementClaudeMdAppend, implementSettingsMerge, prepareShellExec, prepareManual } from './engine/implementer.js';
import { friendlyLabel } from './engine/friendly-labels.js';
import { isFirstTime } from './engine/user-preferences.js';
import { existsSync, mkdirSync, openSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';

// Dashboard URL captured at MCP boot so we can include it as a CTA at the
// bottom of long reports. Null means the dashboard didn't start (port busy,
// dependency missing, etc.) — in that case we just skip the CTA.
let DASHBOARD_URL: string | null = null;

/**
 * Open a URL in the user's default browser. Silent best-effort — we never
 * block or throw if it fails. Opt out by setting DEARUSER_NO_AUTO_OPEN=1
 * (useful for headless CI, SSH sessions, or if the user hates popups).
 *
 * Why this exists: the agent often summarises long reports and drops the
 * dashboard link at the bottom. Auto-opening the browser guarantees the
 * user actually sees the report regardless of summarisation.
 */
function openInBrowser(url: string): void {
  if (process.env.DEARUSER_NO_AUTO_OPEN === '1') return;

  // Map platform → command. We use the array form of spawn so no shell
  // interprets the URL (avoids URL-injection edge cases).
  let cmd: string;
  let args: string[];
  switch (process.platform) {
    case 'darwin':
      cmd = 'open';
      args = [url];
      break;
    case 'win32':
      cmd = 'cmd';
      args = ['/c', 'start', '""', url];
      break;
    default:
      cmd = 'xdg-open';
      args = [url];
  }

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    child.on('error', () => { /* silent — missing xdg-open on minimal Linux is fine */ });
  } catch {
    // Silent — never let browser-open failure break a report delivery.
  }
}

/**
 * Build the "Hvad vil du gøre?" action menu that the agent should surface
 * to the user after a report. Pulls the top 3 actionable pending
 * recommendations (those with non-manual action types we can execute).
 * Returns null when there's nothing actionable — avoids an empty menu.
 */
function buildActionMenu(): string | null {
  try {
    reconcilePendingRecommendations();
    const pending = getRecommendations('pending') as any[];
    const actionable = pending
      .filter(r => r.action_type && r.action_type !== 'manual' && r.action_data)
      .slice(0, 3);
    if (actionable.length === 0) return null;

    const hintFor = (r: any): string => {
      switch (r.action_type) {
        case 'settings_merge':  return 'sætter det op automatisk';
        case 'claude_md_append': return 'tilføjer reglen til CLAUDE.md';
        case 'shell_exec':      return 'kører installations-kommandoen';
        default: return '';
      }
    };

    const lines: string[] = [
      '',
      '---',
      '',
      '## Hvad vil du gøre nu?',
      '',
      '[AGENT INSTRUCTION: Use the AskUserQuestion tool with the options below so the user gets a native clickable menu. If AskUserQuestion is not available, present the numbered list as-is and accept a digit or short phrase as the answer. When the user picks an option, call `mcp__dearuser__implement_recommendation` with the matching `recommendation_id`. For "spring over" / "drop" answers, call `mcp__dearuser__dismiss_recommendation`.]',
      '',
    ];

    actionable.forEach((r, i) => {
      const f = friendlyLabel(r.title);
      const autoHint = hintFor(r);
      const title = f.title?.en ?? f.title?.da ?? r.title;
      const summary = f.summary?.en ?? f.summary?.da ?? '';
      const benefit = f.benefit?.en ?? f.benefit?.da ?? '';
      lines.push(`${i + 1}. **${title}**`);
      if (summary) lines.push(`   _Hvad er det:_ ${summary}`);
      if (benefit) lines.push(`   _Hvad bliver bedre:_ ${benefit}`);
      if (autoHint) lines.push(`   _(jeg ${autoHint} for dig)_`);
      lines.push(`   \`recommendation_id: ${r.id}\``);
      lines.push('');
    });

    lines.push(`${actionable.length + 1}. **Tag dem alle** — implementér 1-${actionable.length} på én gang`);
    lines.push(`${actionable.length + 2}. **Spring over for nu** — kom tilbage senere`);

    return lines.join('\n');
  } catch {
    return null;
  }
}

/**
 * Wrap a report body with a dashboard CTA and an action menu, persist it in
 * du_agent_runs.details so /r/:id can render it, AND auto-open the report in
 * the user's browser so they see it regardless of whether the agent
 * summarised away the link. Also persists the structured report (when
 * provided) so the dashboard can render a letter-layout instead of a raw
 * markdown dump.
 */
function attachDashboardLink(
  body: string,
  agentRunId: string | undefined,
  structuredReport?: unknown,
): string {
  // Build the action menu BEFORE we persist, so the dashboard /r/:id view
  // also carries the menu (useful if the user comes back to an old report).
  const menu = buildActionMenu();
  const composed = menu ? `${body}${menu}` : body;

  if (agentRunId) {
    try { updateRunDetails(agentRunId, composed); } catch { /* non-fatal */ }
    if (structuredReport !== undefined) {
      try { updateRunJson(agentRunId, structuredReport); } catch { /* non-fatal */ }
    }
  }
  if (!DASHBOARD_URL || !agentRunId) return composed;

  const reportUrl = `${DASHBOARD_URL}/r/${agentRunId}`;
  // Fire-and-forget — don't wait for the browser.
  openInBrowser(reportUrl);

  return `${composed}\n\n---\n\n📊 **Rapporten er åbnet i din browser:** ${reportUrl}\n\n_Åbner den ikke automatisk? Klik linket eller kør \`open ${reportUrl}\` i terminalen._`;
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

/**
 * First-run short-circuit. If the user has never completed onboarding we
 * bail out of the heavy tools (collab/security/health) and redirect them
 * to the onboard flow. Scanning before we know who they are produces
 * generic, unhelpful reports and wastes their first impression.
 *
 * Bypass: set DEARUSER_SKIP_ONBOARD=1 (CI, debugging, one-shot evals).
 */
function firstRunNudge(toolName: 'collab' | 'health' | 'security') {
  if (process.env.DEARUSER_SKIP_ONBOARD === '1') return null;
  if (!isFirstTime()) return null;
  const localeDa = process.env.LANG?.startsWith('da') ?? false;
  const msg = localeDa
    ? [
        '💌 **Velkommen — lad os lige lære hinanden at kende først.**',
        '',
        `Før jeg kører \`${toolName}\` har jeg brug for et par oplysninger om dig — hvad jeg skal kalde dig, hvordan du arbejder, og hvad du forventer af mig. Det tager under et minut.`,
        '',
        'Kør: `mcp__dearuser__onboard` (eller skriv `/dearuser-onboard` hvis du er i Claude Code).',
        '',
        '_Vil du springe over og få en generisk rapport? Sæt `DEARUSER_SKIP_ONBOARD=1` i dit miljø._',
      ].join('\n')
    : [
        "💌 **Welcome — let's get to know each other first.**",
        '',
        `Before I run \`${toolName}\` I need a few things about you — what to call you, how you work, and what you expect from me. Takes under a minute.`,
        '',
        'Run: `mcp__dearuser__onboard` (or type `/dearuser-onboard` inside Claude Code).',
        '',
        '_Want to skip and get a generic report? Set `DEARUSER_SKIP_ONBOARD=1` in your environment._',
      ].join('\n');
  return { content: [{ type: 'text' as const, text: msg }] };
}

// Tool 1: analyze — full collaboration analysis
server.tool(
  'collab',
  `Analyze your human-agent collaboration. Scans your agent contract (CLAUDE.md or AGENTS.md), memory files, hooks, skills, and more to produce a collaboration report with persona detection, scoring, friction analysis, and recommendations.

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
- "What should I improve in my CLAUDE.md or AGENTS.md?"
- "Score my agent configuration"`,
  {
    projectRoot: z.string().optional().describe('Project root to analyze when scope="project". Defaults to current working directory. Ignored for scope="global".'),
    scope: z.enum(['global', 'project']).optional().describe('"global" (default) aggregates across every project in ~/.claude/projects/. "project" narrows to a single directory.'),
    includeGit: z.boolean().optional().describe('Scan local .git directories for commit activity, stale repos, and revert-signal patterns. Defaults to true. Set false for faster runs.'),
    format: z.enum(['text', 'detailed', 'json']).optional().describe('"text" (default): concise plain-language report. "detailed": full technical report with stats, sessions, injection findings. "json": raw structured data.'),
  },
  async ({ projectRoot, scope, includeGit, format }) => {
    const nudge = firstRunNudge('collab');
    if (nudge) return nudge;
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
          { type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId, report) },
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

// Tool 2: system-health — checks whether your stack still hangs together.
// Named "health" (was "audit", then "system_health") — audit implied compliance paperwork;
// what this does is measure the operational health of your agent stack.
server.tool(
  'health',
  `Check the health of your AI stack. Returns a 0-100 system-sundhed score with category breakdown, plus findings ranked by severity. Complement to collab: where collab scores how well you and the agent communicate, health scores whether your skills, hooks, scheduled tasks, and MCP servers are still hanging together or have started drifting apart.

Detects:
- **Orphan scheduled jobs** — task produces output nothing reads
- **Stale schedules** — jobs that stopped firing silently despite being enabled
- **Expected jobs missing** — jobs declared in ~/.dearuser/expected-jobs.json that aren't registered
- **Overlap** — skills/tasks/commands with similar purpose or same output path
- **Missing closure** — non-scheduled producers with no downstream reader
- **Substrate mismatch** — memory files that look like databases in disguise
- **Unregistered MCP tools** — skills calling tools whose server isn't registered
- **Unbacked-up substrate** — active ~/.claude/ files outside version control
- **Reconciliation gap** — findings open in the ledger for 14+ days (closed-loop failure)

What this tool does NOT do:
- Does NOT fix problems — it identifies them for you to decide
- Does NOT delete or modify any files, skills, or hooks
- Does NOT contact external services — pure local filesystem analysis

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize, shorten, or add commentary around it. The report is pre-formatted for direct display. Show the score and ceiling prominently. Lead with critical findings, then recommended, then nice-to-have. Each finding has a stable id users can reference to dismiss. Heuristic-based detection has some false positives — frame findings as "likely" not "definitely".

Example prompts that should trigger this tool:
- "Check my system's health"
- "Are any of my scheduled tasks orphaned?"
- "Kør health"
- "Kør system-sundhed"
- "Is my agent substrate well-structured?"`,
  {
    projectRoot: z.string().optional().describe('Project root (e.g., "/Users/me/my-project"). Defaults to cwd. Audit is most useful in global scope.'),
    scope: z.enum(['global', 'project']).optional().describe('Default global.'),
    focus: z.enum(['orphan', 'overlap', 'closure', 'substrate', 'mcp_refs', 'backup', 'stale_schedule', 'expected_jobs', 'reconciliation_gap', 'all']).optional()
      .describe('Narrow to one finding type, or "all" (default). `stale_schedule` = jobs that stopped firing; `expected_jobs` = jobs declared in ~/.dearuser/expected-jobs.json but not registered; `mcp_refs` = tools calling unregistered MCP servers; `backup` = ~/.claude/ not in version control; `reconciliation_gap` = findings sitting open for 14+ days.'),
  },
  async ({ projectRoot, scope, focus }) => {
    const nudge = firstRunNudge('health');
    if (nudge) return nudge;
    try {
      const report = runAudit({
        projectRoot: projectRoot || process.cwd(),
        scope: scope || 'global',
        focus: focus || 'all',
      });
      const text = formatAuditReport(report, focus || 'all');
      return { content: [{ type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId, report) }] };
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

// Tool: history — retrieve past reports without re-running
server.tool(
  'history',
  `Retrieve past Dear User reports without re-running the scan. Reads from local SQLite (~/.dearuser/dearuser.db) — no network, no fresh scan. Use when the user wants to see their latest score, how scores have changed over time, or what got better/worse since the last run. A fresh scan takes ~30s; this returns instantly. Call \`collab\`/\`health\`/\`security\` instead if the user explicitly asks for a new scan.

Three formats:
- **"summary"** (default): latest stored report per scope. Fast, no re-scan. Use when the user asks what the previous/overnight report said.
- **"trend"**: score sparkline over time per scope, with delta from oldest to newest. Use for "is it getting better?" questions.
- **"regression"**: delta vs prior run — score change + new/resolved findings by stable ID. Use for "what changed?" / "what's new?" questions.

Scope narrows to one area: "collab", "health", "security", or "all" (default).

Pass \`run_id\` to fetch a specific historical report by its ID (printed at the bottom of every Dear User report).

What this tool does NOT do:
- Does NOT run any new scans — pure read of stored reports
- Does NOT delete or modify stored history
- Does NOT contact any external service — everything stays on your machine

IMPORTANT — Presenting results:
The user cannot see raw tool results. You MUST output the full report as your response text — do NOT summarize or add commentary. Output is pre-formatted markdown with a "What to do next" section.

Example prompts that should trigger this tool:
- "Vis seneste rapport"
- "Show me the latest collab score"
- "Er sikkerheden blevet bedre?"
- "Hvad fandt nattens scan?"
- "What changed since last run?"
- "Vis trend"`,
  {
    scope: z.enum(['collab', 'health', 'security', 'wrapped', 'all']).optional().describe('Which tool to fetch history for. Default "all" returns latest from each of collab, health, security. "wrapped" is only valid with format "json" or "summary".'),
    format: z.enum(['summary', 'trend', 'regression', 'json']).optional().describe('"summary" (default) = latest run per scope. "trend" = score sparkline over time. "regression" = delta vs prior run. "json" = raw report_json for the latest run in a specific scope (used by share_report).'),
    limit: z.number().int().positive().max(90).optional().describe('For trend: number of runs to include (default 14, max 90). Ignored for summary/regression.'),
    run_id: z.string().optional().describe('Fetch a specific run by ID (shown at the bottom of every report). When set, other params are ignored.'),
  },
  async ({ scope, format, limit, run_id }) => {
    try {
      const text = runHistory({ scope, format, limit, runId: run_id });
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `History failed: ${msg}. Try omitting all parameters for the default summary view.` }],
        isError: true,
      };
    }
  }
);

// Tool 3: onboard — conversational setup dialog
server.tool(
  'onboard',
  `Conversational setup. Walks the user through 5 steps (intro → goals → stack+pains → substrate → plan) and produces a tailored setup plan — tailored agent-contract template (CLAUDE.md or AGENTS.md), skill recommendations, hook recommendations, and next 3 steps.

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
- "Help me create a CLAUDE.md"
- "Help me create an AGENTS.md"`,
  {
    step: z.string().optional().describe('Current step (e.g., "role", "goals", "stack"). Omit to start from intro.'),
    answer: z.string().optional().describe('User answer from the previous step (e.g., "I\'m a solo developer building SaaS products"). Required for all steps after intro.'),
    state: z.string().optional().describe('Opaque state blob from the previous call. Pass back unchanged — do not parse or modify.'),
  },
  async ({ step, answer, state }) => {
    try {
      // If this is a fresh onboarding call (no step, no state) AND the
      // dashboard is running, open the browser to the visual flow instead
      // of chatting through the questions. The Lovable audience finds the
      // browser form much easier than typing long answers in chat.
      const fresh = !step && !state && !answer;
      if (fresh && DASHBOARD_URL) {
        const onboardUrl = `${DASHBOARD_URL}/onboard`;
        openInBrowser(onboardUrl);
        return {
          content: [{
            type: 'text',
            text: [
              `💌 **Jeg har åbnet opstarts-vinduet i din browser:** ${onboardUrl}`,
              ``,
              `Svar på de 5 korte spørgsmål der — det er nemmere end at skrive lange svar i chatten. Jeg venter her imens.`,
              ``,
              `_Foretrækker du at blive her i chatten? Kør \`onboard\` igen med \`answer=chat\` så fortsætter vi på den gamle måde._`,
            ].join('\n'),
          }],
        };
      }

      // Chat-mode fallback — either explicit opt-in ("answer=chat" on a
      // fresh call) or continuing a session that started in chat.
      const chatAnswer = answer === 'chat' && fresh ? '' : answer;
      const result = runOnboard({ step, answer: chatAnswer, state });
      return { content: [{ type: 'text', text: formatOnboardResult(result) }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const hint = msg.includes('step') ? ' Valid steps: greet, intro, work, data, cadence, plan. Omit step to start fresh.'
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

- **Leaked secrets** — API keys, tokens, credentials in CLAUDE.md / AGENTS.md, memory, skills, or settings
- **Prompt-injection surfaces** — hooks/skills that pass user input to shell unsafely
- **Rule conflicts** — your agent contract says one thing but a hook/skill does another (e.g., "never force-push" but a hook runs \`git push --force\`)

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
    const nudge = firstRunNudge('security');
    if (nudge) return nudge;
    try {
      const report = await runSecurity({ projectRoot, scope });
      const text = formatSecurityReport(report);
      return { content: [{ type: 'text', text: attachDashboardLink(text, (report as any)._agentRunId, report) }] };
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
      // persist:false — wrapped reuses analyze's data but shouldn't log a
      // duplicate "analyze" run in the user's history. We'll log our own
      // "wrapped" run below once we have the rendered text.
      const report = runAnalysis(root, { scope: scope || 'global', persist: false });

      if (format === 'json') {
        return {
          content: [{ type: 'text', text: formatWrappedJson(report) }],
        };
      }

      // Log a wrapped run in its own right so it shows up in history with
      // the correct tool name and rendered body (not as a duplicate analyze).
      const wrappedText = formatWrappedText(report);
      let wrappedRunId: string | undefined;
      try {
        wrappedRunId = insertAgentRun({
          toolName: 'wrapped',
          summary: `${report.persona.archetypeName} — ${report.collaborationScore}/100`,
          score: report.collaborationScore,
          status: 'success',
        });
      } catch { /* silent */ }

      return { content: [{ type: 'text', text: attachDashboardLink(wrappedText, wrappedRunId, report) }] };
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

// Tool 6: implement_recommendation — apply one of Dear User's suggestions
server.tool(
  'implement_recommendation',
  `Apply a Dear User recommendation to the user's setup — automatically if safe, or by returning the exact command/instruction for the agent to run.

Call this after asking the user (via AskUserQuestion) which of the top recommendations from the latest analyze/audit/security report they want to implement. The recommendation_id comes from the menu we surface in the report's "Hvad vil du gøre?" section.

Behavior by action_type:
- **claude_md_append** — appends the markdown rule to ~/.claude/CLAUDE.md (with timestamped backup). Idempotent.
- **settings_merge** — merges a JSON snippet into ~/.claude/settings.json (with backup, arrays deduped). Idempotent.
- **shell_exec** — returns the shell command for YOU (the agent) to run via the Bash tool. Do NOT paraphrase; run it verbatim.
- **manual** — returns instructions that need human judgment; present them to the user.

After a successful implementation, the recommendation's status is marked "implemented" so Dear User won't suggest it again.

IMPORTANT: Present the ImplementResult back to the user in plain Danish — confirm what changed, show any backup paths, and if there's a \`command\` field, run it via Bash and report the result. If \`ok:false\`, tell the user why and suggest they try again or do it manually.`,
  {
    recommendation_id: z.string().describe('The id of the recommendation to implement — surfaced in the action menu of the latest report.'),
  },
  async ({ recommendation_id }) => {
    try {
      const rec = getRecommendationById(recommendation_id);
      if (!rec) {
        return { content: [{ type: 'text', text: `Anbefaling med id ${recommendation_id} blev ikke fundet. Prøv at køre /dearuser-collab igen.` }], isError: true };
      }
      if (rec.status === 'implemented') {
        return { content: [{ type: 'text', text: `"${rec.title}" er allerede implementeret (${new Date(rec.checked_at || rec.given_at).toLocaleDateString('da-DK')}).` }] };
      }

      const actionType = rec.action_type as string | null;
      const actionData = rec.action_data as string | null;

      let result;
      if (actionType === 'claude_md_append' && actionData) {
        result = implementClaudeMdAppend(actionData);
      } else if (actionType === 'settings_merge' && actionData) {
        result = implementSettingsMerge(actionData);
      } else if (actionType === 'shell_exec' && actionData) {
        result = prepareShellExec(actionData);
      } else if (actionType === 'manual' || !actionType) {
        result = prepareManual(actionData || rec.text_snippet || 'Ingen instruktioner gemt.');
      } else {
        result = { ok: false, summary: `Ukendt action-type: ${actionType}` };
      }

      if (result.ok && !result.command && !result.instructions) {
        // Actual implementation succeeded — mark it done.
        try { updateRecommendationStatus(recommendation_id, 'implemented'); } catch { /* non-fatal */ }
      }

      // Format a clean message back to the agent/user.
      const lines: string[] = [`**${rec.title}**`, '', result.summary];
      if (result.command) {
        lines.push('', '```bash', result.command, '```', '', '_Kør denne kommando via Bash — jeg kan ikke gøre det selv fra MCP-serveren._');
      }
      if (result.instructions) {
        lines.push('', result.instructions);
      }
      if (result.backups && result.backups.length > 0) {
        lines.push('', `_Backup: \`${result.backups[0]}\` — hvis noget går galt kan du kopiere den tilbage._`);
      }
      if (!result.ok && result.error) {
        lines.push('', `Fejl: ${result.error}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }], isError: !result.ok };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Implementer fejlede: ${msg}` }], isError: true };
    }
  }
);

// Tool 7: dismiss_recommendation — user doesn't want this suggestion
server.tool(
  'dismiss_recommendation',
  `Mark a Dear User recommendation as dismissed so it won't be suggested again. Call this when the user picks "drop"/"ikke for mig"/"skip" for a specific recommendation from the action menu.

Use recommendation_id from the latest report's menu. For security/health findings, the dismissal propagates to the underlying finding in the ledger so future scans won't re-surface it (unless dismiss_expires_at elapses).`,
  {
    recommendation_id: z.string().describe('The id of the recommendation to dismiss.'),
    reason: z.enum(['false_positive', 'wont_fix', 'accepted_risk', 'used_in_tests']).optional().describe('Why this is dismissed. Required for ledger-linked recs (security/health findings). Defaults to wont_fix for collab recs.'),
    comment: z.string().optional().describe('Free-text context for the audit trail.'),
    expires_in_days: z.number().int().positive().optional().describe('If set, the dismissal auto-expires after N days and the finding returns to open. Useful for accepted_risk with a review window.'),
  },
  async ({ recommendation_id, reason, comment, expires_in_days }) => {
    try {
      const rec = getRecommendationById(recommendation_id);
      if (!rec) {
        return { content: [{ type: 'text', text: `Anbefaling med id ${recommendation_id} blev ikke fundet.` }], isError: true };
      }
      updateRecommendationStatus(recommendation_id, 'dismissed');
      // Propagate to ledger if this rec is finding-linked — otherwise a
      // future scan would just re-insert it.
      if (rec.finding_hash) {
        const { dismissFinding } = await import('./engine/findings-ledger.js');
        const expiresAt = expires_in_days
          ? Date.now() + expires_in_days * 24 * 60 * 60 * 1000
          : null;
        dismissFinding(
          rec.finding_hash,
          reason ?? 'wont_fix',
          comment ?? null,
          expiresAt,
          null,
        );
      }
      return { content: [{ type: 'text', text: `OK — "${rec.title}" er nu droppet. Jeg foreslår den ikke igen.` }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Kunne ikke droppe anbefalingen: ${msg}` }], isError: true };
    }
  }
);

// Tool: feedback — send a note to the Dear User founders
server.tool(
  'feedback',
  `Send a short note to the Dear User team — a bug, a request, a "this score feels wrong", or anything you want the founder to read. Zero friction: one tool call and you're done.

Behavior:
- POSTs your message to the Dear User feedback inbox (Supabase) over HTTPS.
- Respects Dear User's local-first guarantee — this is the one place data leaves the machine.
- Email is only attached when opt_in_followup=true AND an email is provided.
- No retries — if the network fails, you get a clear message and the payload is logged locally.
- For public questions/ideas, point to GitHub Discussions: https://github.com/bleedmode/dearuser/discussions

What this tool does NOT do:
- Does NOT send anything automatically — the agent must have called this tool with an explicit message from the user.
- Does NOT read past feedback — it is write-only from this side. The founder reads the inbox directly in Supabase.
- Does NOT upload anything about your setup, files, or reports. Only what you put in the message.

Context options: "collab" | "security" | "health" | "wrapped" | "general" — pick the tool the user just ran so the founder can slice the inbox.

Length guidance: keep the confirmation you show the user short. If the user typed a one-liner, the reply can be one line.

Example prompts that should trigger this tool:
- "This score feels wrong — send feedback: the collab score is too low for a brand new project"
- "Send feedback to Dear User: loving it, but the health findings could be shorter"
- "Tell them I want Windows support"
- "Send a bug report: health tool crashed on me"`,
  {
    message: z.string().min(1).max(4000).describe('The feedback text itself — 1 to 4000 characters, plain language. Whatever the user said; do not rewrite or summarise.'),
    context: z.enum(['collab', 'security', 'health', 'wrapped', 'general']).optional().describe('Which surface the user just came from. Use the tool they last ran; fall back to "general" when unclear.'),
    rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional().describe('Optional 1–5 rating. Only include when the user actually stated a number — do not infer from text.'),
    opt_in_followup: z.boolean().optional().describe('Set true only when the user explicitly said they want a reply. Default false.'),
    email: z.string().optional().describe('Email for follow-up. Ignored unless opt_in_followup=true AND the string contains an @.'),
    format: z.enum(['text', 'json']).optional().describe('"text" (default): friendly Danish confirmation. "json": raw result payload for programmatic consumers.'),
  },
  async ({ message, context, rating, opt_in_followup, email, format }) => {
    try {
      const result = await sendFeedback({
        message,
        context,
        rating,
        opt_in_followup,
        email,
      });
      const text = formatFeedbackResult(result, format ?? 'text');
      return { content: [{ type: 'text', text }], isError: !result.ok };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Feedback failed: ${msg}. Your message was not sent — please try again in a moment.` }],
        isError: true,
      };
    }
  }
);

// Tool 8: help — discovery/capabilities menu
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
      `## Tools`,
      ``,
      `**\`collab\`** — Collaboration report`,
      `   Scans your agent contract (CLAUDE.md or AGENTS.md), memory, hooks, skills, sessions. Detects your persona, scores collaboration,`,
      `   surfaces friction, and recommends concrete fixes.`,
      `   → *"Analyze my collaboration with Claude"*`,
      ``,
      `**\`health\`** — System coherence check`,
      `   Finds structural problems: orphan scheduled jobs, dead hooks, unregistered MCP references,`,
      `   unbacked-up substrate. Complement to collab (architecture vs. language).`,
      `   → *"Check my system's health"*`,
      ``,
      `**\`security\`** — Secret & injection scan`,
      `   Looks for leaked API keys/tokens in CLAUDE.md / AGENTS.md, memory, skills, settings.`,
      `   Finds prompt-injection surfaces and unsafe hooks.`,
      `   → *"Scan my Claude setup for security issues"*`,
      ``,
      `**\`history\`** — Past reports without re-running`,
      `   Latest summary per area, score trend over time, or regression (what changed since last run).`,
      `   → *"Vis seneste rapport"* · *"Er sikkerheden blevet bedre?"* · *"What changed?"*`,
      ``,
      `**\`onboard\`** — Guided setup (for new users)`,
      `   Conversational walkthrough: role → goals → stack → pains → substrate → plan.`,
      `   Outputs a tailored CLAUDE.md (or AGENTS.md) template + skill/hook recommendations.`,
      `   → *"Onboard me to Dear User"*`,
      ``,
      `**\`wrapped\`** — Shareable stats (Spotify Wrapped style)`,
      `   Your archetype, autonomy split, system size, top lesson — fun and shareable.`,
      `   → *"Give me my Dear User Wrapped"*`,
      ``,
      `## First time?`,
      `Start with \`onboard\` (tailors Dear User to your setup) or \`collab\` (deep dive on current state).`,
      ``,
      `## Regular use`,
      `\`collab\` for depth · \`history\` to re-read past reports · \`health\` + \`security\` periodically · \`wrapped\` for sharing.`,
      ``,
      `v${PKG_VERSION} · Learn more: dearuser.ai`,
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// Tool 9: share_report — upload an anonymized Wrapped card and get a public URL.
// Pre-launch: restricted to report_type='wrapped' only. Collab/health/security
// reports contain findings text that may carry business context (project names,
// client names, internal architecture) — risk of non-technical users sharing
// sensitive content is too high for a feature they can't audit. Wrapped is
// pure aggregated stats (scores, counts, persona) with much lower leak surface.
server.tool(
  'share_report',
  `Generate a public shareable link for your Dear User Wrapped card. Uploads an anonymized copy to dearuser.ai and returns a URL you can paste anywhere (X, LinkedIn, Slack).

Only Wrapped reports are shareable. Collab/health/security reports stay local.

Privacy contract:
- Absolute filesystem paths are collapsed to basenames.
- Email addresses are stripped.
- Anything matching our secret-scanner patterns (API keys, tokens, JWTs, private keys) is redacted before upload.
- The user's local ~/.dearuser/ database is NOT modified.

Requires DEARUSER_SUPABASE_URL + DEARUSER_SUPABASE_SERVICE_KEY in the environment. Without them, this tool errors out and nothing uploads — the rest of Dear User keeps working locally.

IMPORTANT — Presenting results:
Show the returned URL prominently and tell the user it's public. Do NOT auto-paste it anywhere on their behalf.

Example prompts that should trigger this tool:
- "Share my Wrapped"
- "Lav et delbart link til min Wrapped"`,
  {
    report_type: z.enum(['wrapped']).describe('Only "wrapped" is accepted. Collab/health/security sharing is disabled pre-launch to avoid leaking business context.'),
    report_json: z.record(z.unknown()).describe('The full structured Wrapped report object.'),
    expires_at: z.string().optional().describe('ISO-8601 timestamp after which the link stops working. Omit for a permanent link.'),
  },
  async ({ report_type, report_json, expires_at }) => {
    try {
      const result = await runShareReport({ report_type, report_json, expires_at });
      const lines = [
        `💌 **Dit delbare link er klar:** ${result.url}`,
        ``,
        `Linket er offentligt — hvem som helst med URL'en kan se rapporten. Følsomme data (filstier, emails, API-nøgler) er strippet inden upload.`,
        ``,
        `_Token: \`${result.token}\`_`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Share failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

/**
 * Probe 7700..7709 for an existing Dear User dashboard. Returns the URL of
 * the first responder, or null if none. Used both to reuse a dashboard
 * another session/daemon started, and to confirm our detached spawn came up.
 */
async function findRunningDashboard(maxAttempts = 10): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = 7700 + i;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (!res.ok) continue;
      const data = await res.json() as any;
      if (data?.product === 'dearuser') return `http://localhost:${port}`;
    } catch { /* port empty or not us */ }
  }
  return null;
}

/**
 * Spawn the dashboard as a detached child process that survives the MCP
 * exit. Output is redirected to a log file in ~/.dearuser/. Returns the
 * URL once the child responds to /health, or null on failure.
 */
async function spawnDetachedDashboard(): Promise<string | null> {
  const dashboardScript = join(__dirname, 'dashboard-standalone.js');
  if (!existsSync(dashboardScript)) {
    console.error(`[mcp] dashboard-standalone.js not found at ${dashboardScript}`);
    return null;
  }

  // Make sure the log directory exists and open the log file once.
  const logDir = join(homedir(), '.dearuser');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, 'dashboard.log');

  try {
    const out = openSync(logPath, 'a');
    const err = openSync(logPath, 'a');
    const child = spawn(process.execPath, [dashboardScript], {
      detached: true,
      stdio: ['ignore', out, err],
      env: process.env,
    });
    child.unref();
  } catch (err) {
    console.error('[mcp] could not spawn dashboard:', err instanceof Error ? err.message : err);
    return null;
  }

  // Wait up to 5 seconds for the child to bind a port and start responding.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    const url = await findRunningDashboard();
    if (url) return url;
  }
  return null;
}

// Start the server
async function main() {
  // Dashboard lifecycle: find-or-spawn a long-lived dashboard process that
  // outlives this MCP session. That way the user can click a share URL from
  // a week-old report and still reach it — even if the Claude Code session
  // that generated the URL has long since closed.
  try {
    // Step 1: Is a dashboard already running? (Could be a previous session's
    // detached spawn, a user-launched `node dist/dashboard-standalone.js`,
    // or a launchd/systemd unit.)
    DASHBOARD_URL = await findRunningDashboard();

    // Step 2: None running — spawn one ourselves, detached, so it survives us.
    if (!DASHBOARD_URL) {
      DASHBOARD_URL = await spawnDetachedDashboard();
    }
  } catch (err) {
    console.error('Dashboard setup skipped:', err instanceof Error ? err.message : err);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Dear User MCP server running');
  if (DASHBOARD_URL) console.error(`Dashboard: ${DASHBOARD_URL}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
