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
  actionType: 'claude_md_append' | 'settings_merge' | 'shell_exec' | 'manual';
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
  | 'unbacked_up_substrate'
  | 'stale_schedule';

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
    // For scheduled tasks: last successful run, cron expression, and enabled flag
    // from Claude Code's scheduler state. Missing if state file couldn't be read.
    lastRunAt?: Date;
    cronExpression?: string;
    scheduledEnabled?: boolean;
    scheduledCreatedAt?: Date;
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
  /**
   * Shared prefix when this finding is part of a same-suite cluster
   * (e.g. 3+ artifacts named "dearuser-*"). Renderers collapse these
   * into a single "safe to ignore" notice instead of listing each pair.
   */
  suitePrefix?: string;
}

export interface AuditReport {
  /** DB row id — set by runAudit, used by index.ts to persist the rendered report for the dashboard. */
  _agentRunId?: string;
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
  /** 0-100 system-health score, same shape as the other scorers. */
  systemHealthScore: number;
  /** Per-category breakdown for the dashboard. */
  categories: {
    jobIntegrity: CategoryScore;
    artifactOverlap: CategoryScore;
    dataClosure: CategoryScore;
    configHealth: CategoryScore;
    substrateHealth: CategoryScore;
  };
  /** Projected ceiling — where you'd reach by fixing every current finding. */
  scoreCeiling: ScoreCeiling;
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
  owaspCategory?: OwaspAgenticCategory;
}

// ============================================================================
// Lint findings — CLAUDE.md quality checks
// ============================================================================

export type LintCheckId =
  // A. Instruction Quality (14)
  | 'generic_filler'
  | 'weak_imperative'
  | 'negative_only'
  | 'ambiguous_rule'
  | 'missing_rationale'
  | 'buried_critical_rule'
  | 'duplicate_rule'
  | 'rule_contradiction'
  | 'escape_hatch_missing'
  | 'compound_instruction'
  | 'naked_conditional'
  | 'mental_note'
  | 'ambiguous_pronoun'
  | 'compressible_padding'
  // B. Document Structure (9)
  | 'file_too_long'
  | 'long_section_no_headers'
  | 'empty_section'
  | 'redundant_stack_info'
  | 'readme_overlap'
  | 'unclosed_code_block'
  | 'section_balance'
  | 'missing_update_date'
  | 'priority_signal_missing'
  // C. References & Paths (7)
  | 'broken_file_ref'
  | 'broken_markdown_link'
  | 'hardcoded_user_path'
  | 'stale_tool_ref'
  | 'stale_tool_ref_reverse'
  | 'dead_command_ref'
  | 'wrong_abstraction'
  // D. Memory Quality (6)
  | 'memory_stale'
  | 'memory_orphan'
  | 'memory_index_orphan'
  | 'memory_too_large'
  | 'memory_duplicate'
  | 'memory_missing_frontmatter'
  // E. Hook Quality (5)
  | 'hook_dangerous_command'
  | 'hook_missing_condition'
  | 'hook_unquoted_variable'
  | 'hook_no_timeout'
  | 'hook_stale_tool_ref'
  // F. Skill Quality (5)
  | 'skill_missing_frontmatter'
  | 'skill_vague_name'
  | 'skill_prompt_too_short'
  | 'skill_unrestricted_bash'
  | 'skill_dangerous_name_no_guard'
  // G. Completeness (4)
  | 'missing_verification'
  | 'missing_error_handling'
  | 'missing_handoff_protocol'
  | 'cognitive_blueprint_gap';

export interface LintFinding {
  id: string;
  check: LintCheckId;
  severity: GapSeverity;
  title: string;
  description: string;
  file: string;
  line?: number;
  excerpt: string;
  fix?: string;
}

export interface LintSummary {
  totalChecks: number;
  totalFindings: number;
  bySeverity: { critical: number; recommended: number; nice_to_have: number };
  byCheck: Partial<Record<LintCheckId, number>>;
}

/**
 * Where a user would reach if they implemented every current recommendation.
 * Computed by engine/ceiling-scorer — kept here so consumers (dashboard,
 * share-page) can show the ceiling alongside the current score.
 */
export interface ScoreCeiling {
  currentScore: number;
  ceilingScore: number;
  delta: number;
  byCategory: Record<string, {
    current: number;
    ceiling: number;
    delta: number;
    cap?: { cap: number; reason: string };
  }>;
  /** Plain-language reasons why 100 may be structurally unreachable. */
  unreachable: string[];
  /** One-sentence summary for the report header. */
  summary: string;
}

