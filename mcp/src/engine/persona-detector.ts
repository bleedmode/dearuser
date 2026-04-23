// Persona Detector — weighted signal scoring for persona classification

import type { PersonaId, PersonaResult, ParseResult, ScanResult } from '../types.js';
import type { UserPreferences } from './user-preferences.js';

interface PersonaDefinition {
  id: PersonaId;
  name: string;
  archetypeName: string;
  archetypeDescription: string;
  traits: string[];
}

const PERSONAS: PersonaDefinition[] = [
  {
    id: 'vibe_coder',
    name: 'Vibe Coder',
    archetypeName: 'The Visionary Pilot',
    archetypeDescription: 'You see the destination clearly but let your agent navigate the route. You think in products, not code. Your strength is knowing what to build — your agent\'s strength is knowing how.',
    traits: ['Product-minded', 'Delegation-first', 'Boundary-setter', 'Business-language', 'Vision-driven'],
  },
  {
    id: 'senior_dev',
    name: 'Senior Developer',
    archetypeName: 'The Precision Partner',
    archetypeDescription: 'You and your agent are equals with different strengths. You bring deep technical judgment, your agent brings speed and tireless attention to detail. Together you ship clean, tested code fast.',
    traits: ['Quality-focused', 'Code-reviewer', 'Pattern-enforcer', 'Test-driven', 'Architecture-aware'],
  },
  {
    id: 'indie_hacker',
    name: 'Indie Hacker',
    archetypeName: 'The Speed Builder',
    archetypeDescription: 'Ship first, polish later. You and your agent are a two-person startup moving at maximum velocity. Every decision is measured against one question: does this get us closer to revenue?',
    traits: ['Revenue-focused', 'Speed-obsessed', 'Pragmatic', 'Solo operator', 'Ship-first'],
  },
  {
    id: 'venture_studio',
    name: 'Venture Studio',
    archetypeName: 'The System Architect',
    archetypeDescription: 'You don\'t build products — you build the machine that builds products. Your agent is a meta-operator running an OS of hooks, skills, and scheduled tasks across a portfolio.',
    traits: ['Systems thinker', 'Multi-project', 'Automation-first', 'Portfolio-minded', 'Meta-operator'],
  },
  {
    id: 'team_lead',
    name: 'Team Lead',
    archetypeName: 'The Orchestrator',
    archetypeDescription: 'You coordinate multiple humans and agents into a coherent team. Your challenge is consistency — making sure everyone follows the same patterns and nobody steps on each other\'s work.',
    traits: ['Coordinator', 'Standards-setter', 'Process-owner', 'Delegation-expert', 'Quality-gatekeeper'],
  },
];

// Signal weights: [vibe_coder, senior_dev, indie_hacker, venture_studio, team_lead]
type SignalWeights = [number, number, number, number, number];

interface Signal {
  name: string;
  detect: (parsed: ParseResult, scan: ScanResult) => boolean;
  weights: SignalWeights;
}

