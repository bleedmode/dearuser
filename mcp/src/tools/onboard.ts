// onboard — conversational setup dialog.
//
// MCP is stateless, so conversation state rides as a base64-encoded JSON blob
// passed between calls. The agent (Claude) presents each returned question to
// the user, collects the answer, and calls this tool again with the step name,
// the answer, and the same state blob.
//
// Flow (v4 — cold-start intent questions only):
//   welcome → greet → outcome → autonomy → cadence → audience → plan
//
// What we ask vs. what we infer:
//   Ask: name, outcome, autonomy preference, cadence, audience.
//   Infer from scan: role (archetype-detector), tech stack, substrate.
//   Drop: pains and data-description were v3 cold-start questions that nothing
//   in the collab pipeline consumed — moved to the first collab report where
//   they are data, not interview.
//
// Backwards compat: old step names (role, goals, stack, pains, stack-pains,
// substrate, intro, work, data) are still accepted and routed to the closest
// v4 step so older clients and saved state blobs keep working.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scan } from '../engine/scanner.js';
import { parse } from '../engine/parser.js';
import { lintClaudeMd } from '../engine/lint-checks.js';
import { summariseContextHealth, type ContextFileHealth } from '../engine/context-file-health.js';
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
  | 'outcome'
  | 'autonomy'
  | 'cadence'
  | 'plan'
  // Backwards compat — route old step names onto the closest v4 step.
  // v4.1 dropped `audience` as a question; old clients still landing on it
  // get routed to the plan step (we have no way to ask them for the answer
  // now that the question is gone).
  | 'audience'     // → plan (v4.1)
  | 'intro'        // → outcome
  | 'role'         // → outcome
  | 'goals'        // → outcome
  | 'work'         // → outcome
  | 'data'         // → autonomy
  | 'stack'        // → autonomy
  | 'pains'        // → autonomy
  | 'stack-pains'  // → autonomy
  | 'substrate';   // → cadence

export interface OnboardState {
  version: 1;
  /** Q0 answer — what the user wants us to call them. Used in report letter openings. */
  name: string | null;
  /** Q1 raw answer — what the user wants to achieve. */
  outcome: string | null;
  /** Q2 — how autonomous they want the agent. */
  autonomy: 'auto' | 'ask-risky' | 'ask-all' | null;
  /** Q3 — how often the agent should work. */
  cadence: 'daily' | 'weekly' | 'on-demand' | 'event' | null;
  /** Q4 — who will see the output. */
  audience: 'self' | 'team' | 'customers' | null;
  /** Raw history for auditability. */
  answers: Record<string, string>;
  /** Detected existing setup (populated on first call). */
  existingSetup?: {
    hasClaudeMd: boolean;
    hasMemory: boolean;
    skillCount: number;
    hookCount: number;
    /** Bloat / LLM-smell / staleness summary — only when the user has a CLAUDE.md to score. */
    contextHealth?: ContextFileHealth | null;
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
    outcome: null,
    autonomy: null,
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
      // Migrate v2/v3 state shapes — old fields like `work`, `goals`,
      // `dataDescription` fold into outcome if we don't have one yet.
      const outcome = parsed.outcome ?? parsed.work ?? parsed.goals ?? null;
      return {
        ...freshState(),
        ...parsed,
        outcome,
        autonomy: parsed.autonomy ?? null,
        cadence: parsed.cadence ?? null,
        audience: parsed.audience ?? null,
      };
    }
  } catch { /* fall through */ }
  return freshState();
}

// ============================================================================
// Answer parsing
// ============================================================================

/** Parse a name answer — first word, capitalised. */
function parseName(answer: string): string | null {
  const cleaned = answer.trim().replace(/^(jeg hedder|mit navn er|i['']m|my name is|kald mig|call me)\s+/i, '');
  const first = cleaned.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}-]/gu, '');
  if (!first || first.length > 40) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** Parse an autonomy answer. Accepts free text or the 3 canonical options. */
