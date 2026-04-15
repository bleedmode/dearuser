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

// ============================================================================
// Audit types — system coherence analysis
// ============================================================================

export type AuditArtifactType =
  | 'skill'
  | 'command'
  | 'scheduled_task'
  | 'hook'
  | 'mcp_server'
  | 'memory_file';

export type AuditFindingType =
  | 'orphan_job'
  | 'overlap'
  | 'missing_closure'
  | 'substrate_mismatch'
  | 'unregistered_mcp_tool'
  | 'unbacked_up_substrate';

/** A thing in the user's AI stack that can produce or consume data. */
export interface AuditArtifact {
  id: string;                 // stable identifier: `${type}:${name}`
  type: AuditArtifactType;
  name: string;               // frontmatter name or dir name
  path: string;               // absolute path to file
  description: string;        // frontmatter description or first line of prompt
  prompt: string;             // full prompt/content text
  metadata: {
    lastModified?: Date;
    size: number;
    frontmatter?: Record<string, string>;
    // For memory files: count of list-like structured entries
    entryCount?: number;
    // For memory files: does it look like a database? (dates, IDs, structured)
    structuredEntries?: boolean;
  };
}

/** Directed edge in the artifact graph. */
export interface AuditEdge {
  from: string;              // artifact id
  to: string;                // artifact id OR file path string
  type: 'produces' | 'consumes' | 'references' | 'similar_to';
  evidence: string;          // quote/path from source that justified the edge
}

export interface AuditGraph {
  nodes: AuditArtifact[];
  edges: AuditEdge[];
}

export interface AuditEvidence {
  source: string;            // artifact id or file path
  excerpt: string;
  kind: 'path' | 'quote' | 'stat';
}

export interface AuditFinding {
  id: string;                // stable, for feedback-tracking
  type: AuditFindingType;
  severity: GapSeverity;
  title: string;
  description: string;
  affectedArtifacts: string[]; // artifact ids
  evidence: AuditEvidence[];
  recommendation: string;
  why: string;               // why this matters (1-2 sentences)
}

export interface AuditReport {
  version: '1.0';
  generatedAt: string;
  scope: Scope;
  scanRoots: string[];
  graph: {
    nodeCount: number;
    edgeCount: number;
    byType: Record<AuditArtifactType, number>;
    closureRate: number | null; // % of produces-edges that have a consumer; null if no produces
  };
  findings: AuditFinding[];
  summary: {
    critical: number;
    recommended: number;
    niceToHave: number;
    byType: Record<AuditFindingType, number>;
  };
  feedback: {
    totalTracked: number;
    fixed: number;
    pending: number;
    dismissed: number;
    history: Array<{
      id: string;
      title: string;
      status: 'pending' | 'fixed' | 'dismissed';
      firstSeenAt: string;
      lastSeenAt: string;
    }>;
  };
}

// ============================================================================
// Git scanning — local .git activity signals
// ============================================================================

export interface GitSummary {
  totalScanned: number;
  active: number;       // commits in last 7 days
  stale: number;        // > 60 days since last commit
  reposWithRevertSignals: number;
  reposWithUncommittedPile: number; // ≥10 uncommitted files
  topActive: Array<{ name: string; path: string; commits7d: number; commits30d: number }>;
  topStale: Array<{ name: string; path: string; staleDays: number }>;
}

// ============================================================================
// Injection findings — prompt-injection surfaces in hooks/skills/MCP configs
// ============================================================================

export type InjectionCategory =
  | 'shell_unquoted_var'
  | 'user_input_to_bash'
  | 'eval_in_skill'
  | 'hook_missing_set_e'
  | 'mcp_shell_template'
  | 'arguments_to_sensitive_cmd';

export interface InjectionFinding {
  id: string;
  category: InjectionCategory;
  severity: GapSeverity;
  title: string;
  artifactId: string;
  artifactPath: string;
  excerpt: string;
  why: string;
  recommendation: string;
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
  /** Local git activity — populated when .git scanning is enabled. */
  git: GitSummary | null;
  /** Prompt-injection findings from static pattern-matching of hooks/skills/MCP. */
  injection: InjectionFinding[];
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

// ============================================================================
// Security report — output of the `security` tool
// ============================================================================

export type SecretCategory =
  | 'openai_key'
  | 'anthropic_key'
  | 'github_token'
  | 'stripe_key'
  | 'aws_key'
  | 'slack_token'
  | 'google_api_key'
  | 'supabase_key'
  | 'vercel_token'
  | 'private_key'
  | 'env_secret'
  | 'bearer_token';

export interface SecretFinding {
  id: string;
  category: SecretCategory;
  severity: GapSeverity;
  title: string;
  location: string;
  excerpt: string;
  lineNumber?: number;
  recommendation: string;
}

export type ConflictCategory =
  | 'prohibition_violated'
  | 'required_check_missing'
  | 'autonomy_mismatch';

export interface RuleConflict {
  id: string;
  category: ConflictCategory;
  severity: GapSeverity;
  title: string;
  claudeMdRule: string;
  claudeMdSource: string;
  conflictingArtifact: string;
  conflictingPath: string;
  excerpt: string;
  recommendation: string;
  why: string;
}

export interface SecurityReport {
  version: '1.0';
  generatedAt: string;
  scope: Scope;
  secrets: SecretFinding[];
  injection: InjectionFinding[];
  ruleConflicts: RuleConflict[];
  summary: {
    critical: number;
    recommended: number;
    niceToHave: number;
  };
}

