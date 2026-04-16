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

export type OnboardStep =
  | 'intro'
  | 'work'
  | 'data'
  | 'cadence'
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
  /** Q4 parts — cadence ('daily'/'weekly'/'on-demand'/'event') + audience. */
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

/** Parse Q4 cadence answer. */
function parseCadence(answer: string): OnboardState['cadence'] {
  const a = answer.toLowerCase();
  if (/daily|hver morgen|hver dag|every morning|each day|om morgenen/.test(a)) return 'daily';
  if (/weekly|hver uge|every week|om ugen|sunday|monday/.test(a)) return 'weekly';
  if (/when (?:something|it) happens|hver gang|event|trigger|n\u00e5r der sker/.test(a)) return 'event';
  if (/on.?demand|kun n\u00e5r|only when|when i ask|n\u00e5r jeg (?:beder|sp\u00f8rger)/.test(a)) return 'on-demand';
  // Default: on-demand is the safest (no autonomous side effects).
  return 'on-demand';
}

/** Parse Q4 audience answer. */
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
 * Step 1 (intro): Project scan happens silently; ask Q1.
 *
 * We DO NOT tell the user "I can see you already have 69 memory files, 11
 * skills, 1 hook" — that is meaningless to the Lovable audience and reads as
 * jargon. The scan data is kept in state for later use by the plan step.
 */
function stepIntro(state: OnboardState, answer: string): OnboardResult {
  // First call — no answer yet, silent scan + Q1
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
      step: 'intro',
      teaching: `Hej — jeg vil lære dig at kende, så jeg kan foreslå hvordan AI bedst hjælper dig.\n\nDet tager 4 små spørgsmål. Ingen forkerte svar.`,
      question: 'Hvad arbejder du med til daglig? Hvilken slags arbejde tager mest af din tid?',
      options: [],
      // Stay in 'intro' so the next call parses Q1's answer (role). Only
      // after parseRole do we advance to 'work'.
      nextStep: 'intro',
      state: encodeState(state),
      done: false,
      plan: null,
    };
  }

  // Second call — parse role silently, advance to work (Q2)
  const role = parseRole(answer);
  state.role = role;
  state.work = answer.trim();
  state.answers.intro = answer;

  return {
    step: 'intro',
    teaching: `Tak. Nu er det lettere at gætte hvad der frustrerer dig.`,
    question: 'Hvad laver du igen og igen som føles som spildt tid? Små ting tæller — fx at kopiere data fra ét sted til et andet, skrive samme slags email, eller opdatere den samme oversigt hver uge. Nævn 1-3.',
    options: [],
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
    question: 'Hvor har du dine vigtigste ting liggende i dag? Excel, Google Sheets, Notion, Airtable, email, dokumenter — eller mest i hovedet? Skriv bare kort hvor det er, og hvor meget der er.',
    options: [],
    nextStep: 'data',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 3 (data): Record Q3, classify substrate SILENTLY, ask Q4.
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
    question: 'To sidste ting:\n\n1. **Hvor tit skal din assistent arbejde for dig?** Hver morgen give dig overblik? En gang om ugen opsummere? Kun når du selv spørger? Eller hver gang der sker noget (ny email, ny linje i et ark)?\n\n2. **Hvem skal se resultaterne?** Kun dig? Dine kollegaer? Dine kunder?',
    options: [
      'Hver morgen — og det er kun til mig',
      'Hver uge — til mig og mit team',
      'Kun når jeg selv spørger',
    ],
    nextStep: 'cadence',
    state: encodeState(state),
    done: false,
    plan: null,
  };
}

/**
 * Step 4 (cadence): Record Q4 answers (cadence + audience), advance to plan.
 */
function stepCadence(state: OnboardState, answer: string): OnboardResult {
  if (/skip|just.*template|spring over/i.test(answer)) {
    state.answers.cadence = '(skipped)';
    return stepPlan(state, 'skip');
  }

  state.cadence = parseCadence(answer);
  state.audience = parseAudience(answer);
  state.answers.cadence = answer;

  return stepPlan(state, answer);
}

