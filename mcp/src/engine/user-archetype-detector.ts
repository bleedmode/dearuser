// user-archetype-detector — classify the USER from onboarding answers.
//
// This is the counterpart to `persona-detector` (which classifies the
// AGENT's configuration). They deliberately use DIFFERENT taxonomies so
// "You and me" feels like complementary roles, not overlapping boxes:
//
//   User  = who you are            (what you bring)
//   Agent = what role I play        (how I help)
//
// User archetypes (6):
//   - Venture Builder   — portfolio, multi-project, systems-first
//   - Vibe Coder        — non-tech founder, product vision, delegation
//   - Indie Hacker      — solo, revenue-driven, ship-fast
//   - Craftsman         — technical expertise, quality-focused
//   - Team Lead         — coordinates other humans/agents
//   - Explorer          — research, learning, mapping new domains

import type { UserPreferences } from './user-preferences.js';

export type UserArchetypeId =
  | 'venture_builder'
  | 'vibe_coder'
  | 'indie_hacker'
  | 'craftsman'
  | 'team_lead'
  | 'explorer';

export interface UserArchetypeResult {
  detected: UserArchetypeId;
  confidence: number;
  /** Secondary archetype if it scores within 50% of the primary — people
   *  are rarely pure archetypes (Jarl is Venture Builder + Vibe Coder). */
  runnerUp: UserArchetypeId | null;
  archetypeName: string;
  archetypeDescription: string;
  traits: string[];
  scores: Record<UserArchetypeId, number>;
}

interface UserArchetypeDef {
  id: UserArchetypeId;
  name: string;
  description: string;
  traits: string[];
}

const ARCHETYPES: UserArchetypeDef[] = [
  {
    id: 'venture_builder',
    name: 'Venture Builder',
    description: "You don't build one product — you build the machine that builds many. Portfolio-minded, systems-first, and allergic to doing the same thing twice. Your superpower is seeing patterns across projects that no single founder would notice.",
    traits: ['Portfolio-minded', 'Systems-first', 'Automation-driven', 'Pattern-recogniser', 'Multi-project'],
  },
  {
    id: 'vibe_coder',
    name: 'Vibe Coder',
    description: "You see the product clearly, even if you can't write the code. You work through your agent the way a director works through a crew — knowing what to build is the hard part; making it is delegation.",
    traits: ['Product-minded', 'Vision-driven', 'Delegation-first', 'Business-language', 'Boundary-setter'],
  },
  {
    id: 'indie_hacker',
    name: 'Indie Hacker',
    description: "Solo, speed-obsessed, revenue-pragmatic. Every decision is measured against one question: does this get us closer to paying users? You'd rather ship imperfect and iterate than polish in the dark.",
    traits: ['Revenue-focused', 'Ship-first', 'Solo operator', 'Pragmatic', 'Speed over polish'],
  },
  {
    id: 'craftsman',
    name: 'Craftsman',
    description: "Quality is not a stage — it's the whole thing. You care about how the code reads, how the architecture ages, and whether the next person can pick it up. Your agent is only useful if it respects the craft.",
    traits: ['Quality-focused', 'Pattern-enforcer', 'Architecture-aware', 'Test-driven', 'Long-term thinker'],
  },
  {
    id: 'team_lead',
    name: 'Team Lead',
    description: "You don't ship alone — you ship with people. Standards, consistency, and coordination matter more than any single feature. Your challenge is making sure agents and humans all follow the same patterns.",
    traits: ['Coordinator', 'Standards-setter', 'Process-owner', 'Delegation-expert', 'Consistency-gatekeeper'],
  },
  {
    id: 'explorer',
    name: 'Explorer',
    description: "You learn by mapping new territory. Research, analysis, understanding the space before committing. Your agent is a reading partner, a summariser, a memory you can interrogate — not a builder.",
    traits: ['Research-driven', 'Learning-focused', 'Curious', 'Synthesiser', 'Map-maker'],
  },
];

const ID_ORDER: UserArchetypeId[] = ['venture_builder', 'vibe_coder', 'indie_hacker', 'craftsman', 'team_lead', 'explorer'];
type Weights = [number, number, number, number, number, number];

/** Need at least 2 of (outcome, autonomy, cadence, audience) before we
 *  label someone. One signal is coincidence, not a pattern. */
function hasEnoughForUserArchetype(prefs: UserPreferences): boolean {
  let filled = 0;
  if (prefs.outcome) filled += 1;
  if (prefs.autonomy) filled += 1;
  if (prefs.cadence) filled += 1;
  if (prefs.audience) filled += 1;
  return filled >= 2;
}