function parseAutonomy(answer: string): OnboardState['autonomy'] {
  const a = answer.toLowerCase();
  // "Ask at every step" / "spørg ved alt" — most conservative
  if (/ask.*(?:all|every|hver|alt|altid)|spørg.*(?:om|ved).*(?:alt|alting|hver)|always.*ask|altid.*spørg/.test(a)) return 'ask-all';
  // "Work on your own" / "arbejd selv" / "auto" — most autonomous
  if (/(?:work|arbejd).*(?:on.*own|self|alene|selv)|auto|autonom|uden.*at.*spørge|without.*asking|do.*yourself|gør.*selv/.test(a)) return 'auto';
  // "Ask at risky things" / "spørg ved store ting" — middle tier
  if (/risky|store.*ting|risiko|vigtige|important|kritisk|critical|big.*decision|store.*beslutning/.test(a)) return 'ask-risky';
  // Fall back: middle tier is safest default.
  return 'ask-risky';
}

/** Parse cadence answer. */
function parseCadence(answer: string): OnboardState['cadence'] {
  const a = answer.toLowerCase();
  if (/daily|hver morgen|hver dag|every morning|each day|om morgenen|flere gange/.test(a)) return 'daily';
  if (/weekly|hver uge|every week|om ugen|sunday|monday|fredag/.test(a)) return 'weekly';
  if (/when (?:something|it) happens|hver gang|event|trigger|når der sker/.test(a)) return 'event';
  if (/on.?demand|kun når|only when|when i ask|når jeg (?:beder|spørger)|en gang om/.test(a)) return 'on-demand';
  return 'on-demand';
}

/** Parse audience answer. */
function parseAudience(answer: string): OnboardState['audience'] {
  const a = answer.toLowerCase();
  if (/customer|kunde|client|user|offentlig|public/.test(a)) return 'customers';
  if (/team|colleague|kollega|coworker|boss|chef|manager|department|afdeling/.test(a)) return 'team';
  return 'self';
}

// ============================================================================
// Step handlers
// ============================================================================

/**
 * Step -1 (welcome): pure letter screen — no question, no input. User
 * clicks "Ready" to advance to the first real question. We also run the
 * project scan here silently (earliest we have the user's attention).
 */
