// Scorer — calculates 7 category scores for collaboration quality

import type { CategoryScore, ParseResult, ScanResult } from '../types.js';

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

  const hasRolesSection = parsed.sections.some(s => s.id === 'roles');
  const hasAutonomySection = parsed.sections.some(s => s.id === 'autonomy');
  const hasScopeRules = parsed.rules.some(r =>
    /beyond.?scope|only.?what|ændr.?ikke|ud.?over/i.test(r.text)
  );
  const hasRoleDefinitions = parsed.rules.some(r =>
    /\b(ceo|executor|agent|meta|owner|developer)\b/i.test(r.text)
  );

  if (hasRolesSection) present.push('Roles section defined');
  else missing.push('No roles section');

  if (hasAutonomySection) present.push('Autonomy levels defined');
  else missing.push('No autonomy levels');

  if (hasScopeRules) present.push('Scope boundaries set');
  else missing.push('No scope boundaries');

  if (hasRoleDefinitions) present.push('Role definitions present');
  else missing.push('No explicit role definitions');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);

  return { score, weight: WEIGHTS.roleClarity, signalsPresent: present, signalsMissing: missing };
}

function scoreCommunication(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const text = parsed.rules.map(r => r.text).join(' ') + parsed.sections.map(s => s.content).join(' ');

  if (/\b(dansk|danish|english|spanish|language|sprog)\b/i.test(text)) present.push('Language preference set');
  else missing.push('No language preference');

  if (/\b(short|concise|brief|kort|klart|terse)\b/i.test(text)) present.push('Verbosity preference set');
  else missing.push('No verbosity preference');

  if (/\b(jargon|technical|analogi|business.?language|non.?technical)\b/i.test(text)) present.push('Tone/style defined');
  else missing.push('No tone/style guidance');

  if (/\b(emoji|markdown|format|code.?block)\b/i.test(text)) present.push('Format preferences set');
  else missing.push('No format preferences');

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
  else missing.push('No autonomous action rules');

  if (askRules > 0) present.push(`${askRules} ask-first rules`);
  else missing.push('No ask-first rules');

  if (suggestRules > 0) present.push(`${suggestRules} suggest-only rules`);
  else missing.push('No suggest-only rules');

  // Check balance — ideal is roughly 40/35/25 split, not all prohibitions
  let balanceScore = 50; // baseline
  if (total > 0) {
    const hasAllTiers = doRules > 0 && askRules > 0 && suggestRules > 0;
    if (hasAllTiers) balanceScore += 30;
    const prohibitionRatio = prohibitions / total;
    if (prohibitionRatio < 0.5) balanceScore += 20;
    else balanceScore -= 10;
  }

  const score = Math.min(100, Math.max(0, balanceScore));

  return { score, weight: WEIGHTS.autonomyBalance, signalsPresent: present, signalsMissing: missing };
}

function scoreQualityStandards(parsed: ParseResult, scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  if (scan.hooksCount > 0) present.push(`${scan.hooksCount} hooks configured`);
  else missing.push('No hooks (automated quality gates)');

  const text = parsed.sections.map(s => s.content).join(' ') + parsed.rules.map(r => r.text).join(' ');

  if (/\b(test|jest|vitest|pytest|spec)\b/i.test(text)) present.push('Testing mentioned');
  else missing.push('No testing strategy');

  if (/\b(build|compile|tsc|eslint|lint)\b/i.test(text)) present.push('Build/lint verification');
  else missing.push('No build verification');

  if (/\b(done|kvalitet|quality|definition.?of.?done|complete)\b/i.test(text)) present.push('Definition of done');
  else missing.push('No definition of done');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);

  return { score, weight: WEIGHTS.qualityStandards, signalsPresent: present, signalsMissing: missing };
}

function scoreMemoryHealth(parsed: ParseResult, scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const memCount = scan.memoryFiles.length;
  const feedbackCount = scan.memoryFiles.filter(m => m.path.includes('feedback_')).length;

  if (memCount > 0) present.push(`${memCount} memory files`);
  else missing.push('No memory files');

  if (feedbackCount > 0) present.push(`${feedbackCount} feedback memories (learning loop)`);
  else missing.push('No feedback memories');

  if (parsed.learnings.length > 0) present.push(`${parsed.learnings.length} learnings documented`);
  else missing.push('No learnings documented');

  // Check freshness — are memories recent?
  const recentMemories = scan.memoryFiles.filter(m => {
    if (!m.lastModified) return false;
    const daysSince = (Date.now() - m.lastModified.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince < 30;
  });

  if (recentMemories.length > 0) present.push(`${recentMemories.length} memories updated in last 30 days`);
  else if (memCount > 0) missing.push('No recently updated memories');

  const score = Math.round((present.length / (present.length + missing.length)) * 100);

  return { score, weight: WEIGHTS.memoryHealth, signalsPresent: present, signalsMissing: missing };
}

function scoreSystemMaturity(scan: ScanResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const artifacts = [
    { name: 'Hooks', count: scan.hooksCount },
    { name: 'Skills', count: scan.skillsCount },
    { name: 'Scheduled tasks', count: scan.scheduledTasksCount },
    { name: 'Commands', count: scan.commandsCount },
    { name: 'MCP servers', count: scan.mcpServersCount },
  ];

  for (const a of artifacts) {
    if (a.count > 0) present.push(`${a.count} ${a.name.toLowerCase()}`);
    else missing.push(`No ${a.name.toLowerCase()}`);
  }

  // Score on a curve
  const totalArtifacts = artifacts.reduce((sum, a) => sum + a.count, 0);
  let score: number;
  if (totalArtifacts === 0) score = 10;
  else if (totalArtifacts <= 2) score = 30;
  else if (totalArtifacts <= 5) score = 50;
  else if (totalArtifacts <= 10) score = 70;
  else if (totalArtifacts <= 15) score = 85;
  else score = 95;

  return { score, weight: WEIGHTS.systemMaturity, signalsPresent: present, signalsMissing: missing };
}

function scoreCoverage(parsed: ParseResult): CategoryScore {
  const present: string[] = [];
  const missing: string[] = [];

  const canonicalSections = [
    'roles', 'autonomy', 'communication', 'quality',
    'tech_stack', 'architecture', 'commands', 'learnings',
    'workflow', 'north_star',
  ];

  const foundIds = new Set(parsed.sections.map(s => s.id));

  for (const id of canonicalSections) {
    if (foundIds.has(id)) present.push(id.replace('_', ' '));
    else missing.push(id.replace('_', ' '));
  }

  const score = Math.round((present.length / canonicalSections.length) * 100);

  return { score, weight: WEIGHTS.coverage, signalsPresent: present, signalsMissing: missing };
}

export function score(parsed: ParseResult, scan: ScanResult): ScoringResult {
  const categories: Record<CategoryId, CategoryScore> = {
    roleClarity: scoreRoleClarity(parsed),
    communication: scoreCommunication(parsed),
    autonomyBalance: scoreAutonomyBalance(parsed),
    qualityStandards: scoreQualityStandards(parsed, scan),
    memoryHealth: scoreMemoryHealth(parsed, scan),
    systemMaturity: scoreSystemMaturity(scan),
    coverage: scoreCoverage(parsed),
  };

  // Weighted aggregate
  const collaborationScore = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score * cat.weight, 0)
  );

  return { categories, collaborationScore };
}
