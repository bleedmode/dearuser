// agent-archetype-map — map the internal `PersonaId` (from persona-detector)
// to the user-facing "agent archetype" display. We deliberately use a
// different taxonomy for the agent than for the user so "You and me" feels
// like complementary roles rather than overlapping boxes.
//
// Internal PersonaId → display name
//   vibe_coder      → Creative Executor  (action-first, product builder)
//   senior_dev      → Precision Partner  (code reviewer, pattern enforcer)
//   indie_hacker    → Creative Executor  (same role at solo scale)
//   venture_studio  → System Architect   (meta-operator, portfolio runner)
//   team_lead       → Orchestrator       (coordinator of team and standards)
//
// The 6th agent archetype (Research Companion, Apprentice) lives in the
// user-facing copy but isn't yet detected — persona-detector needs a new
// signal group for those. For now: map what we detect, leave room to grow.

import type { PersonaId } from '../types.js';

export type AgentArchetypeId =
  | 'system_architect'
  | 'creative_executor'
  | 'precision_partner'
  | 'orchestrator'
  | 'research_companion'
  | 'apprentice';

export interface AgentArchetypeDisplay {
  id: AgentArchetypeId;
  name: string;
  description: string;
  traits: string[];
}

const ARCHETYPES: Record<AgentArchetypeId, AgentArchetypeDisplay> = {
  system_architect: {
    id: 'system_architect',
    name: 'System Architect',
    description: "I don't build products — I run the machine that builds them. A meta-operator across hooks, skills, and scheduled tasks, keeping the portfolio aligned while you focus on direction.",
    traits: ['Automation-first', 'Multi-project', 'Meta-operator', 'Systems thinker', 'Portfolio-aware'],
  },
  creative_executor: {
    id: 'creative_executor',
    name: 'Creative Executor',
    description: "I turn product ideas into working code. Action-first, fast to ship, opinionated about defaults. You bring the vision; I handle the how.",
    traits: ['Action-first', 'Fast-shipping', 'Product-focused', 'Opinionated defaults', 'Delegation-ready'],
  },
  precision_partner: {
    id: 'precision_partner',
    name: 'Precision Partner',
    description: "I care as much about the craft as you do. Code review, pattern enforcement, test-first thinking. A technical equal with different strengths — I bring speed and relentless attention, you bring judgment.",
    traits: ['Code-reviewer', 'Pattern-enforcer', 'Test-driven', 'Architecture-aware', 'Quality-focused'],
  },
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    description: "I keep the team — humans and agents — pulling in the same direction. Standards, handoffs, and consistency matter more than any single decision. Where you coordinate people, I coordinate agents.",
    traits: ['Coordinator', 'Standards-keeper', 'Handoff-manager', 'Consistency-gatekeeper', 'Process-aware'],
  },
  research_companion: {
    id: 'research_companion',
    name: 'Research Companion',
    description: "I'm a reading partner and a memory you can interrogate. I synthesise sources, track what we've learned, and surface connections across sessions. You explore; I keep the map.",
    traits: ['Synthesiser', 'Memory-keeper', 'Cross-referencer', 'Curiosity-partner', 'Map-builder'],
  },
  apprentice: {
    id: 'apprentice',
    name: 'Apprentice',
    description: "I'm still learning how you work. I watch, ask, and incorporate corrections — the more you teach me, the more useful I get. Starting simple so we build trust together.",
    traits: ['Feedback-driven', 'Learning', 'Cautious', 'Asks often', 'Building trust'],
  },
};

/**
 * Map the internal persona-detector id to the public-facing agent
 * archetype. Falls back to Apprentice if we don't recognise the id —
 * a fresh setup with weak signals should feel like "still learning"
 * rather than forced into one of the mature archetypes.
 */
export function mapPersonaToAgentArchetype(id: PersonaId | null | undefined): AgentArchetypeDisplay {
  switch (id) {
    case 'venture_studio': return ARCHETYPES.system_architect;
    case 'vibe_coder':     return ARCHETYPES.creative_executor;
    case 'indie_hacker':   return ARCHETYPES.creative_executor;
    case 'senior_dev':     return ARCHETYPES.precision_partner;
    case 'team_lead':      return ARCHETYPES.orchestrator;
    default:               return ARCHETYPES.apprentice;
  }
}

export function getAgentArchetypeDisplay(id: AgentArchetypeId): AgentArchetypeDisplay {
  return ARCHETYPES[id];
}
