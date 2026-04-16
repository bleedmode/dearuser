// onboard — conversational setup dialog.
//
// MCP is stateless, so conversation state rides as a base64-encoded JSON blob
// passed between calls. The agent (Claude) presents each returned question to
// the user, collects the answer, and calls this tool again with the step name,
// the answer, and the same state blob.
//
// Flow (v2): intro → goals → stack-pains → substrate → plan (5 steps)
// Backwards compat: old step names (role, stack, pains) still accepted.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifySubstrate, substrateLabel } from '../engine/substrate-advisor.js';
import type { Substrate } from '../engine/substrate-advisor.js';
import { scan } from '../engine/scanner.js';
import { getSetupTemplate, renderPlan, renderClaudeMdPreview } from '../templates/setup-templates.js';
import type { Role } from '../templates/setup-templates.js';

export type OnboardStep =
  | 'intro'
  | 'role'       // backwards compat
  | 'goals'
  | 'stack'      // backwards compat
  | 'pains'      // backwards compat
  | 'stack-pains'
  | 'substrate'
  | 'plan';

export interface OnboardState {
  version: 1;
  role: Role | null;
  goals: string | null;
  stack: string[];
  pains: string | null;
  substrateDescription: string | null;
  decidedSubstrate: Substrate | null;
  answers: Record<string, string>;
  /** Detected existing setup (populated on first call). */
  existingSetup?: {
    hasClaudeMd: boolean;
    hasMemory: boolean;
    skillCount: number;
    hookCount: number;
    summary: string;
  } | null;
}

export interface OnboardResult {
  /** Current step — the one whose question is being returned. */
  step: OnboardStep;
  /** Optional teaching content to show BEFORE the question. */
  teaching: string | null;
  /** The question to present to the user. */
  question: string;
  /** Multiple-choice options, if applicable. Free-text answer when empty. */
  options: string[];
  /** Hint for the next step — the agent should pass this as `step` in the next call. */
  nextStep: OnboardStep | null;
  /** Opaque blob — pass back unchanged on the next call. */
  state: string;
  /** When true, `plan` contains the final setup plan and no more calls are needed. */
  done: boolean;
  /** Final plan markdown (only populated when done=true). */
  plan: string | null;
}

// ============================================================================
// State codec
// ============================================================================

function freshState(): OnboardState {
  return {
    version: 1,
    role: null,
    goals: null,
    stack: [],
    pains: null,
    substrateDescription: null,
    decidedSubstrate: null,
    answers: {},
  };
}

