// Agent Wrapped — Core types

export type PersonaId = 'vibe_coder' | 'senior_dev' | 'indie_hacker' | 'venture_studio' | 'team_lead';

export type RuleType = 'do_autonomously' | 'ask_first' | 'suggest_only' | 'prohibition';

export type FrictionTheme = 'scope_creep' | 'communication' | 'quality' | 'autonomy' | 'tooling' | 'process';

export type GapSeverity = 'critical' | 'recommended' | 'nice_to_have';

export type Scope = 'global' | 'project';

export interface ScanResult {
  scope: Scope;
  scanRoots: string[]; // Directories actually scanned — useful for provenance
  globalClaudeMd: FileInfo | null;
  projectClaudeMd: FileInfo | null;
  memoryFiles: FileInfo[];
  settingsFiles: FileInfo[];
  hooksCount: number;
  skillsCount: number;
  scheduledTasksCount: number;
  commandsCount: number;
  mcpServersCount: number;
  /** Names of MCP servers the user already has installed (e.g. "context7", "playwright"). */
  installedServers: string[];
  competingFormats: { cursorrules: boolean; agentsMd: boolean; copilotInstructions: boolean };
  /** When scope='global': number of project directories observed in ~/.claude/projects/. */
  projectsObserved: number;
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

export type RecommendationAudience = 'agent' | 'user' | 'both';

export interface EvidenceItem {
  source: string; // e.g. "CLAUDE.md", "feedback_danish_responses.md", "session 2026-04-14"
  excerpt: string; // concrete quote or "missing: section X"
  kind: 'quote' | 'missing' | 'stat';
}

export interface Recommendation {
  priority: GapSeverity;
  audience: RecommendationAudience;
  title: string;
  description: string;
  textBlock: string;
  evidence: EvidenceItem[];
  target: 'global_claude_md' | 'project_claude_md' | 'settings' | 'hook' | 'skill' | 'behavior';
  placementHint: string;
  // User-coaching fields (only for audience === 'user' or 'both')
  why?: string;       // Why this hurts collaboration
  howItLooks?: string; // How it looks when done right (example dialog)
  practiceStep?: string; // "Try this next time" — concrete one-step exercise
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

export interface SessionData {
  stats: {
    totalSessions: number;
    totalMessages: number;
    avgSessionDuration: number;
    sessionsLast7Days: number;
    sessionsLast30Days: number;
    mostActiveProject: string | null;
    projectDistribution: Record<string, number>;
  };
  promptPatterns: {
    totalPrompts: number;
    avgPromptLength: number;
    shortPrompts: number;
    longPrompts: number;
    clearCommands: number;
    rewindCommands: number;
    promptsWithFilePaths: number;
    promptsWithErrorMessages: number;
  };
  corrections: {
    negationCount: number;
    revertSignals: number;
    frustrationSignals: number;
    examples: string[];
  };
}

export interface AnalysisReport {
  version: '2.0';
  generatedAt: string;
  scanRoot: string;
  scope: Scope;
  projectsObserved: number;
  installedServers: string[];
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
  session: SessionData;
  feedback: {
    totalRecommendations: number;
    implemented: number;
    ignored: number;
    pending: number;
    avgScoreImprovement: number | null;
    history: Array<{
      id: string;
      title: string;
      status: string;
      givenAt: string;
      scoreAtGiven: number;
      scoreAtCheck?: number;
    }>;
  };
}
