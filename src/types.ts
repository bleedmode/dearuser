// Agent Wrapped — Core types

export type PersonaId = 'vibe_coder' | 'senior_dev' | 'indie_hacker' | 'venture_studio' | 'team_lead';

export type RuleType = 'do_autonomously' | 'ask_first' | 'suggest_only' | 'prohibition';

export type FrictionTheme = 'scope_creep' | 'communication' | 'quality' | 'autonomy' | 'tooling' | 'process';

export type GapSeverity = 'critical' | 'recommended' | 'nice_to_have';

export interface ScanResult {
  globalClaudeMd: FileInfo | null;
  projectClaudeMd: FileInfo | null;
  memoryFiles: FileInfo[];
  settingsFiles: FileInfo[];
  hooksCount: number;
  skillsCount: number;
  scheduledTasksCount: number;
  commandsCount: number;
  mcpServersCount: number;
  competingFormats: { cursorrules: boolean; agentsMd: boolean; copilotInstructions: boolean };
}

export interface FileInfo {
  path: string;
  content: string;
  size: number;
  lastModified?: Date;
}

export interface ParsedRule {
  text: string;
  type: RuleType;
  source: string; // file path
}

export interface ParsedSection {
  id: string;
  header: string;
  content: string;
  source: string;
}

export interface ParseResult {
  rules: ParsedRule[];
  sections: ParsedSection[];
  learnings: string[];
  projectCount: number;
}

export interface PersonaResult {
  detected: PersonaId;
  confidence: number;
  runnerUp: PersonaId | null;
  archetypeName: string;
  archetypeDescription: string;
  traits: string[];
  scores: Record<PersonaId, number>;
}

export interface CategoryScore {
  score: number;
  weight: number;
  signalsPresent: string[];
  signalsMissing: string[];
}

export interface FrictionPattern {
  rank: number;
  title: string;
  description: string;
  evidence: string[];
  theme: FrictionTheme;
}

export interface Gap {
  id: string;
  section: string;
  severity: GapSeverity;
  personaRelevance: string;
}

export interface Recommendation {
  priority: GapSeverity;
  title: string;
  description: string;
  textBlock: string;
  target: 'global_claude_md' | 'project_claude_md' | 'settings' | 'hook' | 'skill';
  placementHint: string;
}

export interface AnalysisStats {
  totalRules: number;
  doRules: number;
  askRules: number;
  suggestRules: number;
  prohibitionRules: number;
  prohibitionRatio: number;
  totalLearnings: number;
  memoryFiles: number;
  feedbackMemories: number;
  hooksCount: number;
  skillsCount: number;
  scheduledTasksCount: number;
  commandsCount: number;
  mcpServersCount: number;
  projectsManaged: number;
}

export interface WrappedData {
  headlineStat: { value: string; label: string };
  topLesson: { quote: string; context: string } | null;
  autonomySplit: { doSelf: number; askFirst: number; suggest: number };
  archetype: { name: string; traits: string[]; description: string };
  systemGrid: { hooks: number; skills: number; scheduled: number; rules: number };
  shareCard: {
    corrections: number;
    memories: number;
    projects: number;
    prohibitionRatio: string;
  };
}

export interface AnalysisReport {
  version: '1.0';
  generatedAt: string;
  scanRoot: string;
  persona: PersonaResult;
  collaborationScore: number;
  categories: {
    roleClarity: CategoryScore;
    communication: CategoryScore;
    autonomyBalance: CategoryScore;
    qualityStandards: CategoryScore;
    memoryHealth: CategoryScore;
    systemMaturity: CategoryScore;
    coverage: CategoryScore;
  };
  frictionPatterns: FrictionPattern[];
  gaps: Gap[];
  stats: AnalysisStats;
  recommendations: Recommendation[];
  wrapped: WrappedData;
}
