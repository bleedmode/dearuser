// onboard — conversational setup dialog.
//
// MCP is stateless, so conversation state rides as a base64-encoded JSON blob
// passed between calls. The agent (Claude) presents each returned question to
// the user, collects the answer, and calls this tool again with the step name,
// the answer, and the same state blob.
//
// Flow (v3 — Lovable-friendly, not developer-jargon):
//   intro → work → data → cadence → plan
//
// Audience: people who work with data (Excel, Sheets, Notion, Airtable) and
// want AI to do their repetitive tasks smarter — NOT developers configuring
// CLAUDE.md by hand. We parse role/stack/substrate in the background; the
// user never sees those words.
//
// Backwards compat: old step names (role, goals, stack, pains, stack-pains,
// substrate) are still accepted and routed to the closest v3 step so older
// clients and saved state blobs keep working.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { classifySubstrate, substrateLabel } from '../engine/substrate-advisor.js';
import type { Substrate } from '../engine/substrate-advisor.js';
import { scan } from '../engine/scanner.js';
import { getSetupTemplate, renderPlan } from '../templates/setup-templates.js';
import type { Role } from '../templates/setup-templates.js';
import type { LocalizedString } from '../engine/friendly-labels.js';
import {
  installDearUserSkills,
  registerDearUserInClaudeMd,
  installProtectedFilesHook,
  ensureToolSearchAuto,
  detectPlatformStatus,
  buildScheduledTaskPrompt,
} from '../engine/onboard-install.js';
import type { InstallStep, PlatformStatus } from '../engine/onboard-install.js';

export type OnboardStep =
  | 'welcome'
  | 'greet'
  | 'intro'
  | 'work'
  | 'data'
  | 'cadence'
  | 'audience'
  | 'plan'
  // Backwards compat — map onto the closest v3 step:
  | 'role'         // → intro
  | 'goals'        // → work
  | 'stack'        // → data
  | 'pains'        // → data
  | 'stack-pains'  // → data
  | 'substrate';   // → cadence

export interface OnboardState {
  version: 1;
  /** Q0 answer — what the user wants us to call them. Used in report letter openings. */
  name: string | null;
  /** Parsed from the Q1 free-text answer — hidden from the user. */
  role: Role | null;
  /** Q1 raw answer — what the user does day-to-day. */
  work: string | null;
  /** Q2 raw answer — what repeats and wastes time. */
  pains: string | null;
  /** AI tools detected from Q2/Q3 text (chatgpt, claude, cursor, ...). */
  stack: string[];
  /** Q3 raw answer — where their data lives today. */
  dataDescription: string | null;
  /** Substrate we chose FOR them based on Q3 — hidden from the user. */
  decidedSubstrate: Substrate | null;
  /** question 4 parts — cadence ('daily'/'weekly'/'on-demand'/'event') + audience. */
  cadence: 'daily' | 'weekly' | 'on-demand' | 'event' | null;
  audience: 'self' | 'team' | 'customers' | null;
  /** Raw history for auditability. */
  answers: Record<string, string>;
  /** Detected existing setup (populated on first call). */
  existingSetup?: {
    hasClaudeMd: boolean;
    hasMemory: boolean;
    skillCount: number;
    hookCount: number;
  } | null;
}

export interface OnboardResult {
  /** Current step — the one whose question is being returned. */
  step: OnboardStep;
  /** Optional teaching content to show BEFORE the question. */
  teaching: LocalizedString | null;
  /**
   * The question to present to the user. Null on pure letter/announcement
   * screens (e.g. `welcome`) where no answer is expected — the UI advances
   * via a "ready" button instead.
   */
  question: LocalizedString | null;
  /** Multiple-choice options, if applicable. Free-text answer when empty. */
  options: LocalizedString[];
  /** Hint for the next step — the agent should pass this as `step` in the next call. */
  nextStep: OnboardStep | null;
  /** Opaque blob — pass back unchanged on the next call. */
  state: string;
  /** When true, `plan` contains the final setup plan and no more calls are needed. */
  done: boolean;
  /** Final plan markdown (only populated when done=true, used by MCP chat). */
  plan: string | null;
  /** Auto-install results — surfaced on the done screen. */
  installSteps?: InstallStep[];
  /** Platforms detected + their connection status. */
  platformStatus?: PlatformStatus[];
  /** Copy-paste prompt for setting up the user's scheduled task. */
  scheduledPrompt?: LocalizedString | null;
}

