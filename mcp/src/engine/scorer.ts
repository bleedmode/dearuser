// Scorer — calculates 7 category scores for collaboration quality
// IMPORTANT: Scores are based on best practices, NOT on whether the user's current setup exists.
// Having a section does NOT mean it's good. Having nothing means there's work to do.

import type { CategoryScore, ParseResult, ScanResult } from '../types.js';
import type { SessionAnalysis } from './session-analyzer.js';

type CategoryId = 'roleClarity' | 'communication' | 'autonomyBalance' | 'qualityStandards' | 'memoryHealth' | 'systemMaturity' | 'coverage';

interface ScoringResult {
  categories: Record<CategoryId, CategoryScore>;
  collaborationScore: number;
}

const WEIGHTS: Record<CategoryId, number> = {
  roleClarity: 0.15,
  communication: 0.10,
  autonomyBalance: 0.20,
  qualityStandards: 0.15,
  memoryHealth: 0.15,
  systemMaturity: 0.15,
  coverage: 0.10,
};

function scoreRoleClarity(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  // Basic: does a roles section exist?
  const hasRolesSection = parsed.sections.some(s => s.id === 'roles');
  if (hasRolesSection) present.push('Roles section exists');
  else missing.push('No roles section — agent doesn\'t know who does what');

  // Quality: are roles specific (not just "you are an agent")?
  const hasSpecificRoles = parsed.rules.some(r =>
    /\b(ceo|executor|product.?owner|tech.?lead|pair.?programmer)\b/i.test(r.text)
  );
  if (hasSpecificRoles) present.push('Specific role definitions (not generic)');
  else missing.push('Roles are generic or missing — "you are an agent" is not enough');

  // Best practice: scope boundaries defined?
  const hasScopeRules = parsed.rules.some(r =>
    /beyond.?scope|only.?what|ændr.?ikke|ud.?over|don'?t.?change|never.?modify/i.test(r.text)
  );
  if (hasScopeRules) present.push('Scope boundaries defined');
  else missing.push('No scope boundaries — agent may change things you didn\'t ask for (top friction source)');

  // Best practice: explicit "ask first" examples?
  const hasAskFirstExamples = parsed.rules.some(r =>
    r.type === 'ask_first' && r.text.length > 20
  );
  if (hasAskFirstExamples) present.push('Ask-first rules with specific examples');
  else missing.push('No specific ask-first examples — agent doesn\'t know your boundaries');

  // Best practice: does the user describe their technical level or role?
  // We accept either explicit skill level (senior/beginner/non-technical) OR
  // a concrete professional role that implies skill level (CEO, founder,
  // product owner, designer, engineer, etc.). Previously this check only
  // matched skill-level keywords and false-negatived on users who'd
  // defined their role clearly.
  const allText = parsed.rules.map(r => r.text).join('\n') + '\n' +
                  parsed.sections.map(s => s.content).join('\n');
  const hasSkillLevel = /\b(non.?technical|can'?t.?code|vibe.?cod|senior|junior|beginner|expert|novice)\b/i.test(allText);
  const hasRoleSignal = /\b(ceo|founder|cto|product.?owner|product.?manager|designer|engineer|developer|entrepreneur|indie.?hacker|tech.?lead|team.?lead|meta.?agent|executor)\b/i.test(allText);
  if (hasSkillLevel || hasRoleSignal) {
    present.push('User skill level / role indicated');
  } else {
    missing.push('Agent doesn\'t know your technical level or role — may over/under explain');
  }

  const score = Math.round((present.length / (present.length + missing.length)) * 100);
  return { score, weight: WEIGHTS.roleClarity, signalsPresent: present, signalsMissing: missing };
}

function scoreCommunication(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];
  const text = parsed.rules.map(r => r.text).join(' ') + parsed.sections.map(s => s.content).join(' ');

  // Language preference
  if (/\b(dansk|danish|english|spanish|language|sprog|respond in|svar på)\b/i.test(text)) present.push('Language preference set');
  else missing.push('No language preference — agent defaults to English');

  // Verbosity
  if (/\b(short|concise|brief|kort|klart|terse|verbose|detailed)\b/i.test(text)) present.push('Verbosity preference set');
  else missing.push('No verbosity preference — agent guesses how much to say');

  // Tone/style
  if (/\b(jargon|technical|analogi|business.?language|non.?technical|plain)\b/i.test(text)) present.push('Tone/style guidance');
  else missing.push('No tone guidance — agent may use jargon you don\'t understand');

  // Best practice: how to handle uncertainty
  if (/\b(unsure|uncertain|don'?t.?know|usikker|confidence)\b/i.test(text)) present.push('Uncertainty handling defined');
  else missing.push('No guidance on uncertainty — agent will guess confidently instead of asking');

  // Best practice: how to give feedback
  if (/\b(correct|feedback|mistake|fejl|rettelse)\b/i.test(text)) present.push('Feedback mechanism defined');
  else missing.push('No feedback guidance — agent doesn\'t know how you prefer to correct it');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);
  return { score, weight: WEIGHTS.communication, signalsPresent: present, signalsMissing: missing };
}

function scoreAutonomyBalance(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const doRules = parsed.rules.filter(r => r.type === 'do_autonomously').length;
  const askRules = parsed.rules.filter(r => r.type === 'ask_first').length;
  const suggestRules = parsed.rules.filter(r => r.type === 'suggest_only').length;
  const prohibitions = parsed.rules.filter(r => r.type === 'prohibition').length;
  const total = parsed.rules.length;

  if (doRules > 0) present.push(`${doRules} autonomous rules`);
  else missing.push('No autonomous action rules — agent asks about everything');

  if (askRules > 0) present.push(`${askRules} ask-first rules`);
  else missing.push('No ask-first rules — agent guesses what needs approval');

  if (suggestRules > 0) present.push(`${suggestRules} suggest-only rules`);
  else missing.push('No suggest-only rules — agent may implement things it should only mention');

  // Balance check
  let balanceScore = 30; // start lower than before
  if (total > 0) {
    const hasAllTiers = doRules > 0 && askRules > 0 && suggestRules > 0;
    if (hasAllTiers) balanceScore += 25;

    // Healthy prohibition ratio: 15-35% is ideal
    const prohibitionRatio = prohibitions / total;
    if (prohibitionRatio >= 0.15 && prohibitionRatio <= 0.35) {
      balanceScore += 20;
      present.push('Healthy prohibition ratio (15-35%)');
    } else if (prohibitionRatio > 0.5) {
      balanceScore -= 10;
      missing.push('Over 50% of rules are prohibitions — may be over-restrictive');
    } else if (prohibitionRatio < 0.1 && total > 5) {
      missing.push('Very few prohibitions — agent has few guardrails');
    }

    // Best practice: are rules concrete (>20 chars) or too vague?
    const vagueRules = parsed.rules.filter(r => r.text.length < 20).length;
    if (vagueRules > total * 0.3) {
      missing.push(`${vagueRules} rules are very short (<20 chars) — may be too vague to follow`);
      balanceScore -= 10;
    } else {
      present.push('Rules are specific enough to follow');
      balanceScore += 5;
    }
  } else {
    missing.push('No rules defined at all — agent operates with zero guidance');
  }

  const score = Math.min(100, Math.max(0, balanceScore));
  return { score, weight: WEIGHTS.autonomyBalance, signalsPresent: present, signalsMissing: missing };
}

function scoreQualityStandards(parsed: ParseResult, scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];
  const text = parsed.sections.map(s => s.content).join(' ') + parsed.rules.map(r => r.text).join(' ');

  // Hooks (automated quality gates)
  if (scan.hooksCount > 0) present.push(`${scan.hooksCount} hooks configured`);
  else missing.push('No hooks — no automated quality gates. Agent can ship broken code unchecked.');

  // Testing strategy
  if (/\b(test|jest|vitest|pytest|spec|tdd)\b/i.test(text)) present.push('Testing strategy mentioned');
  else missing.push('No testing strategy — bugs reach production');

  // Build verification
  if (/\b(build|compile|tsc|eslint|lint)\b/i.test(text)) present.push('Build/lint verification');
  else missing.push('No build verification — agent doesn\'t know if code compiles');

  // Definition of done
  if (/\b(done|kvalitet|quality|definition.?of.?done|complete|deploy)\b/i.test(text)) present.push('Definition of done exists');
  else missing.push('No definition of done — "done" is ambiguous');

  // Best practice: destructive command protection
  const hasDestructiveProtection = parsed.rules.some(r =>
    /rm -rf|force.?push|terraform.?destroy|drop.?table|destructive/i.test(r.text)
  );
  if (hasDestructiveProtection) present.push('Destructive command protection');
  else missing.push('No destructive command protection — rm -rf, force push, terraform destroy are unblocked');

  // Best practice: file protection (.env, secrets)
  const hasFileProtection = parsed.rules.some(r =>
    /\.env|secret|credential|password|api.?key|protected.?file/i.test(r.text)
  );
  if (hasFileProtection) present.push('Sensitive file protection');
  else missing.push('No sensitive file protection — .env and credentials are unguarded');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);
  return { score, weight: WEIGHTS.qualityStandards, signalsPresent: present, signalsMissing: missing };
}

