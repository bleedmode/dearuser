// archetype-display — minimal lookup tables for rendering archetype names
// on the public share page + wrapped slides. Astro build is independent of
// the MCP package, so we can't import engine/agent-archetype-map.ts
// directly; this file mirrors the names/descriptions instead.
//
// Keep in sync with:
//   mcp/src/engine/agent-archetype-map.ts    (agent-side display)
//   mcp/src/engine/user-archetype-detector.ts (user-side display)

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
  shortDescription: string;
}

const AGENT_ARCHETYPES: Record<AgentArchetypeId, AgentArchetypeDisplay> = {
  system_architect: {
    id: 'system_architect',
    name: 'System Architect',
    shortDescription: 'A meta-operator running automation across the portfolio.',
  },
  creative_executor: {
    id: 'creative_executor',
    name: 'Creative Executor',
    shortDescription: 'Turns product ideas into working code. Action-first.',
  },
  precision_partner: {
    id: 'precision_partner',
    name: 'Precision Partner',
    shortDescription: 'Code reviewer and pattern enforcer. Cares about craft.',
  },
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    shortDescription: 'Coordinates team and standards across humans and agents.',
  },
  research_companion: {
    id: 'research_companion',
    name: 'Research Companion',
    shortDescription: 'A reading partner and memory you can interrogate.',
  },
  apprentice: {
    id: 'apprentice',
    name: 'Apprentice',
    shortDescription: 'Learning how you work — feedback-driven, asks often.',
  },
};

/**
 * Map the internal MCP `PersonaId` onto the agent-side archetype display.
 * Mirrors `mapPersonaToAgentArchetype` from mcp/src/engine/agent-archetype-map.ts.
 */
export function mapPersonaToAgentArchetype(id: string | null | undefined): AgentArchetypeDisplay {
  switch (id) {
    case 'venture_studio': return AGENT_ARCHETYPES.system_architect;
    case 'vibe_coder':     return AGENT_ARCHETYPES.creative_executor;
    case 'indie_hacker':   return AGENT_ARCHETYPES.creative_executor;
    case 'senior_dev':     return AGENT_ARCHETYPES.precision_partner;
    case 'team_lead':      return AGENT_ARCHETYPES.orchestrator;
    default:               return AGENT_ARCHETYPES.apprentice;
  }
}