export interface AnalysisReport {
  /** DB row id — set by runAnalysis, used by index.ts to persist the rendered report for the dashboard. */
  _agentRunId?: string;
  version: '2.0';
  generatedAt: string;
  scanRoot: string;
  scope: Scope;
  projectsObserved: number;
  installedServers: string[];
  /** Skill names discovered in ~/.claude/skills/ — used for dedup in recommendations. */
  installedSkills: string[];
  persona: PersonaResult;
  collaborationScore: number;
  /** Projected ceiling the user reaches if they implement every current recommendation. */
  scoreCeiling: ScoreCeiling;
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
  /** CLAUDE.md lint findings — instruction quality checks. */
  lint: LintSummary & { findings: LintFinding[] };
  /** Tool-catalog suggestions — MCP servers, hooks, skills, GitHub repos. Typed
   *  loosely here to avoid a circular import from templates/tool-catalog. */
  toolRecs: Array<{
    name: string;
    type: 'mcp_server' | 'skill' | 'github_repo' | 'hook';
    description: string;
    userFriendlyDescription?: string;
    stars?: number;
    install: string;
    whoActs?: string;
    solves?: string[];
    personas?: string[];
  }>;
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
// OWASP Agentic AI Top 10 (2025/2026)
// ============================================================================

export type OwaspAgenticCategory =
  | 'ASI-01'   // Agent Goal Hijack
  | 'ASI-02'   // Insecure Tool Design
  | 'ASI-03'   // Identity & Privilege Abuse
  | 'ASI-04'   // Insecure Supply Chain
  | 'ASI-05'   // Tool Misuse
  | 'ASI-06'   // Memory & Context Poisoning
  | 'ASI-07'   // Insecure Inter-Agent Communication
  | 'ASI-08'   // Cascading Failures
  | 'ASI-09'   // Human-Agent Trust Exploitation
  | 'ASI-10';  // Rogue Agents

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
  owaspCategory?: OwaspAgenticCategory;
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
  owaspCategory?: OwaspAgenticCategory;
}

/** A finding from an external platform advisor (Supabase, GitHub, npm, Vercel). */
export interface PlatformAdvisorFinding {
  id: string;
  platform: 'supabase' | 'github' | 'npm' | 'vercel';
  projectName: string; // e.g. "pvs", "rock-identifier"
  projectRef?: string; // platform-specific ref (Supabase project ref, GitHub repo slug, etc.)
  severity: GapSeverity;
  title: string;
  category: string; // e.g. "rls_disabled", "dependabot_alert", "outdated_dep"
  detail: string; // short explanation of the finding
  fixUrl?: string; // direct link to platform dashboard to fix
  recommendation: string;
  owaspCategory?: OwaspAgenticCategory;
}

/** A finding for a known CVE in Claude Code configuration. */
export interface CveFinding {
  id: string;
  cveId: string;
  cvssScore: number;
  severity: GapSeverity;
  title: string;
  description: string;
  location: string;
  excerpt: string;
  owaspCategory: OwaspAgenticCategory;
  recommendation: string;
}

/** Status of each platform advisor lookup. Surfaced so users know what was/wasn't scanned. */
export interface PlatformAdvisorStatus {
  platform: 'supabase' | 'github' | 'npm' | 'vercel';
  status: 'ok' | 'skipped' | 'error';
  projectsScanned: number;
  reason?: string; // e.g. "no auth token", "API timeout"
}

export interface SecurityReport {
  /** DB row id — set by runSecurity, used by index.ts to persist the rendered report for the dashboard. */
  _agentRunId?: string;
  version: '1.2';
  generatedAt: string;
  scope: Scope;
  secrets: SecretFinding[];
  injection: InjectionFinding[];
  ruleConflicts: RuleConflict[];
  cveFindings: CveFinding[];
  platformFindings: PlatformAdvisorFinding[];
  platformStatus: PlatformAdvisorStatus[];
  /** 0-100 security score, same shape as collaboration score. */
  securityScore: number;
  /** Per-category breakdown that powers the score. */
  categories: {
    secretSafety: CategoryScore;
    injectionResistance: CategoryScore;
    ruleIntegrity: CategoryScore;
    dependencySafety: CategoryScore;
    platformCompliance: CategoryScore;
  };
  /** Where the user would reach by fixing every current finding. */
  scoreCeiling: ScoreCeiling;
  summary: {
    critical: number;
    recommended: number;
    niceToHave: number;
  };
  owaspSummary: Partial<Record<OwaspAgenticCategory, number>>;
}