function scoreMemoryHealth(parsed: ParseResult, scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const memCount = scan.memoryFiles.length;
  const feedbackCount = scan.memoryFiles.filter(m => m.path.includes('feedback_')).length;

  if (memCount > 5) present.push(`${memCount} memory files — good breadth`);
  else if (memCount > 0) present.push(`${memCount} memory files — but could be more comprehensive`);
  else missing.push('No memory files — agent forgets everything between sessions');

  if (feedbackCount > 3) present.push(`${feedbackCount} feedback memories — strong learning loop`);
  else if (feedbackCount > 0) present.push(`${feedbackCount} feedback memories — learning loop started`);
  else missing.push('No feedback memories — corrections are lost between sessions');

  if (parsed.learnings.length > 0) present.push(`${parsed.learnings.length} learnings documented`);
  else missing.push('No learnings section — past mistakes aren\'t documented');

  // Freshness
  const recentMemories = scan.memoryFiles.filter(m => {
    if (!m.lastModified) return false;
    const daysSince = (Date.now() - m.lastModified.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < 14;
  });

  if (recentMemories.length > 0) present.push(`${recentMemories.length} memories updated in last 2 weeks`);
  else if (memCount > 0) missing.push('No recently updated memories — knowledge may be stale');

  // Best practice: user profile exists?
  const hasUserProfile = scan.memoryFiles.some(m => m.path.includes('user_'));
  if (hasUserProfile) present.push('User profile in memory');
  else missing.push('No user profile — agent doesn\'t know who you are between sessions');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);
  return { score, weight: WEIGHTS.memoryHealth, signalsPresent: present, signalsMissing: missing };
}