function stepWelcome(state: OnboardState, answer: string): OnboardResult {
  if (!answer) {
    try {
      const scanResult = scan(process.cwd(), 'global');
      const hasClaudeMd = scanResult.globalClaudeMd !== null || scanResult.projectClaudeMd !== null;
      let contextHealth: ContextFileHealth | null = null;
      if (hasClaudeMd) {
        try {
          const parsed = parse(scanResult);
          const lintResult = lintClaudeMd(scanResult, parsed);
          contextHealth = summariseContextHealth(lintResult.findings);
        } catch {
          contextHealth = null;
        }
      }
      state.existingSetup = {
        hasClaudeMd,
        hasMemory: scanResult.memoryFiles.length > 0,
        skillCount: scanResult.skillsCount ?? 0,
        hookCount: scanResult.hooksCount ?? 0,
        contextHealth,
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
      question: null,
      options: [],
      nextStep: 'greet',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }
  return stepGreet(state, '');
}

/**
 * Step 0 (greet): Ask the user's first name so every report opens
 * with "Kære [name]," instead of "Kære bruger,".
 */
function stepGreet(state: OnboardState, answer: string): OnboardResult {
  if (!answer) {
    return {
      step: 'greet',
      teaching: null,
      question: { da: 'Hvad er dit fornavn?', en: "What's your first name?" },
      options: [],
      nextStep: 'greet',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }

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
      da: 'Hvad skal jeg hjælpe dig med at opnå?',
      en: 'What should I help you achieve?',
    },
    options: [
      { da: 'Bygge og shippe produkter hurtigere', en: 'Build and ship products faster' },
      { da: 'Drive flere projekter samtidig', en: 'Run more projects in parallel' },
      { da: 'Automatisere gentaget arbejde', en: 'Automate repetitive work' },
      { da: 'Lære nyt hurtigere', en: 'Learn new things faster' },
      { da: 'Holde styr på et team', en: 'Keep a team on track' },
      { da: 'Hjælpe mig med research og analyse', en: 'Help with research and analysis' },
    ],
    nextStep: 'outcome',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 1 (outcome): Record the user's goal. This replaces v3's Q1 "what do
 * you work with" — outcome is active (future-facing), work is passive
 * (status-quo). Feeds personalisation in the first paragraph of every collab
 * report.
 */
function stepOutcome(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.outcome = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.outcome = answer.trim();
  state.answers.outcome = answer;

  return {
    step: 'outcome',
    teaching: {
      da: `Tak. Det hjælper mig med at vurdere hvad der er vigtigst.`,
      en: `Thanks. That helps me judge what matters most.`,
    },
    question: {
      da: 'Skal jeg arbejde på egen hånd, eller spørge dig først?',
      en: 'Should I work on my own, or ask you first?',
    },
    options: [
      { da: 'Arbejd selv — jeg stoler på dig', en: 'Work on your own — I trust you' },
      { da: 'Spørg ved store eller risikable ting', en: 'Ask on big or risky things' },
      { da: 'Spørg mig før hver handling', en: 'Ask me before every action' },
    ],
    nextStep: 'autonomy',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 2 (autonomy): Record the user's autonomy preference. This is the
 * signal that most strongly predicts friction — auto + no hooks = risk,
 * ask-all + many do-rules = contract mismatch.
 */
function stepAutonomy(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.autonomy = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.autonomy = parseAutonomy(answer);
  state.answers.autonomy = answer;

  return {
    step: 'autonomy',
    teaching: {
      da: `Jeg kan foreslå en fast rytme — fx et dagligt brief, en ugentlig opsummering, eller en hook der reagerer når noget specifikt sker. Dit svar former hvilken scheduled task jeg foreslår efter onboarding. Du beslutter selv om du vil oprette den — jeg laver ingen automation uden dit klik.`,
      en: `I can suggest a rhythm — a daily brief, a weekly summary, or a hook that fires when something specific happens. Your answer shapes which scheduled task I'll suggest after onboarding. You decide whether to create it — I don't set up any automation without your click.`,
    },
    question: {
      da: 'Skal jeg køre noget automatisk for dig?',
      en: 'Should I run anything automatically for you?',
    },
    options: [
      { da: 'Et dagligt brief', en: 'A daily briefing' },
      { da: 'En ugentlig opsummering', en: 'A weekly summary' },
      { da: 'Når noget bestemt sker', en: 'When something specific happens' },
      { da: 'Ikke noget automatisk — jeg spørger selv', en: 'Nothing automatic — I\'ll ask when I need you' },
    ],
    nextStep: 'cadence',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 3 (cadence): Save cadence, advance straight to plan. Audience was
 * dropped from v4.1 — it was the weakest signal in onboarding (mostly
 * redundant with outcome-text) and the only unique value (team/customers
 * mismatch warning) can be recovered from scan heuristics later.
 */
function stepCadence(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.cadence = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.cadence = parseCadence(answer);
  state.answers.cadence = answer;

  return stepPlan(state, answer);
}

/**
 * Step 5 (plan): auto-install everything the user shouldn't have to paste,
 * check platform connections, return a short "done" letter.
 */
function stepPlan(state: OnboardState, _answer: string): OnboardResult {
  writeConfigTemplate(state);

  const installSteps: InstallStep[] = [
    installDearUserSkills(),
    registerDearUserInClaudeMd(state),
    installProtectedFilesHook(),
    ensureToolSearchAuto(),
  ];

  const platformStatus = detectPlatformStatus();
  const scheduledPrompt = buildScheduledTaskPrompt(state);
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
 * Write / merge ~/.dearuser/config.json with the v4 preferences shape.
 * Non-destructive: preserves unrelated top-level fields (searchRoots,
 * tokens) and preserves legacy preferences fields so older readers still
 * work during rollout.
 */
function writeConfigTemplate(state: OnboardState): string | null {
  const configDir = path.join(os.homedir(), '.dearuser');
  const configPath = path.join(configDir, 'config.json');

  const preferences = {
    name: state.name,
    outcome: state.outcome || undefined,
    autonomy: state.autonomy,
    cadence: state.cadence,
    audience: state.audience,
  };

  if (fs.existsSync(configPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const merged = {
        ...existing,
        preferences: { ...(existing.preferences || {}), ...preferences },
      };
      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
      return `## Indstillinger gemt\n\nDine svar er tilføjet til \`~/.dearuser/config.json\` — andre tools (collab, security) bruger dem til at give mere relevante anbefalinger.`;
    } catch {
      return `## Indstillinger\n\nEksisterende config fundet i \`~/.dearuser/config.json\` — kunne ikke læse den, så dine svar er ikke gemt. Det påvirker ikke planen ovenfor.`;
    }
  }

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
    `Dine svar er gemt i \`~/.dearuser/config.json\`. Andre tools (collab, security) bruger dem til at give mere relevante anbefalinger.`,
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
  const currentStep = (input.step || 'welcome') as OnboardStep;
  const state = decodeState(input.state);
  const answer = input.answer || '';

  switch (currentStep) {
    case 'welcome':     return stepWelcome(state, answer);
    case 'greet':       return stepGreet(state, answer);
    case 'outcome':     return stepOutcome(state, answer);
    case 'autonomy':    return stepAutonomy(state, answer);
    case 'cadence':     return stepCadence(state, answer);
    case 'plan':        return stepPlan(state, answer);
    // Backwards compat — route legacy step names onto the closest v4 step.
    // `audience` was a v4.0 question dropped in v4.1; old clients still
    // posting to it skip to plan.
    case 'audience':    return stepPlan(state, answer);
    case 'intro':       return stepOutcome(state, answer);
    case 'role':        return stepOutcome(state, answer);
    case 'goals':       return stepOutcome(state, answer);
    case 'work':        return stepOutcome(state, answer);
    case 'data':        return stepAutonomy(state, answer);
    case 'stack':       return stepAutonomy(state, answer);
    case 'pains':       return stepAutonomy(state, answer);
    case 'stack-pains': return stepAutonomy(state, answer);
    case 'substrate':   return stepCadence(state, answer);
    default:
      return stepWelcome(freshState(), '');
  }
}

function stepNumber(step: OnboardStep): number {
  const map: Record<string, number> = {
    welcome: 0,
    greet: 1,
    outcome: 2,
    autonomy: 3,
    cadence: 4,
    plan: 5,
    // Legacy aliases — all route to their replacement step's number so
    // older clients see a consistent counter.
    audience: 4, // dropped in v4.1
    intro: 2, role: 2, goals: 2, work: 2,
    data: 3, stack: 3, pains: 3, 'stack-pains': 3, substrate: 4,
  };
  return map[step] || 1;
}

/**
 * Label-number for "trin X af 4 spørgsmål". v4.1 asks 4 cold-start
 * questions (greet/outcome/autonomy/cadence). audience was dropped.
 * Prefer nextStep's number when the handler has advanced — the question
 * being shown belongs to the next step, not the one that generated it.
 */
function labelNumber(result: OnboardResult): number {
  if (result.done) return 4;
  if (result.nextStep && result.nextStep !== result.step && result.nextStep !== 'plan') {
    return stepNumber(result.nextStep);
  }
  const n = stepNumber(result.step);
  return Math.min(n, 4);
}

/**
 * Format an OnboardResult as markdown for the MCP client.
 */
export function formatOnboardResult(result: OnboardResult, lang: 'da' | 'en' = 'en'): string {
  const lines: string[] = [];

  if (result.done && result.plan) {
    return result.plan;
  }

  const L = (s: LocalizedString): string => s[lang];

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
    ? `*Onboard — trin ${labelNumber(result)} af 5 spørgsmål*`
    : `*Onboard — step ${labelNumber(result)} of 5 questions*`);
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
