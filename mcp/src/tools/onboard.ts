// onboard — conversational setup dialog.
//
// MCP is stateless, so conversation state rides as a base64-encoded JSON blob
// passed between calls. The agent (Claude) presents each returned question to
// the user, collects the answer, and calls this tool again with the step name,
// the answer, and the same state blob.
//
// Flow: intro → role → goals → stack → pains → substrate → plan (done)

import { classifySubstrate, substrateLabel } from '../engine/substrate-advisor.js';
import type { Substrate } from '../engine/substrate-advisor.js';
import { getSetupTemplate, renderPlan } from '../templates/setup-templates.js';
import type { Role } from '../templates/setup-templates.js';

export type OnboardStep =
  | 'intro'
  | 'role'
  | 'goals'
  | 'stack'
  | 'pains'
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

function stepIntro(state: OnboardState): OnboardResult {
  return {
    step: 'intro',
    teaching: 'Welcome — I\'ll spend about 5 minutes learning about you, then produce a setup plan tailored to how you actually work. Answer in your own words; there are no wrong answers.',
    question: 'Which best describes you?',
    options: [
      'I write code regularly',
      'I code occasionally, or manage people who do',
      'I don\'t code but I want to use AI seriously',
    ],
    nextStep: 'role',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepRole(state: OnboardState, answer: string): OnboardResult {
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
    step: 'role',
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
  state.goals = answer.trim();
  state.answers.goals = answer;

  return {
    step: 'goals',
    teaching: null,
    question: 'Which tools do you already use regularly? (free text — list whatever\'s in your stack, or say "none")',
    options: [],
    nextStep: 'stack',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepStack(state: OnboardState, answer: string): OnboardResult {
  state.stack = parseStack(answer);
  state.answers.stack = answer;

  return {
    step: 'stack',
    teaching: null,
    question: 'What\'s most frustrating about working with AI today? (one or two sentences)',
    options: [],
    nextStep: 'pains',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

function stepPains(state: OnboardState, answer: string): OnboardResult {
  state.pains = answer.trim();
  state.answers.pains = answer;

  return {
    step: 'pains',
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

  return {
    step: 'plan',
    teaching: null,
    question: 'Your plan is ready. Work through the 3 next-steps in order — small changes compound.',
    options: [],
    nextStep: null,
    state: encodeState(state),
    done: true,
    plan,
  };
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
    case 'intro':   return stepIntro(state);
    case 'role':    return stepRole(state, answer);
    case 'goals':   return stepGoals(state, answer);
    case 'stack':   return stepStack(state, answer);
    case 'pains':   return stepPains(state, answer);
    case 'substrate': return stepSubstrate(state, answer);
    case 'plan':    return stepPlan(state, answer);
    default:
      // Unknown step — reset to intro
      return stepIntro(freshState());
  }
}

/** Format an OnboardResult as markdown for the MCP client. */
export function formatOnboardResult(result: OnboardResult): string {
  const lines: string[] = [];

  if (result.done && result.plan) {
    return result.plan;
  }

  lines.push(`*Onboard — step: ${result.step}${result.nextStep ? ` → ${result.nextStep}` : ''}*`);
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