function scoreSystemMaturity(scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  if (scan.hooksCount > 0) present.push(`${scan.hooksCount} hooks`);
  else missing.push('No hooks — manual quality gates only');

  if (scan.skillsCount > 0) present.push(`${scan.skillsCount} skills`);
  else missing.push('No skills — no reusable workflows packaged');

  if (scan.scheduledTasksCount > 0) present.push(`${scan.scheduledTasksCount} scheduled tasks`);
  else missing.push('No scheduled tasks — no automation running');

  if (scan.commandsCount > 0) present.push(`${scan.commandsCount} commands`);
  else missing.push('No custom commands');

  if (scan.mcpServersCount > 1) present.push(`${scan.mcpServersCount} MCP servers`);
  else if (scan.mcpServersCount === 1) present.push('1 MCP server — consider adding more for your use case');
  else missing.push('No MCP servers — missing tool integrations');

  // Score on a curve — but harder than before
  const totalArtifacts = scan.hooksCount + scan.skillsCount + scan.scheduledTasksCount + scan.commandsCount + scan.mcpServersCount;
  let score: number;
  if (totalArtifacts === 0) score = 5;
  else if (totalArtifacts <= 2) score = 20;
  else if (totalArtifacts <= 5) score = 40;
  else if (totalArtifacts <= 10) score = 60;
  else if (totalArtifacts <= 15) score = 75;
  else score = 85; // even 15+ doesn't get 100 — there's always room

  return { score, weight: WEIGHTS.systemMaturity, signalsPresent: present, signalsMissing: missing };
}

