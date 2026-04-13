// Gap Detector — finds missing sections and features based on detected persona

import type { Gap, GapSeverity, PersonaId, ParseResult, ScanResult } from '../types.js';

interface GapDefinition {
  id: string;
  section: string;
  check: (parsed: ParseResult, scan: ScanResult) => boolean;
  severity: Record<PersonaId, GapSeverity | null>; // null = not relevant
  relevance: Record<PersonaId, string>;
}

const GAP_DEFINITIONS: GapDefinition[] = [
  {
    id: 'missing_roles',
    section: 'Roles & Responsibilities',
    check: (p) => !p.sections.some(s => s.id === 'roles'),
    severity: {
      vibe_coder: 'critical',
      senior_dev: 'recommended',
      indie_hacker: 'recommended',
      venture_studio: 'critical',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'As a non-technical user, clear role separation prevents your agent from assuming you can handle technical decisions',
      senior_dev: 'Defining roles helps your agent understand when to defer to your expertise',
      indie_hacker: 'Role clarity helps your agent know when to ship fast vs when to check with you',
      venture_studio: 'Multi-project work requires clear agent-operator boundaries',
      team_lead: 'Teams need explicit role definitions to prevent overlap and confusion',
    },
  },
  {
    id: 'missing_autonomy',
    section: 'Autonomy Levels',
    check: (p) => !p.sections.some(s => s.id === 'autonomy'),
    severity: {
      vibe_coder: 'critical',
      senior_dev: 'recommended',
      indie_hacker: 'nice_to_have',
      venture_studio: 'critical',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'Without autonomy tiers, your agent won\'t know what to do independently vs what needs your approval',
      senior_dev: 'Autonomy levels help calibrate when your agent should ask vs act',
      indie_hacker: 'Speed requires your agent to act autonomously on most things — define the exceptions',
      venture_studio: 'Cross-project automation needs clear autonomy boundaries',
      team_lead: 'Teams need consistent autonomy rules across all agents',
    },
  },
  {
    id: 'missing_communication',
    section: 'Communication Style',
    check: (p) => !p.sections.some(s => s.id === 'communication'),
    severity: {
      vibe_coder: 'critical',
      senior_dev: 'nice_to_have',
      indie_hacker: 'nice_to_have',
      venture_studio: 'recommended',
      team_lead: 'recommended',
    },
    relevance: {
      vibe_coder: 'Your agent defaults to technical language — you need explicit rules for business-friendly communication',
      senior_dev: 'Communication style is usually implicit for technical users',
      indie_hacker: 'Keep it simple — your agent should match your speed and directness',
      venture_studio: 'Multiple stakeholders may need different communication styles',
      team_lead: 'Consistent communication norms across the team',
    },
  },
  {
    id: 'missing_quality',
    section: 'Quality Standards',
    check: (p, s) => !p.sections.some(sec => sec.id === 'quality') && s.hooksCount === 0,
    severity: {
      vibe_coder: 'recommended',
      senior_dev: 'critical',
      indie_hacker: 'recommended',
      venture_studio: 'critical',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'Automated quality gates catch errors before they reach you',
      senior_dev: 'Quality standards are your bread and butter — enforce them via hooks',
      indie_hacker: 'Ship fast but don\'t ship broken — basic quality gates save time',
      venture_studio: 'At scale, quality must be automated across all projects',
      team_lead: 'Quality standards must be consistent and enforced automatically',
    },
  },
  {
    id: 'no_hooks',
    section: 'Automated Hooks',
    check: (_, s) => s.hooksCount === 0,
    severity: {
      vibe_coder: 'recommended',
      senior_dev: 'critical',
      indie_hacker: 'nice_to_have',
      venture_studio: 'critical',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'Hooks act as guardrails — your agent can\'t accidentally break things',
      senior_dev: 'Hooks enforce quality gates automatically on every change',
      indie_hacker: 'A simple build hook prevents shipping broken code',
      venture_studio: 'Hooks are the foundation of systematic quality across projects',
      team_lead: 'Hooks ensure every team member\'s agent follows the same standards',
    },
  },
  {
    id: 'no_memory',
    section: 'Memory System',
    check: (_, s) => s.memoryFiles.length === 0,
    severity: {
      vibe_coder: 'critical',
      senior_dev: 'recommended',
      indie_hacker: 'nice_to_have',
      venture_studio: 'critical',
      team_lead: 'recommended',
    },
    relevance: {
      vibe_coder: 'Without memory, your agent forgets your corrections every session — you\'ll repeat yourself endlessly',
      senior_dev: 'Memory captures architectural decisions and code patterns between sessions',
      indie_hacker: 'Memory saves time by avoiding repeated mistakes',
      venture_studio: 'Cross-session memory is essential for multi-project coordination',
      team_lead: 'Shared memory helps new team members and agents onboard faster',
    },
  },
  {
    id: 'missing_tech_stack',
    section: 'Tech Stack',
    check: (p) => !p.sections.some(s => s.id === 'tech_stack'),
    severity: {
      vibe_coder: 'recommended',
      senior_dev: 'recommended',
      indie_hacker: 'recommended',
      venture_studio: 'recommended',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'Your agent needs to know which tools you\'re using to avoid suggesting wrong solutions',
      senior_dev: 'Tech stack documentation prevents wrong framework/library choices',
      indie_hacker: 'Keeps your agent aligned with your chosen tools',
      venture_studio: 'Standard stack decisions should be documented once and applied everywhere',
      team_lead: 'Tech stack consistency is critical for team coordination',
    },
  },
  {
    id: 'missing_learnings',
    section: 'Learnings & Patterns',
    check: (p) => !p.sections.some(s => s.id === 'learnings') && p.learnings.length === 0,
    severity: {
      vibe_coder: 'nice_to_have',
      senior_dev: 'recommended',
      indie_hacker: 'nice_to_have',
      venture_studio: 'critical',
      team_lead: 'recommended',
    },
    relevance: {
      vibe_coder: 'Documenting what worked and what didn\'t helps your agent improve over time',
      senior_dev: 'Learnings capture architectural decisions and their rationale',
      indie_hacker: 'Quick notes on what to avoid saves debugging time',
      venture_studio: 'Cross-project learnings are the compound advantage of a studio model',
      team_lead: 'Shared learnings prevent the team from repeating mistakes',
    },
  },
  {
    id: 'missing_north_star',
    section: 'North Star / Goals',
    check: (p) => !p.sections.some(s => s.id === 'north_star'),
    severity: {
      vibe_coder: 'recommended',
      senior_dev: 'nice_to_have',
      indie_hacker: 'critical',
      venture_studio: 'critical',
      team_lead: 'recommended',
    },
    relevance: {
      vibe_coder: 'Your agent should understand your business goals to make aligned decisions',
      senior_dev: 'Project goals help prioritize technical decisions',
      indie_hacker: 'Revenue targets drive every decision — your agent needs to know the number',
      venture_studio: 'Portfolio-level goals guide resource allocation across projects',
      team_lead: 'Team goals align everyone\'s agent toward the same outcomes',
    },
  },
  // === Skills gaps ===
  {
    id: 'no_learn_skill',
    section: 'Learning Skill (/learn)',
    check: (_, s) => s.skillsCount === 0 || !existsSkill('learn'),
    severity: {
      vibe_coder: 'critical',
      senior_dev: 'recommended',
      indie_hacker: 'recommended',
      venture_studio: 'critical',
      team_lead: 'critical',
    },
    relevance: {
      vibe_coder: 'Without a learn skill, corrections are lost between sessions — you\'ll repeat the same mistakes',
      senior_dev: 'Capturing session learnings prevents architectural knowledge loss',
      indie_hacker: 'Quick learning capture saves debugging the same issues repeatedly',
      venture_studio: 'Cross-session learnings are the compound advantage of working with an agent over time',
      team_lead: 'Team learnings must be captured and shared systematically',
    },
  },
  {
    id: 'no_ship_skill',
    section: 'Shipping Skill (/ship)',
    check: (_, s) => !existsSkill('ship'),
    severity: {
      vibe_coder: 'recommended',
      senior_dev: 'nice_to_have',
      indie_hacker: 'recommended',
      venture_studio: 'recommended',
      team_lead: 'nice_to_have',
    },
    relevance: {
      vibe_coder: 'A ship skill bundles build+test+commit+push into one safe command — fewer things to forget',
      senior_dev: 'You likely have your own workflow, but a ship skill standardizes it',
      indie_hacker: 'Ship fast with one command instead of 5 manual steps',
      venture_studio: 'Consistent shipping across all projects reduces errors',
      team_lead: 'Standardized shipping ensures team consistency',
    },
  },
  {
    id: 'no_standup_skill',
    section: 'Standup Skill (/standup)',
    check: (_, s) => !existsSkill('standup'),
    severity: {
      vibe_coder: 'nice_to_have',
      senior_dev: 'nice_to_have',
      indie_hacker: 'nice_to_have',
      venture_studio: 'recommended',
      team_lead: 'recommended',
    },
    relevance: {
      vibe_coder: 'A daily standup gives you context on where you left off',
      senior_dev: 'Useful for multi-project context switching',
      indie_hacker: 'Keeps you focused on what moves the needle',
      venture_studio: 'Essential for portfolio-level overview across all projects',
      team_lead: 'Team standup gives visibility into everyone\'s agent work',
    },
  },
];

function existsSkill(name: string): boolean {
  const { existsSync } = require('fs');
  const { join } = require('path');
  const { homedir } = require('os');
  return existsSync(join(homedir(), '.claude', 'skills', name, 'SKILL.md'));
}

export function detectGaps(parsed: ParseResult, scan: ScanResult, persona: PersonaId): Gap[] {
  const gaps: Gap[] = [];

  for (const def of GAP_DEFINITIONS) {
    const severity = def.severity[persona];
    if (severity === null) continue;
    if (!def.check(parsed, scan)) continue;

    gaps.push({
      id: def.id,
      section: def.section,
      severity,
      personaRelevance: def.relevance[persona],
    });
  }

  // Sort by severity
  const severityOrder: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  gaps.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return gaps;
}