/**
 * Step 5 (plan): Produce tailored setup plan.
 *
 * In v3 we also write cadence + audience into ~/.dearuser/config.json so
 * downstream tools (scorer, recommender, security) can read them — this is
 * the "onboarding as pipeline-input" principle from memory.
 */
function stepPlan(state: OnboardState, _answer: string): OnboardResult {
  const role = state.role || 'occasional';
  const template = getSetupTemplate(role);

  const substrateSummary = state.decidedSubstrate
    ? substrateLabel(state.decidedSubstrate)
    : null;

  const plan = renderPlan(template, {
    goals: state.work,           // Q1 work → "goals" slot in the template renderer
    pains: state.pains,
    substrateSummary,
  });

  // Write Dear User config. Also includes cadence + audience so pipeline
  // consumers (scorer, recommender, security) can personalise.
  const configStatus = writeConfigTemplate(state);

  // Cadence hint — if the user wanted daily/weekly, tell them about scheduled tasks.
  const cadenceHint = renderCadenceHint(state);

  const parts = [plan];
  if (cadenceHint) parts.push(cadenceHint);
  if (configStatus) parts.push(configStatus);
  const fullPlan = parts.join('\n\n---\n\n');

  return {
    step: 'plan',
    teaching: null,
    question: 'Din plan er klar. Arbejd gennem de 3 næste-skridt i rækkefølge — små ændringer bygger ovenpå hinanden.',
    options: [],
    nextStep: null,
    state: encodeState(state),
    done: true,
    plan: fullPlan,
  };
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
    role: state.role,
    cadence: state.cadence,
    audience: state.audience,
    substrate: state.decidedSubstrate,
    stack: state.stack,
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
  const candidates = ['clawd', 'code', 'projects', 'work', 'src'];
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
function detectPlatforms(searchRoots: string[]): Set<string> {
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
  const currentStep = (input.step || 'intro') as OnboardStep;
  const state = decodeState(input.state);
  const answer = input.answer || '';

  switch (currentStep) {
    case 'intro':       return stepIntro(state, answer);
    case 'work':        return stepWork(state, answer);
    case 'data':        return stepData(state, answer);
    case 'cadence':     return stepCadence(state, answer);
    case 'plan':        return stepPlan(state, answer);
    // Backwards compat — route old step names to the closest v3 step:
    case 'role':        return stepIntro(state, answer);
    case 'goals':       return stepWork(state, answer);
    case 'stack':       return stepWork(state, answer);
    case 'pains':       return stepWork(state, answer);
    case 'stack-pains': return stepWork(state, answer);
    case 'substrate':   return stepCadence(state, answer);
    default:
      return stepIntro(freshState(), '');
  }
}

function stepNumber(step: OnboardStep): number {
  const map: Record<string, number> = {
    intro: 1, role: 1,
    work: 2, goals: 2,
    data: 3, stack: 3, pains: 3, 'stack-pains': 3,
    cadence: 4, substrate: 4,
    plan: 5,
  };
  return map[step] || 1;
}

/**
 * Label-number for "trin X af 5". In the intro step we ask TWO questions
 * back-to-back (Q1 then Q2 after role parse), so the label should reflect
 * the question being asked — use nextStep when available.
 */
function labelNumber(result: OnboardResult): number {
  if (result.done) return 5;
  if (result.nextStep && result.nextStep !== result.step) {
    return stepNumber(result.nextStep);
  }
  return stepNumber(result.step);
}

/** Format an OnboardResult as markdown for the MCP client. */
export function formatOnboardResult(result: OnboardResult): string {
  const lines: string[] = [];

  if (result.done && result.plan) {
    return result.plan;
  }

  lines.push(`*Onboard — trin ${labelNumber(result)} af 5*`);
  lines.push('');

  if (result.teaching) {
    lines.push(result.teaching);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push(`**${result.question}**`);

  if (result.options.length > 0) {
    lines.push('');
    for (let i = 0; i < result.options.length; i++) {
      lines.push(`${i + 1}. ${result.options[i]}`);
    }
    lines.push('');
    lines.push('*(Eller svar frit — det der føles mest naturligt.)*');
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