function scoreCoverage(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const canonicalSections = [
    { id: 'roles', label: 'Roles & responsibilities' },
    { id: 'autonomy', label: 'Autonomy levels (do/ask/suggest)' },
    { id: 'communication', label: 'Communication style' },
    { id: 'quality', label: 'Quality standards & definition of done' },
    { id: 'tech_stack', label: 'Tech stack' },
    { id: 'architecture', label: 'Project architecture' },
    { id: 'commands', label: 'Build/test/deploy commands' },
    { id: 'learnings', label: 'Learnings & known issues' },
    { id: 'workflow', label: 'Git/deploy workflow' },
    { id: 'north_star', label: 'Goals / north star' },
  ];

  const foundIds = new Set(parsed.sections.map(s => s.id));

  for (const section of canonicalSections) {
    if (foundIds.has(section.id)) present.push(section.label);
    else missing.push(`${section.label} — not documented`);
  }

  const score = Math.round((present.length / canonicalSections.length) * 100);
  return { score, weight: WEIGHTS.coverage, signalsPresent: present, signalsMissing: missing };
}

export function score(parsed: ParseResult, scan: ScanResult, session?: SessionAnalysis): ScoringResult {
  const categories: Record<CategoryId, CategoryScore> = {
    roleClarity: scoreRoleClarity(parsed),
    communication: scoreCommunication(parsed),
    autonomyBalance: scoreAutonomyBalance(parsed),
    qualityStandards: scoreQualityStandards(parsed, scan),
    memoryHealth: scoreMemoryHealth(parsed, scan),
    systemMaturity: scoreSystemMaturity(scan),
    coverage: scoreCoverage(parsed),
  };

  // Session-based adjustments: if we have session data, factor in actual friction
  if (session) {
    // High correction signals = lower autonomy balance score
    if (session.corrections.negationCount > 5) {
      categories.autonomyBalance.score = Math.max(0, categories.autonomyBalance.score - 15);
      categories.autonomyBalance.signalsMissing.push(
        `${session.corrections.negationCount} correction signals in recent prompts — friction is high`
      );
    }

    // Many short prompts = communication gap
    if (session.promptPatterns.totalPrompts > 10 && session.promptPatterns.shortPrompts > session.promptPatterns.totalPrompts * 0.5) {
      categories.communication.score = Math.max(0, categories.communication.score - 10);
      categories.communication.signalsMissing.push(
        `${Math.round(session.promptPatterns.shortPrompts / session.promptPatterns.totalPrompts * 100)}% of prompts are very short — may need prompting guidance`
      );
    }

    // Many /clear commands = context management issues
    if (session.promptPatterns.clearCommands > 3) {
      categories.systemMaturity.score = Math.max(0, categories.systemMaturity.score - 10);
      categories.systemMaturity.signalsMissing.push(
        `${session.promptPatterns.clearCommands} /clear commands — frequent context resets suggest session management issues`
      );
    }
  }

  // Weighted aggregate
  const collaborationScore = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score * cat.weight, 0)
  );

  return { categories, collaborationScore };
}