export function detectUserArchetype(prefs: UserPreferences): UserArchetypeResult | null {
  if (!hasEnoughForUserArchetype(prefs)) return null;

  const scores: Record<UserArchetypeId, number> = {
    venture_builder: 0,
    vibe_coder: 0,
    indie_hacker: 0,
    craftsman: 0,
    team_lead: 0,
    explorer: 0,
  };

  const outcomeText = (prefs.outcome || '').toLowerCase();
  const signals: Array<{ fires: boolean; weights: Weights; name: string }> = [
    // --- Outcome keywords — the strongest signal because it's free text ----
    {
      // Portfolio / automation / systems-thinking
      name: 'outcome_automate_scale',
      fires: /automate|automation|pipeline|scale|portfolio|multi.*project|system|orchestrat|platform/.test(outcomeText),
      weights: [30, 0, 5, 0, 5, 0],
    },
    {
      // Revenue / ship / launch — indie signal
      name: 'outcome_revenue',
      fires: /revenue|mrr|profit|pricing|monetiz|ship.*fast|launch.*fast|sell|paying|customer.*acqui/.test(outcomeText),
      weights: [5, 5, 30, 0, 0, 0],
    },
    {
      // Build a product (no team mention) — vibe coder
      name: 'outcome_build_product',
      fires: /build|product|ship|launch|app|website|feature|byg|lancer/.test(outcomeText)
          && !/team|coordinat|automate|portfolio/.test(outcomeText),
      weights: [5, 25, 15, 0, 0, 0],
    },
    {
      // Quality / architecture / craft — craftsman
      name: 'outcome_quality',
      fires: /quality|clean.*code|refactor|architect|maintain|craft|best.*practice|pattern|kvalitet/.test(outcomeText),
      weights: [0, 0, 0, 30, 10, 0],
    },
    {
      // Team / coordinate — team lead
      name: 'outcome_team',
      fires: /team|coordinat|standard|shared|kollega|onboard.*team|process/.test(outcomeText),
      weights: [5, 0, 0, 5, 30, 0],
    },
    {
      // Research / learn / understand — explorer
      name: 'outcome_research',
      fires: /research|learn|understand|explain|analy|study|compare|map|forstå|lær|undersøg/.test(outcomeText),
      weights: [5, 5, 0, 0, 0, 30],
    },

    // --- Autonomy — what agent behaviour they want ---------------------------
    {
      name: 'autonomy_auto',
      fires: prefs.autonomy === 'auto',
      // Full delegation = venture builder, vibe coder, indie hacker (solo founders who can't micromanage)
      weights: [20, 20, 15, 0, 0, 5],
    },
    {
      name: 'autonomy_ask_risky',
      fires: prefs.autonomy === 'ask-risky',
      // Middle ground fits everyone — small bonus for balanced types
      weights: [5, 5, 10, 5, 5, 5],
    },
    {
      name: 'autonomy_ask_all',
      fires: prefs.autonomy === 'ask-all',
      // Wants oversight on every action = craftsman (picky about craft) or team lead (gatekeeper)
      weights: [0, 0, 0, 20, 15, 0],
    },

    // --- Cadence — how often agent works -----------------------------------
    {
      name: 'cadence_daily',
      fires: prefs.cadence === 'daily',
      // Daily automation = venture builder
      weights: [25, 0, 5, 0, 5, 5],
    },
    {
      name: 'cadence_weekly',
      fires: prefs.cadence === 'weekly',
      // Weekly rhythms = team coordination or research cycles
      weights: [5, 0, 0, 0, 15, 15],
    },
    {
      name: 'cadence_event',
      fires: prefs.cadence === 'event',
      // Event-driven = automation types
      weights: [15, 0, 10, 5, 5, 0],
    },
    {
      name: 'cadence_on_demand',
      fires: prefs.cadence === 'on-demand',
      // Hands-on = vibe coder or craftsman (both work interactively)
      weights: [0, 15, 5, 15, 0, 10],
    },

    // --- Audience — who sees the work --------------------------------------
    {
      name: 'audience_self',
      fires: prefs.audience === 'self',
      // Solo = venture builder, vibe coder, indie hacker, explorer
      weights: [15, 15, 20, 10, 0, 15],
    },
    {
      name: 'audience_team',
      fires: prefs.audience === 'team',
      // Team = team lead, possibly craftsman (shared codebase)
      weights: [0, 0, 0, 10, 30, 0],
    },
    {
      name: 'audience_customers',
      fires: prefs.audience === 'customers',
      // Customer-facing = indie hacker or vibe coder (shipping product)
      weights: [5, 15, 25, 0, 5, 0],
    },
  ];

  for (const s of signals) {
    if (!s.fires) continue;
    ID_ORDER.forEach((id, i) => {
      scores[id] += s.weights[i];
    });
  }

  const sorted = ID_ORDER
    .map(id => ({ id, score: scores[id] }))
    .sort((a, b) => b.score - a.score);

  const top = sorted[0];
  const runnerUp = sorted[1];

  const totalSignal = Object.values(scores).reduce((s, n) => s + n, 0);
  const confidence = totalSignal > 0
    ? Math.min(100, Math.round((top.score / totalSignal) * 300))
    : 0;

  const archetype = ARCHETYPES.find(a => a.id === top.id)!;

  return {
    detected: top.id,
    confidence,
    // Show runner-up if it's within 50% of primary — captures hybrids like
    // "Venture Builder with Vibe Coder traits". Tighter than 80% threshold
    // because onboarding gives coarse signal and most users ARE hybrids.
    runnerUp: runnerUp.score > top.score * 0.5 && runnerUp.score > 0 ? runnerUp.id : null,
    archetypeName: archetype.name,
    archetypeDescription: archetype.description,
    traits: archetype.traits,
    scores,
  };
}

/** Look up an archetype's display metadata by id. Used by the profile to
 *  render the runner-up's name without re-running detection. */
export function getUserArchetypeDefinition(id: UserArchetypeId): UserArchetypeDef {
  return ARCHETYPES.find(a => a.id === id) || ARCHETYPES[0];
}