// ============================================================================
// State codec
// ============================================================================

function freshState(): OnboardState {
  return {
    version: 1,
    name: null,
    role: null,
    work: null,
    pains: null,
    stack: [],
    dataDescription: null,
    decidedSubstrate: null,
    cadence: null,
    audience: null,
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
    if (parsed && parsed.version === 1) {
      // Migrate older state shapes (v2 had `goals` + `substrateDescription`)
      return {
        ...freshState(),
        ...parsed,
        work: parsed.work ?? parsed.goals ?? null,
        dataDescription: parsed.dataDescription ?? parsed.substrateDescription ?? null,
        cadence: parsed.cadence ?? null,
        audience: parsed.audience ?? null,
      };
    }
  } catch { /* fall through */ }
  return freshState();
}

// ============================================================================
// Answer parsing — role, stack, cadence, audience
// ============================================================================

/**
 * Parse a role answer from Q1 free text. We don't ask the user to pick a
 * role — we infer it from what they describe doing. Order matters: check
 * non-coder signals before "manage" (a non-coder CEO often says "I manage
 * people/projects"; that shouldn't override the explicit non-coder claim).
 */
function parseRole(answer: string): Role {
  const a = answer.toLowerCase();

  // Strong non-coder signals first — English and Danish
  if (/don'?t code|do not code|non.?coder|never code|no code|not a (?:coder|developer|programmer|engineer)/.test(a)) return 'non_coder';
  if (/koder ikke|kan ikke kode|programmerer ikke|ikke.*(?:udvikler|programm\u00f8r|coder)|jeg er ikke.*tekn/.test(a)) return 'non_coder';
  if (/\b(lawyer|ceo|cfo|coo|executive|founder|investor|doctor|accountant|designer|consultant|marketer|sales|hr|recruiter|teacher|advokat|direkt\u00f8r|stifter|konsulent|markedsf\u00f8ring|s\u00e6lger|l\u00e6rer|l\u00e6ge|revisor|iv\u00e6rks\u00e6tter|venture studio)\b/.test(a) && !/i\s+(?:also\s+)?(?:write|code|develop)|jeg.*(?:skriver|bygger|koder)\s+kode/.test(a)) return 'non_coder';

  // Strong coder signals
  if (/i\s+(?:write|ship|build|deploy)\s+code|coder|developer|engineer|programm/.test(a)) return 'coder';

  // Occasional — explicitly sometimes-code / mixed
  if (/occasional|sometimes code|manage (?:people|engineers|devs)|product manager|tech lead|cto|staff/.test(a)) return 'occasional';

  // Data-centric work without code mention → non_coder (Lovable segment default)
  if (/excel|sheets?|notion|airtable|spreadsheet|report|data|crm|email|document|customer|client|sales|marketing/.test(a) && !/\bcode\b/.test(a)) return 'non_coder';

  // Fall-back
  if (/\bcode\b/.test(a)) return 'occasional';
  if (/help me|assist me|work with|my work/.test(a)) return 'non_coder';
  return 'occasional';
}

/** Parse AI tool inventory from free text — runs across Q2+Q3 answers. */
function parseStack(answer: string): string[] {
  const a = answer.toLowerCase();
  const known = [
    'chatgpt', 'claude', 'claude code', 'cursor', 'windsurf', 'aider',
    'copilot', 'gemini', 'mcp', 'openclaw', 'continue', 'zed',
    'lovable', 'bolt', 'v0', 'replit',
  ];
  return known.filter(tool => a.includes(tool));
}

/** Parse question 4 cadence answer. */
function parseCadence(answer: string): OnboardState['cadence'] {
  const a = answer.toLowerCase();
  if (/daily|hver morgen|hver dag|every morning|each day|om morgenen/.test(a)) return 'daily';
  if (/weekly|hver uge|every week|om ugen|sunday|monday/.test(a)) return 'weekly';
  if (/when (?:something|it) happens|hver gang|event|trigger|n\u00e5r der sker/.test(a)) return 'event';
  if (/on.?demand|kun n\u00e5r|only when|when i ask|n\u00e5r jeg (?:beder|sp\u00f8rger)/.test(a)) return 'on-demand';
  // Default: on-demand is the safest (no autonomous side effects).
  return 'on-demand';
}

/** Parse question 4 audience answer. */
function parseAudience(answer: string): OnboardState['audience'] {
  const a = answer.toLowerCase();
  if (/customer|kunde|client|user/.test(a)) return 'customers';
  if (/team|colleague|kollega|coworker|boss|chef|manager|department|afdeling/.test(a)) return 'team';
  return 'self';
}

// ============================================================================
// Step handlers
// ============================================================================

/**
 * Parse a name answer. We want the first-name for greetings ("Kære &lt;name&gt;").
 * Strip punctuation, take the first word. Empty/whitespace → null.
 */
function parseName(answer: string): string | null {
  const cleaned = answer.trim().replace(/^(jeg hedder|mit navn er|i['']m|my name is|kald mig|call me)\s+/i, '');
  const first = cleaned.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}-]/gu, '');
  if (!first || first.length > 40) return null;
  // Capitalise if the user typed lowercase
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Step -1 (welcome): pure letter screen — no question, no input. User
 * clicks "Ready" to advance to the first real question. We also run the
 * project scan here silently (earliest we have the user's attention).
 */
function stepWelcome(state: OnboardState, answer: string): OnboardResult {
  // First view: populate scan + show the letter.
  if (!answer) {
    try {
      const scanResult = scan(process.cwd(), 'global');
      state.existingSetup = {
        hasClaudeMd: scanResult.globalClaudeMd !== null || scanResult.projectClaudeMd !== null,
        hasMemory: scanResult.memoryFiles.length > 0,
        skillCount: scanResult.skillsCount ?? 0,
        hookCount: scanResult.hooksCount ?? 0,
      };
    } catch {
      state.existingSetup = null;
    }

    return {
      step: 'welcome',
      teaching: {
        da: `I år kommer du til at bruge flere timer med din agent, end med de fleste mennesker i dit liv.\n\nDear User er bygget til at få mest muligt ud af de timer. Jeg vurderer løbende samarbejdet mellem dig og din agent, på samme måde som HR gør for mennesker.\n\nJeg kommer med anbefalinger til forbedringer i forholdet og holder samtidigt øje med at dit setup ikke går i stykker.\n\nJeg håber du får glæde af Dear User.`,
        en: `This year, you'll spend more hours with your agent than with most people in your life.\n\nDear User is built to make the most of those hours. I look after the collaboration between you and your agent, the same way HR does for people.\n\nI bring recommendations for improvements to the relationship, and quietly check that your setup doesn't break.\n\nI hope you enjoy using Dear User.`,
      },
      question: null, // pure letter — UI renders "Ready" button instead of input
      options: [],
      nextStep: 'greet',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }
  // Any submission (the "Ready" button) advances to the first real question.
  return stepGreet(state, '');
}

/**
 * Step 0 (greet): Ask the user's name so we can open every report with
 * "Kære [name]," instead of "Kære bruger,". The welcome letter is its own
 * screen now, so this step goes straight to the name question.
 *
 * The name is optional: skip / "spring over" / blank → fallback to
 * generic letter openings.
 */
function stepGreet(state: OnboardState, answer: string): OnboardResult {
  // First call — no answer, show Q0
  if (!answer) {
    return {
      step: 'greet',
      teaching: null,
      question: { da: 'Hvad er dit fornavn?', en: 'What\'s your first name?' },
      options: [],
      nextStep: 'greet',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }

  // Second call — parse name (may be null if user skipped), advance to intro
  if (/^(skip|spring over|ingen|nej tak|intet)/i.test(answer.trim())) {
    state.name = null;
  } else {
    state.name = parseName(answer);
  }
  state.answers.greet = answer;

  const addressingDa = state.name ? `Kære ${state.name}` : 'Kære bruger';
  const addressingEn = state.name ? `Dear ${state.name}` : 'Dear user';

  return {
    step: 'greet',
    teaching: {
      da: `${addressingDa}. Så starter vi.`,
      en: `${addressingEn}. Let's begin.`,
    },
    question: {
      da: 'Hvad arbejder du med til daglig?',
      en: 'What do you work with day to day?',
    },
    options: [
      { da: 'Udvikler', en: 'Developer' },
      { da: 'Designer', en: 'Designer' },
      { da: 'Iværksætter', en: 'Founder' },
      { da: 'Produktchef', en: 'Product manager' },
      { da: 'Marketing', en: 'Marketing' },
      { da: 'Salg', en: 'Sales' },
      { da: 'Konsulent', en: 'Consultant' },
      { da: 'Skribent', en: 'Writer' },
      { da: 'Studerende', en: 'Student' },
    ],
    nextStep: 'intro',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 1 (intro): User has answered Q1 about their work. Parse role silently,
 * advance to Q2 (pains).
 */
function stepIntro(state: OnboardState, answer: string): OnboardResult {
  const role = parseRole(answer);
  state.role = role;
  state.work = answer.trim();
  state.answers.intro = answer;

  return {
    step: 'intro',
    teaching: {
      da: `Tak. Nu er det lettere at gætte hvad der frustrerer dig.`,
      en: `Thanks. Now it's easier to guess what's frustrating you.`,
    },
    question: {
      da: 'Hvad laver du igen og igen som føles som spildt tid? Små ting tæller — nævn 1-3.',
      en: 'What do you do over and over that feels like wasted time? Small things count — name 1-3.',
    },
    options: [
      { da: 'Kopiere data mellem systemer', en: 'Copy data between systems' },
      { da: 'Skrive samme slags email igen og igen', en: 'Write the same kind of email over and over' },
      { da: 'Opdatere rapporter og oversigter', en: 'Update reports and dashboards' },
      { da: 'Søge efter information jeg har før', en: 'Search for information I\'ve had before' },
      { da: 'Indtaste data fra dokumenter', en: 'Enter data from documents' },
      { da: 'Tage noter fra møder', en: 'Take notes from meetings' },
    ],
    nextStep: 'work',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 2 (work → pains): Record Q2, ask Q3 about where data lives.
 *
 * We collect AI-stack mentions in the background from this answer (many
 * users mention "I already use ChatGPT for..." here).
 */
function stepWork(state: OnboardState, answer: string): OnboardResult {
  // Allow explicit skip
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.work = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.pains = answer.trim();
  state.answers.work = answer;
  // Collect stack mentions opportunistically
  const detected = parseStack(answer);
  if (detected.length > 0) {
    state.stack = Array.from(new Set([...state.stack, ...detected]));
  }

  return {
    step: 'work',
    teaching: null,
    question: {
      da: 'Hvor har du dine vigtigste ting liggende i dag?',
      en: 'Where do your most important things live today?',
    },
    options: [
      { da: 'Excel', en: 'Excel' },
      { da: 'Google Sheets', en: 'Google Sheets' },
      { da: 'Notion', en: 'Notion' },
      { da: 'Airtable', en: 'Airtable' },
      { da: 'Email / Gmail', en: 'Email / Gmail' },
      { da: 'Dokumenter (Word, Drive)', en: 'Documents (Word, Drive)' },
      { da: 'En database', en: 'A database' },
      { da: 'Mest i hovedet', en: 'Mostly in my head' },
    ],
    nextStep: 'data',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 3 (data): Record Q3, classify substrate SILENTLY, ask question 4.
 *
 * The old flow had a teaching block here explaining "rules vs memory vs
 * documents vs database". That is developer jargon and doesn't belong in
 * the user-facing copy. We run classifySubstrate() in the background and
 * use the result in the plan step.
 */
function stepData(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.data = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.dataDescription = answer.trim();
  state.answers.data = answer;
  // More stack mentions may appear here too
  const detected = parseStack(answer);
  if (detected.length > 0) {
    state.stack = Array.from(new Set([...state.stack, ...detected]));
  }

  // Classify substrate silently — user never sees the word "substrate"
  try {
    const recommendation = classifySubstrate(state.dataDescription);
    state.decidedSubstrate = recommendation.primary;
  } catch {
    state.decidedSubstrate = null;
  }

  return {
    step: 'data',
    teaching: null,
    question: {
      da: 'Hvor tit skal din assistent arbejde for dig?',
      en: 'How often should your assistant work for you?',
    },
    options: [
      { da: 'Hver morgen', en: 'Every morning' },
      { da: 'Hver uge', en: 'Every week' },
      { da: 'Flere gange om dagen', en: 'Several times a day' },
      { da: 'Kun når jeg spørger', en: 'Only when I ask' },
      { da: 'Hver gang der sker noget', en: 'Every time something happens' },
      { da: 'En gang om måneden', en: 'Once a month' },
    ],
    nextStep: 'cadence',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 5 (cadence): Save cadence, ask Q6 (audience).
 */
function stepCadence(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.cadence = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.cadence = parseCadence(answer);
  state.answers.cadence = answer;

  return {
    step: 'cadence',
    teaching: null,
    question: {
      da: 'Hvem skal se resultaterne?',
      en: 'Who will see the results?',
    },
    options: [
      { da: 'Kun mig', en: 'Just me' },
      { da: 'Mit team', en: 'My team' },
      { da: 'Mig og mit team', en: 'Me and my team' },
      { da: 'Min chef', en: 'My boss' },
      { da: 'Mine kunder', en: 'My customers' },
      { da: 'Offentligt tilgængeligt', en: 'Publicly available' },
    ],
    nextStep: 'audience',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 6 (audience): Save audience, advance to plan.
 */
function stepAudience(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.audience = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.audience = parseAudience(answer);
  state.answers.audience = answer;

  return stepPlan(state, answer);
}

/**
 * Step 7 (plan): auto-install everything a Lovable-audience user shouldn't
 * have to paste themselves (skills, CLAUDE.md registration, protected-files
 * hook, MCP tool-search env), check which platforms still need a token, and
 * return a short "done" letter. No fake autonomy-rules markdown — we've
 * only asked six shallow questions, so we stay honest about that.
 */
function stepPlan(state: OnboardState, _answer: string): OnboardResult {
  // 1. Persist config.json (already tracks name, role, cadence, audience,
  //    substrate, stack) so downstream tools personalise off real data.
  writeConfigTemplate(state);

  // 2. Auto-install — run each step; individual failures don't block the rest.
  const installSteps: InstallStep[] = [
    installDearUserSkills(),
    registerDearUserInClaudeMd(state),
    installProtectedFilesHook(),
    ensureToolSearchAuto(),
  ];

  // 3. Platform status — which integrations are connected? which need a
  //    one-message paste to the agent? Only shows platforms we detected.
  const platformStatus = detectPlatformStatus();

  // 4. Scheduled task — we can't write it ourselves (different MCP),
  //    so we give the user a ready-to-paste prompt.
  const scheduledPrompt = buildScheduledTaskPrompt(state);

  // 5. Chat/markdown fallback for the MCP transport. The dashboard uses
  //    the structured fields (installSteps / platformStatus / scheduledPrompt)
  //    directly and doesn't parse this.
  const plan = renderCompletionMarkdown(state, installSteps, platformStatus, scheduledPrompt);

  return {
    step: 'plan',
    teaching: null,
    question: null,
    options: [],
    nextStep: null,
    state: encodeState(state),
    done: true,
    plan,
    installSteps,
    platformStatus,
    scheduledPrompt,
  };
}

function renderCompletionMarkdown(
  state: OnboardState,
  steps: InstallStep[],
  platforms: PlatformStatus[],
  schedPrompt: LocalizedString | null,
): string {
  const name = state.name || 'there';
  const lines: string[] = [];
  lines.push(`## Tak, ${name} — dit setup er klar.`);
  lines.push('');
  lines.push('Jeg har sat det grundlæggende op for dig:');
  lines.push('');
  for (const s of steps) {
    lines.push(`- ${s.ok ? '✓' : '⚠'} ${s.title.da}${s.ok ? '' : ` — ${s.detail || ''}`}`);
  }
  if (platforms.length > 0) {
    lines.push('');
    lines.push('**Platforme i dine projekter:**');
    for (const p of platforms) {
      if (p.state === 'connected') {
        lines.push(`- ✓ ${p.label} (forbundet)`);
      } else if (p.prompt) {
        lines.push(`- ⚠ ${p.label} — send denne til din agent: *"${p.prompt.da}"*`);
      }
    }
  }
  if (schedPrompt) {
    lines.push('');
    lines.push(`**Rutine:** send denne til din agent: *"${schedPrompt.da}"*`);
  }
  lines.push('');
  lines.push('**Næste skridt:** åbn Claude Code og skriv `/dearuser-collab`. Så laver jeg mit første brev om hvordan du og din agent arbejder sammen.');
  lines.push('');
  lines.push('Jeg lærer dig bedre at kende efterhånden. De første breve er generelle; efter et par uger begynder de at ramme mere præcist.');
  return lines.join('\n');
}

/**
 * Turn the user's cadence + audience answer into a concrete next-step hint.
 * For Lovable-segment users, "scheduled task" needs to be explained in
 * plain language — not as a cron spec.
 */
function renderCadenceHint(state: OnboardState): string | null {
  if (!state.cadence) return null;

  const lines: string[] = ['## Hvordan din assistent arbejder for dig'];

  switch (state.cadence) {
    case 'daily':
      lines.push(
        '',
        'Du vil have et dagligt overblik. Det gøres bedst med en **scheduled task** — en opgave der kører automatisk hver morgen.',
        '',
        'Næste skridt: bed Claude om at oprette en "morning brief" scheduled task. Fx: *"Opret en scheduled task der hver morgen kl 8 opsummerer [dine projekter/tasks/data]"*.',
      );
      break;
    case 'weekly':
      lines.push(
        '',
        'Du vil have en ugentlig opsummering. Det gøres bedst med en **scheduled task** der kører én gang om ugen.',
        '',
        'Næste skridt: bed Claude om at oprette en "weekly wrap" scheduled task. Fx: *"Opret en scheduled task der hver fredag kl 16 opsummerer ugens [data/fremskridt]"*.',
      );
      break;
    case 'event':
      lines.push(
        '',
        'Du vil have at assistenten reagerer når noget sker. Det gøres bedst med **hooks** — handlinger der trigges automatisk ved bestemte events.',
        '',
        'Næste skridt: bed Claude om at konfigurere hooks. Fx: *"Sæt en hook op så jeg får en notifikation hver gang der kommer en ny række i [dit ark/system]"*.',
      );
      break;
    case 'on-demand':
      lines.push(
        '',
        'Du vil have kontrollen — assistenten arbejder kun når du beder om det. Ingen automation behøves.',
        '',
        'Næste skridt: brug chat direkte når du har et spørgsmål. Din setup er klar nu.',
      );
      break;
  }

  if (state.audience === 'team' || state.audience === 'customers') {
    lines.push(
      '',
      state.audience === 'team'
        ? '**Dit team skal kunne se resultatet:** vi sender outputs til en delt markdown-fil eller Notion-side — bed Claude om at sætte det op som del af din scheduled task.'
        : '**Dine kunder skal kunne se resultatet:** det kræver en lille web-side eller PDF-export. Bed Claude om at foreslå den simpleste løsning baseret på hvad du har i forvejen.',
    );
  }

  return lines.join('\n');
}

/**
 * Write a starter ~/.dearuser/config.json if one doesn't already exist.
 * v3 adds cadence + audience + role so downstream tools (scorer, recommender,
 * security) can personalise — the "onboarding as pipeline-input" principle.
 */
function writeConfigTemplate(state: OnboardState): string | null {
  const configDir = path.join(os.homedir(), '.dearuser');
  const configPath = path.join(configDir, 'config.json');

  const preferences = {
    name: state.name,
    role: state.role,
    cadence: state.cadence,
    audience: state.audience,
    substrate: state.decidedSubstrate,
    stack: state.stack,
    // Raw answers — the user's own words, shown on the profile page.
    work: state.work || undefined,
    pains: state.pains || undefined,
    dataDescription: state.dataDescription || undefined,
  };

  // If config exists, merge preferences (non-destructive on other fields)
  if (fs.existsSync(configPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const merged = {
        ...existing,
        preferences: { ...(existing.preferences || {}), ...preferences },
      };
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      return `## Indstillinger gemt\n\nDine svar er tilføjet til \`~/.dearuser/config.json\` — andre tools (diagnose, security) bruger dem til at give mere relevante anbefalinger.`;
    } catch {
      return `## Indstillinger\n\nEksisterende config fundet i \`~/.dearuser/config.json\` — kunne ikke læse den, så dine svar er ikke gemt. Det påvirker ikke planen ovenfor.`;
    }
  }

  // New config — include search roots and token placeholders for detected platforms
  const candidates = ['code', 'projects', 'work', 'src', 'dev'];
  const searchRoots: string[] = [];
  for (const name of candidates) {
    const p = path.join(os.homedir(), name);
    try {
      if (fs.statSync(p).isDirectory()) searchRoots.push(`~/${name}`);
    } catch { /* skip */ }
  }

  const detected = detectPlatforms(searchRoots.map(r => r.replace(/^~/, os.homedir())));
  const tokens: Record<string, string> = {};
  if (detected.has('supabase')) tokens.supabase = '';
  if (detected.has('vercel')) tokens.vercel = '';

  const config = {
    searchRoots: searchRoots.length > 0 ? searchRoots : [`~/`],
    preferences,
    ...(Object.keys(tokens).length > 0 ? { tokens } : {}),
  };

  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    return `## Indstillinger\n\nKunne ikke skrive \`~/.dearuser/config.json\`: ${err instanceof Error ? err.message : err}. Det påvirker ikke planen ovenfor.`;
  }

  const lines = [
    `## Indstillinger gemt`,
    ``,
    `Dine svar er gemt i \`~/.dearuser/config.json\`. Andre tools (diagnose, security) bruger dem til at give mere relevante anbefalinger.`,
  ];

  if (detected.has('supabase')) {
    lines.push(
      ``,
      `**Supabase-adgang (valgfrit):** Hvis du vil have sikkerhedstjek af din Supabase, tilføj en token i \`tokens.supabase\`. Hent en på https://supabase.com/dashboard/account/tokens.`,
    );
  }
  if (detected.has('vercel')) {
    lines.push(
      ``,
      `**Vercel-adgang (valgfrit):** Hvis du vil have tjek af dine Vercel-miljøvariabler, tilføj en token i \`tokens.vercel\`. Hent en på https://vercel.com/account/tokens.`,
    );
  }

  return lines.join('\n');
}

/** Inspect search roots and return the set of platforms detected (by file signatures). */
export function detectPlatforms(searchRoots: string[]): Set<string> {
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 3 || found.size === 3) return;
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
  // Default first step is 'welcome' — the letter screen before any questions.
  const currentStep = (input.step || 'welcome') as OnboardStep;
  const state = decodeState(input.state);
  const answer = input.answer || '';

  switch (currentStep) {
    case 'welcome':     return stepWelcome(state, answer);
    case 'greet':       return stepGreet(state, answer);
    case 'intro':       return stepIntro(state, answer);
    case 'work':        return stepWork(state, answer);
    case 'data':        return stepData(state, answer);
    case 'cadence':     return stepCadence(state, answer);
    case 'audience':    return stepAudience(state, answer);
    case 'plan':        return stepPlan(state, answer);
    // Backwards compat — route old step names to the closest v3 step:
    case 'role':        return stepIntro(state, answer);
    case 'goals':       return stepWork(state, answer);
    case 'stack':       return stepWork(state, answer);
    case 'pains':       return stepWork(state, answer);
    case 'stack-pains': return stepWork(state, answer);
    case 'substrate':   return stepCadence(state, answer);
    default:
      return stepWelcome(freshState(), '');
  }
}

function stepNumber(step: OnboardStep): number {
  const map: Record<string, number> = {
    welcome: 0, // letter screen — no counter shown
    greet: 1,
    intro: 2, role: 2,
    work: 3, goals: 3,
    data: 4, stack: 4, pains: 4, 'stack-pains': 4,
    cadence: 5, substrate: 5,
    audience: 6,
    plan: 7,
  };
  return map[step] || 1;
}

/**
 * Label-number for "trin X af 5 spørgsmål". In the intro step we ask TWO questions
 * back-to-back (Q1 then Q2 after role parse), so the label should reflect
 * the question being asked — use nextStep when available.
 */
function labelNumber(result: OnboardResult): number {
  if (result.done) return 6;
  // Prefer nextStep's number when the handler has advanced — the question
  // being shown belongs to the next step, not the one that generated it.
  if (result.nextStep && result.nextStep !== result.step && result.nextStep !== 'plan') {
    return stepNumber(result.nextStep);
  }
  const n = stepNumber(result.step);
  // We have 6 questions (greet..audience) and a plan. Cap at 6 for labels.
  return Math.min(n, 6);
}

/**
 * Format an OnboardResult as markdown for the MCP client.
 *
 * The chat surface can't do CSS-based language toggling, so we pick one
 * language. Default is English (universal for Claude Code); pass lang='da'
 * to force Danish. The agent is responsible for matching the user's locale —
 * both strings are present in OnboardResult, so it can switch on its own.
 */
export function formatOnboardResult(result: OnboardResult, lang: 'da' | 'en' = 'en'): string {
  const lines: string[] = [];

  if (result.done && result.plan) {
    return result.plan;
  }

  const L = (s: LocalizedString): string => s[lang];

  // Welcome step has no question — render the letter only, then instruct the
  // agent to advance with a "ready" answer.
  if (result.step === 'welcome' && result.teaching) {
    lines.push(L(result.teaching));
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*Agent: present the letter above. When the user is ready to continue, call `mcp__dearuser__onboard` again with:*');
    lines.push(`- \`step\`: \`"welcome"\``);
    lines.push('- `answer`: `"ready"`');
    lines.push(`- \`state\`: \`"${result.state}"\` (this exact string — do not modify)`);
    return lines.join('\n');
  }

  lines.push(lang === 'da'
    ? `*Onboard — trin ${labelNumber(result)} af 6 spørgsmål*`
    : `*Onboard — step ${labelNumber(result)} of 6 questions*`);
  lines.push('');

  if (result.teaching) {
    lines.push(L(result.teaching));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (result.question) {
    lines.push(`**${L(result.question)}**`);
  }

  if (result.options.length > 0) {
    lines.push('');
    for (let i = 0; i < result.options.length; i++) {
      lines.push(`${i + 1}. ${L(result.options[i])}`);
    }
    lines.push('');
    lines.push(lang === 'da'
      ? '*(Eller svar frit — det der føles mest naturligt.)*'
      : '*(Or answer freely — whatever feels most natural.)*');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Agent: present the question above in the user\'s language (both Danish and English are available on `result.question.da` / `result.question.en`). When the user answers, call `mcp__dearuser__onboard` again with:*');
  lines.push(`- \`step\`: \`"${result.nextStep}"\``);
  lines.push('- `answer`: the user\'s answer');
  lines.push(`- \`state\`: \`"${result.state}"\` (this exact string — do not modify)`);

  return lines.join('\n');
}