const SIGNALS: Signal[] = [
  {
    name: 'role_separation',
    detect: (p) => {
      const text = p.sections.map(s => s.content + ' ' + s.header).join(' ').toLowerCase();
      return /\b(ceo|owner|executor|meta.?agent|roller)\b/.test(text);
    },
    weights: [30, 5, 10, 25, 15],
  },
  {
    name: 'three_autonomy_tiers',
    detect: (p) => {
      const sectionIds = new Set(p.sections.map(s => s.id));
      return sectionIds.has('autonomy') ||
        p.rules.some(r => r.type === 'do_autonomously') &&
        p.rules.some(r => r.type === 'ask_first') &&
        p.rules.some(r => r.type === 'suggest_only');
    },
    weights: [25, 5, 5, 20, 10],
  },
  {
    name: 'business_language_rules',
    detect: (p) => {
      const text = p.rules.map(r => r.text).join(' ');
      return /\b(dansk|danish|business.?analog|not?.?jargon|ikke?.?teknisk|brugerens?.sprog)\b/i.test(text);
    },
    weights: [25, 0, 5, 15, 5],
  },
  {
    name: 'quality_gates',
    detect: (_, s) => s.hooksCount > 0,
    weights: [5, 30, 10, 15, 25],
  },
  {
    name: 'code_style_rules',
    detect: (p) => {
      const text = p.rules.map(r => r.text).join(' ');
      return /\b(typescript|strict|eslint|prettier|lint|no.?any|import)\b/i.test(text);
    },
    weights: [2, 25, 5, 10, 20],
  },
  {
    name: 'deploy_automation',
    detect: (p, s) => {
      const text = p.sections.map(sec => sec.content).join(' ');
      return /\b(vercel|netlify|deploy|ci.?cd|github.?action|push.?prod)\b/i.test(text)
        || s.scheduledTasksCount > 0;
    },
    weights: [5, 10, 25, 15, 10],
  },
  {
    name: 'revenue_focus',
    detect: (p) => {
      const text = p.sections.map(s => s.content).join(' ') + p.rules.map(r => r.text).join(' ');
      return /\b(mrr|revenue|profit|margin|monetize|pricing|stripe|subscription)\b/i.test(text);
    },
    weights: [15, 0, 25, 20, 5],
  },
  {
    name: 'multi_project',
    detect: (p) => p.projectCount > 2,
    weights: [5, 5, 5, 30, 10],
  },
  {
    name: 'scheduled_tasks',
    detect: (_, s) => s.scheduledTasksCount >= 3,
    weights: [10, 5, 10, 25, 10],
  },
  {
    name: 'team_coordination',
    detect: (p) => {
      const text = p.rules.map(r => r.text).join(' ') + p.sections.map(s => s.content).join(' ');
      return /\b(team|shared|coordination|shared.?standard|code.?review|pr.?review)\b/i.test(text);
    },
    weights: [5, 10, 0, 10, 30],
  },
  {
    name: 'high_prohibition_ratio',
    detect: (p) => {
      if (p.rules.length === 0) return false;
      const prohibitions = p.rules.filter(r => r.type === 'prohibition').length;
      return (prohibitions / p.rules.length) > 0.3;
    },
    weights: [20, 15, 10, 15, 10],
  },
  {
    name: 'scope_creep_rules',
    detect: (p) => {
      const text = p.rules.map(r => r.text).join(' ');
      return /\b(beyond.?scope|only.?what.?asked|don'?t.?change|ændr.?ikke|ud.?over.?opgaven)\b/i.test(text);
    },
    weights: [25, 10, 5, 15, 5],
  },
  {
    name: 'mcp_servers',
    detect: (_, s) => s.mcpServersCount >= 2,
    weights: [5, 15, 10, 20, 15],
  },
  {
    name: 'memory_system',
    detect: (_, s) => s.memoryFiles.length >= 5,
    weights: [15, 5, 5, 20, 10],
  },
];

export function detectPersona(parsed: ParseResult, scan: ScanResult, prefs?: UserPreferences): PersonaResult {
  const scores: Record<PersonaId, number> = {
    vibe_coder: 0,
    senior_dev: 0,
    indie_hacker: 0,
    venture_studio: 0,
    team_lead: 0,
  };

  const personaOrder: PersonaId[] = ['vibe_coder', 'senior_dev', 'indie_hacker', 'venture_studio', 'team_lead'];

  for (const signal of SIGNALS) {
    if (signal.detect(parsed, scan)) {
      personaOrder.forEach((id, i) => {
        scores[id] += signal.weights[i];
      });
    }
  }

  // Preference-based signals — only fire when the user has actually completed
  // onboarding. Weights are lower than scan-derived signals so CLAUDE.md still
  // dominates when it exists; preferences bias the result when scan is thin.
  if (prefs) {
    const outcomeText = (prefs.outcome || '').toLowerCase();

    if (/revenue|mrr|profit|pricing|monetiz|ship.*fast|launch.*fast/.test(outcomeText)) {
      scores.indie_hacker += 15;
      scores.vibe_coder += 5;
    }
    if (/automate|automation|pipeline|portfolio|multi.*project|scale/.test(outcomeText)) {
      scores.venture_studio += 15;
    }
    if (/team|coordinat|standard|review/.test(outcomeText)) {
      scores.team_lead += 15;
    }
    if (/build|product|ship|launch/.test(outcomeText) && !/team/.test(outcomeText)) {
      scores.vibe_coder += 5;
      scores.indie_hacker += 5;
    }

    if (prefs.audience === 'team') {
      scores.team_lead += 15;
    }
    if (prefs.audience === 'customers') {
      scores.indie_hacker += 10;
      scores.vibe_coder += 5;
    }

    if (prefs.autonomy === 'auto') {
      scores.venture_studio += 10;
      scores.indie_hacker += 5;
    }
    if (prefs.autonomy === 'ask-all') {
      // Users who want to be asked at every step lean away from autonomous
      // personas — nudge toward senior_dev (hands-on) and team_lead (gatekeeper).
      scores.senior_dev += 5;
      scores.team_lead += 5;
    }
  }

  // Find top two
  const sorted = personaOrder
    .map(id => ({ id, score: scores[id] }))
    .sort((a, b) => b.score - a.score);

  const top = sorted[0];
  const runnerUp = sorted[1];

  // Confidence: how much the top outscores the runner-up (0-100)
  const maxPossible = SIGNALS.reduce((sum, s) => sum + Math.max(...s.weights), 0);
  const confidence = Math.min(100, Math.round((top.score / maxPossible) * 200));

  const persona = PERSONAS.find(p => p.id === top.id)!;

  return {
    detected: top.id,
    confidence,
    runnerUp: runnerUp.score > 0 ? runnerUp.id : null,
    archetypeName: persona.archetypeName,
    archetypeDescription: persona.archetypeDescription,
    traits: persona.traits,
    scores,
  };
}