function encodeState(state: OnboardState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function decodeState(blob: string | undefined): OnboardState {
  if (!blob) return freshState();
  try {
    const parsed = JSON.parse(Buffer.from(blob, 'base64').toString('utf-8'));
    if (parsed && parsed.version === 1) return parsed;
  } catch { /* fall through */ }
  return freshState();
}

// ============================================================================
// Answer parsing
// ============================================================================

/**
 * Parse a role answer. Order matters: check "don't code" signals BEFORE
 * "manage" (a non-coder CEO often says "I manage people/projects"; that
 * shouldn't override the explicit non-coder claim).
 */
function parseRole(answer: string): Role {
  const a = answer.toLowerCase();

  // Strong non-coder signals first
  if (/don'?t code|do not code|non.?coder|never code|no code|not a (?:coder|developer|programmer|engineer)/.test(a)) return 'non_coder';
  if (/\b(lawyer|ceo|cfo|coo|executive|founder|investor|doctor|accountant|designer)\b/.test(a) && !/i\s+(?:also\s+)?(?:write|code|develop)/.test(a)) return 'non_coder';

  // Strong coder signals
  if (/i\s+(?:write|ship|build|deploy)\s+code|coder|developer|engineer|programm/.test(a)) return 'coder';

  // Occasional — explicitly sometimes-code / mixed
  if (/occasional|sometimes code|manage (?:people|engineers|devs)|product manager|tech lead|cto|staff/.test(a)) return 'occasional';

  // Fall-back: mentions "code" positively → coder; mentions "help me" with no code signal → non-coder;
  // otherwise split-role → occasional
  if (/\bcode\b/.test(a)) return 'occasional';
  if (/help me|assist me|work with|my work/.test(a)) return 'non_coder';
  return 'occasional';
}

/** Parse stack inventory — free text. */
function parseStack(answer: string): string[] {
  const a = answer.toLowerCase();
  const known = [
    'chatgpt', 'claude', 'claude code', 'cursor', 'windsurf', 'aider',
    'copilot', 'gemini', 'mcp', 'openclaw', 'continue', 'zed',
  ];
  return known.filter(tool => a.includes(tool));
}

// ============================================================================
// Step handlers — each takes (state, answer) and returns an OnboardResult
// ============================================================================

/**
 * Step 1 (merged intro+role): Project scan + role question.
 * First call (no answer): scan project, show welcome + role question.
 * Second call (with answer): parse role, advance to goals.
 */
function stepIntro(state: OnboardState, answer: string): OnboardResult {
  // First call — no answer yet, show welcome + role question
  if (!answer) {
    // Project scan — detect what's already configured
    try {
      const scanResult = scan(process.cwd(), 'global');
      const hasClaudeMd = scanResult.globalClaudeMd !== null || scanResult.projectClaudeMd !== null;
      const hasMemory = scanResult.memoryFiles.length > 0;
      const skillCount = scanResult.skillsCount ?? 0;
      const hookCount = scanResult.hooksCount ?? 0;
      const parts: string[] = [];
      if (hasClaudeMd) parts.push('a CLAUDE.md');
      if (hasMemory) parts.push(`${scanResult.memoryFiles.length} memory file(s)`);
      if (skillCount > 0) parts.push(`${skillCount} skill(s)`);
      if (hookCount > 0) parts.push(`${hookCount} hook(s)`);
      state.existingSetup = {
        hasClaudeMd,
        hasMemory,
        skillCount,
        hookCount,
        summary: parts.length > 0 ? `I can see you already have ${parts.join(', ')} configured.` : '',
      };
    } catch {
      state.existingSetup = null;
    }

    const setupLine = state.existingSetup?.summary
      ? `\n\n${state.existingSetup.summary} I\'ll build on what you have.\n`
      : '\n';

    return {
      step: 'intro',
      teaching: `Welcome — I'll spend about 3 minutes learning about you, then produce a tailored setup plan.${setupLine}\nAnswer in your own words; there are no wrong answers.`,
      question: 'Which best describes you?',
      options: [
        'I write code regularly',
        'I code occasionally, or manage people who do',
        'I don\'t code but I want to use AI seriously',
      ],
      nextStep: 'goals',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }

  // Second call — parse role, show teaching, advance to goals
  const role = parseRole(answer);
  state.role = role;
  state.answers.role = answer;

  const teaching = (() => {
    switch (role) {
      case 'coder':
        return 'There are four ways AI shows up in code work:\n\n- **Chat**: one-off questions, pair-thinking\n- **Code agents**: Claude Code / Cursor / etc. — an editor that can edit\n- **Schedule**: recurring jobs (nightly research, daily standups, alerts)\n- **OS-level**: your own stack with memory, skills, hooks\n\nA coder typically starts with code agents + gradually adds schedule and OS when friction builds.';
      case 'occasional':
        return 'Four ways AI can help product/mixed roles:\n\n- **Chat**: quick research, summarising, email drafting\n- **Code agents**: for the times you do edit code or configs\n- **Schedule**: daily briefings, weekly summaries, monitoring\n- **OS-level**: tying it together so nothing gets forgotten\n\nThe highest-leverage move is usually the OS-level piece — having memory and standing context so you don\'t re-explain yourself.';
      case 'non_coder':
        return 'Four ways to put AI to work without coding:\n\n- **Chat**: the default experience — ChatGPT, Claude.ai — quick tasks\n- **Workflows**: Zapier, Make, or Claude-as-assistant for repeat tasks\n- **Schedule**: daily/weekly reports delivered to you\n- **Documents**: AI that reads your Notion, Google Drive, emails\n\nYou want to think less about tools and more about *jobs to be done*. What should AI do that you currently do manually, badly, or not at all?';
    }
  })();

  return {
    step: 'intro',
    teaching,
    question: 'What\'s the single most important thing you want AI to help you with?',
    options: [],
    nextStep: 'goals',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepGoals(state: OnboardState, answer: string): OnboardResult {
  // Handle skip option
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.goals = null;
    state.answers.goals = '(skipped)';
    // Jump directly to plan with defaults
    return stepPlan(state, 'skip');
  }

  state.goals = answer.trim();
  state.answers.goals = answer;

  // Show CLAUDE.md preview based on role + goals
  const preview = state.role ? renderClaudeMdPreview(state.role, state.goals) : null;

  return {
    step: 'goals',
    teaching: preview ? `### Preview of your CLAUDE.md so far\n\n\`\`\`markdown\n${preview}\n\`\`\`` : null,
    question: 'Two quick things:\n\n1. Which AI tools do you already use? (list them, or say "none")\n2. What\'s most frustrating about working with AI today?',
    options: [
      'Skip — just give me a template based on my role',
    ],
    nextStep: 'stack-pains',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/** Combined stack + pains step — asks both in one question. */
function stepStackPains(state: OnboardState, answer: string): OnboardResult {
  // Handle skip
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers['stack-pains'] = '(skipped)';
    return stepPlan(state, 'skip');
  }

  // Parse stack from the full answer (keyword matching)
  state.stack = parseStack(answer);
  // Store the full answer as pains (overlap with stack detection is fine)
  state.pains = answer.trim();
  state.answers['stack-pains'] = answer;

  return {
    step: 'stack-pains',
    teaching: 'Four places your data can live — picking the right one prevents pain later:\n\n- **Rules** (CLAUDE.md): how the agent should behave, read every session\n- **Memory** (memory files): lessons, feedback, narrative learnings\n- **Documents** (Notion, Google Docs): formatted content humans also read\n- **Database** (SQLite, Supabase): structured lists that grow and get queried\n\nPicking "markdown" for everything is the most common mistake — it works at 5 entries, collapses at 50.',
    question: 'What data are you accumulating (or want to) that the agent should help with? Describe it in your own words — what does each entry look like, how fast does it grow, who reads it?',
    options: [],
    nextStep: 'substrate',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepSubstrate(state: OnboardState, answer: string): OnboardResult {
  state.substrateDescription = answer.trim();
  state.answers.substrate = answer;

  const recommendation = classifySubstrate(state.substrateDescription);
  state.decidedSubstrate = recommendation.primary;

  const confidenceLabel = recommendation.confidence === 'high'
    ? 'Strong match'
    : recommendation.confidence === 'medium'
      ? 'Good fit'
      : 'Best guess — consider the secondary option too';

  const teaching = [
    `**Recommended substrate:** ${substrateLabel(recommendation.primary)}`,
    ``,
    `**${confidenceLabel}.** ${recommendation.why}`,
    ``,
    `**Example for your case:**`,
    recommendation.example,
    ``,
    `**What to avoid:** ${recommendation.antiPattern}`,
    ``,
    `**How to apply:**`,
    ...recommendation.stepsToApply.map((s, i) => `${i + 1}. ${s}`),
  ].join('\n');

  return {
    step: 'substrate',
    teaching,
    question: 'Ready for your tailored setup plan? (yes/no — or tell me what to adjust first)',
    options: ['Yes, show the plan', 'Let me reconsider the substrate'],
    nextStep: 'plan',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepPlan(state: OnboardState, _answer: string): OnboardResult {
  const role = state.role || 'occasional';
  const template = getSetupTemplate(role);

  const substrateSummary = state.decidedSubstrate
    ? substrateLabel(state.decidedSubstrate)
    : null;

  const plan = renderPlan(template, {
    goals: state.goals,
    pains: state.pains,
    substrateSummary,
  });

  // Write a Dear User config template so the security tool can find projects
  // and know where to look for tokens. Non-destructive: never overwrites an
  // existing config.
  const configStatus = writeConfigTemplate();
  const fullPlan = configStatus ? `${plan}\n\n---\n\n${configStatus}` : plan;

  return {
    step: 'plan',
    teaching: null,
    question: 'Your plan is ready. Work through the 3 next-steps in order — small changes compound.',
    options: [],
    nextStep: null,
    state: encodeState(state),
    done: true,
    plan: fullPlan,
  };
}

/**
 * Write a starter ~/.dearuser/config.json if one doesn't already exist.
 * Auto-detects which platforms are in the user's stack so the template
 * contains the right placeholders. Returns a human-readable status string
 * to append to the plan, or null if we skipped silently.
 */
function writeConfigTemplate(): string | null {
  const configDir = path.join(os.homedir(), '.dearuser');
  const configPath = path.join(configDir, 'config.json');

  // Non-destructive: respect existing config
  if (fs.existsSync(configPath)) {
    return `## Dear User config\n\nExisting config found at \`~/.dearuser/config.json\` — left untouched.`;
  }

  // Figure out sensible default search roots — only include ones that exist
  const candidates = ['clawd', 'code', 'projects', 'work', 'src'];
  const searchRoots: string[] = [];
  for (const name of candidates) {
    const p = path.join(os.homedir(), name);
    try {
      if (fs.statSync(p).isDirectory()) searchRoots.push(`~/${name}`);
    } catch { /* skip */ }
  }

  // Detect which platforms are present so we only scaffold relevant token slots
  const detected = detectPlatforms(searchRoots.map(r => r.replace(/^~/, os.homedir())));
  const tokens: Record<string, string> = {};
  if (detected.has('supabase')) tokens.supabase = '';
  if (detected.has('vercel')) tokens.vercel = '';

  const config = {
    searchRoots: searchRoots.length > 0 ? searchRoots : [`~/`],
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
  };

  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return `## Dear User config\n\nCouldn't write \`~/.dearuser/config.json\`: ${err instanceof Error ? err.message : err}. Create it manually if you want custom search roots or tokens.`;
  }

  const lines = [
    `## Dear User config written`,
    ``,
    `Created \`~/.dearuser/config.json\` with these defaults:`,
    ``,
    '```json',
    JSON.stringify(config, null, 2),
    '```',
    ``,
    `**Search roots** — Dear User scans these folders for projects (Supabase .env files, GitHub repos, etc.). Edit to match where your code lives.`,
  ];

  if (detected.has('supabase')) {
    lines.push(
      ``,
      `**Supabase token** — fill in \`tokens.supabase\` to enable the Advisor API scan. Get one at https://supabase.com/dashboard/account/tokens (alternatively set the \`SUPABASE_ACCESS_TOKEN\` env var).`,
    );
  }
  if (detected.has('vercel')) {
    lines.push(
      ``,
      `**Vercel token** — fill in \`tokens.vercel\` to audit env vars. Get one at https://vercel.com/account/tokens (or set \`VERCEL_TOKEN\`).`,
    );
  }
  if (detected.has('github')) {
    lines.push(
      ``,
      `**GitHub** — no config needed, uses \`gh\` CLI. Run \`gh auth login\` if you haven't already.`,
    );
  }

  return lines.join('\n');
}

/** Inspect search roots and return the set of platforms detected (by file signatures). */
function detectPlatforms(searchRoots: string[]): Set<string> {
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 3 || found.size === 3) return; // stop early once all 3 detected
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) {
        if ((entry.name === '.env' || entry.name === '.env.local' || entry.name === '.env.production') && !found.has('supabase')) {
          try {
            if (/SUPABASE_URL\s*=/i.test(fs.readFileSync(full, 'utf-8'))) found.add('supabase');
          } catch { /* skip */ }
        }
      } else if (entry.isDirectory()) {
        if (entry.name === '.git' && !found.has('github')) {
          try {
            const cfg = fs.readFileSync(path.join(full, 'config'), 'utf-8');
            if (/github\.com/.test(cfg)) found.add('github');
          } catch { /* skip */ }
        }
        if (entry.name === '.vercel') found.add('vercel');
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
          walk(full, depth + 1);
        }
      }
    }
  }

  for (const root of searchRoots) walk(root, 0);
  return found;
}

// ============================================================================
// Dispatcher
// ============================================================================

export interface OnboardInput {
  step?: string;
  answer?: string;
  state?: string;
}

export function runOnboard(input: OnboardInput): OnboardResult {
  const currentStep = (input.step || 'intro') as OnboardStep;
  const state = decodeState(input.state);
  const answer = input.answer || '';

  switch (currentStep) {
    case 'intro':      return stepIntro(state, answer);
    case 'role':       return stepIntro(state, answer);   // backwards compat: old role → intro with answer
    case 'goals':      return stepGoals(state, answer);
    case 'stack':      return stepStackPains(state, answer); // backwards compat
    case 'pains':      return stepStackPains(state, answer); // backwards compat
    case 'stack-pains': return stepStackPains(state, answer);
    case 'substrate':  return stepSubstrate(state, answer);
    case 'plan':       return stepPlan(state, answer);
    default:
      // Unknown step — reset to intro
      return stepIntro(freshState(), '');
  }
}

function stepNumber(step: OnboardStep): number {
  const map: Record<string, number> = { intro: 1, role: 1, goals: 2, stack: 3, pains: 3, 'stack-pains': 3, substrate: 4, plan: 5 };
  return map[step] || 1;
}

/** Format an OnboardResult as markdown for the MCP client. */
export function formatOnboardResult(result: OnboardResult): string {
  const lines: string[] = [];

  if (result.done && result.plan) {
    return result.plan;
  }

  lines.push(`*Onboard — step ${stepNumber(result.step)} of 5${result.nextStep ? ` → ${result.nextStep}` : ''}*`);
  lines.push('');

  if (result.teaching) {
    lines.push(result.teaching);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`**Q: ${result.question}**`);

  if (result.options.length > 0) {
    lines.push('');
    for (let i = 0; i < result.options.length; i++) {
      lines.push(`${i + 1}. ${result.options[i]}`);
    }
    lines.push('');
    lines.push('*(Or answer freely — whichever is more natural.)*');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Agent: present the question above. When the user answers, call `mcp__dearuser__onboard` again with:*');
  lines.push(`- \`step\`: \`"${result.nextStep}"\``);
  lines.push('- `answer`: the user\'s answer');
  lines.push(`- \`state\`: \`"${result.state}"\` (this exact string — do not modify)`);

  return lines.join('\n');
}
