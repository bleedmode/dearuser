// Feedback Tracker — tracks whether recommendations were implemented and their effect
// Now backed by SQLite (du_recommendations table). JSON file is auto-migrated on first use.

import {
  getDb,
  migrateFromJson,
  insertRecommendation,
  findRecommendationByTitle,
  updateRecommendationStatus,
  getRecommendations,
} from './db.js';

export interface TrackedRecommendation {
  id: string;
  type: 'claude_md_rule' | 'hook' | 'skill' | 'mcp_server' | 'behavior';
  title: string;
  textSnippet: string;
  keywords?: string[];
  givenAt: string;
  status: 'pending' | 'implemented' | 'ignored';
  scoreAtGiven: number;
  scoreAtCheck?: number;
  checkedAt?: string;
}

/** Context from the scanner for structural implementation checks. */
export interface ImplementationContext {
  installedServers?: string[];
  skillNames?: string[];
  hooksCount?: number;
}

export interface FeedbackReport {
  totalRecommendations: number;
  implemented: number;
  ignored: number;
  pending: number;
  avgScoreImprovement: number | null;
  history: TrackedRecommendation[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'to', 'of',
  'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about',
  'that', 'this', 'these', 'those', 'it', 'its', 'not', 'but', 'and',
  'or', 'if', 'when', 'your', 'you', 'they', 'them', 'their', 'what',
  'which', 'who', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'same', 'than', 'too', 'very',
]);

/** Extract distinctive keywords from recommendation text for semantic matching. */
function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length);
  return unique.slice(0, 5);
}

/** Convert a DB row to TrackedRecommendation for backward compatibility. */
function rowToTracked(row: any): TrackedRecommendation {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    textSnippet: row.text_snippet || '',
    keywords: row.keywords ? JSON.parse(row.keywords) : undefined,
    givenAt: new Date(row.given_at).toISOString(),
    status: row.status === 'dismissed' ? 'ignored' : row.status,
    scoreAtGiven: row.score_at_given ?? 0,
    scoreAtCheck: row.score_at_check ?? undefined,
    checkedAt: row.checked_at ? new Date(row.checked_at).toISOString() : undefined,
  };
}

/**
 * Record new recommendations from an analysis run.
 */
// Derive the semantic type stored in du_recommendations.type from actionType.
// `type` drives reconciliation strategy (how we check if a rec is implemented).
// `manual` recs are behavioral — the user changes how they work, nothing in
// files changes. Everything else surfaces as file content we can grep for.
function typeFromActionType(actionType: string): string {
  return actionType === 'manual' ? 'behavior' : 'claude_md_rule';
}

export function trackRecommendations(
  recommendations: Array<{ title: string; textBlock: string; actionType: 'claude_md_append' | 'settings_merge' | 'shell_exec' | 'manual'; priority?: string }>,
  collaborationScore: number,
  agentRunId?: string,
): void {
  migrateFromJson();

  for (const rec of recommendations) {
    const existing = findRecommendationByTitle(rec.title);
    if (existing) continue;

    insertRecommendation({
      agentRunId,
      type: typeFromActionType(rec.actionType) as any,
      title: rec.title,
      textSnippet: rec.textBlock.slice(0, 100),
      keywords: extractKeywords(rec.title + ' ' + rec.textBlock.slice(0, 200)),
      severity: (rec.priority as any) || 'recommended',
      scoreAtGiven: collaborationScore,
      actionType: rec.actionType,
      actionData: rec.textBlock,
    });
  }
}

/**
 * Record tool-catalog suggestions (MCP servers, hooks, skills, GitHub repos)
 * so they show up in the dashboard's /forbedringer view alongside the text
 * recommendations. Before this, tool recs only lived in the rendered report
 * text — the user's "Forslag" page missed them entirely.
 */
export function trackToolRecommendations(
  toolRecs: Array<{
    name: string;
    type: 'mcp_server' | 'hook' | 'skill' | 'github_repo';
    description: string;
    userFriendlyDescription?: string;
    solves?: string[];
    install?: string;
  }>,
  collaborationScore: number,
  agentRunId?: string,
): void {
  for (const tool of toolRecs.slice(0, 5)) {
    const existing = findRecommendationByTitle(tool.name);
    if (existing) continue;

    // Our db.ts schema accepts only these types — map github_repo to skill
    // since it's typically a skill/hook template the user installs locally.
    const dbType: 'hook' | 'skill' | 'mcp_server' =
      tool.type === 'mcp_server' ? 'mcp_server'
      : tool.type === 'hook' ? 'hook'
      : 'skill';

    const snippet = tool.userFriendlyDescription || tool.description;

    // Map into the implementer's action_type vocabulary:
    // - mcp_server install string is a shell command → shell_exec
    // - hook install is a JSON snippet for settings.json → settings_merge
    // - skill/github_repo → manual (requires human judgment on install path)
    const actionType: 'shell_exec' | 'settings_merge' | 'manual' =
      tool.type === 'mcp_server' ? 'shell_exec'
      : tool.type === 'hook' ? 'settings_merge'
      : 'manual';

    insertRecommendation({
      agentRunId,
      type: dbType,
      title: tool.name,
      textSnippet: snippet.slice(0, 180),
      keywords: tool.solves || [],
      severity: 'recommended',
      scoreAtGiven: collaborationScore,
      actionType,
      actionData: tool.install,
    });
  }
}

/**
 * Security & health findings also become recommendations so Forslag is a
 * single pane across all three letter types. We skip nice_to_have to avoid
 * drowning out actionable items.
 */
type FindingLike = {
  title: string;
  severity?: 'critical' | 'recommended' | 'nice_to_have';
  recommendation?: string;
  // Optional subject hints we use to distinguish findings inside a group:
  projectName?: string;   // platform findings
  detail?: string;        // platform findings
  location?: string;      // secret/cve findings
  artifactPath?: string;  // injection findings
  conflictingPath?: string; // rule-conflict findings
  affectedArtifacts?: string[]; // audit findings
};

/**
 * Extract a short identifier that distinguishes one finding from another
 * with the same title (e.g. the table name for an RLS finding, the file path
 * for a secret). Falls back to empty string when nothing useful is present.
 */
function findingSubject(f: FindingLike): string {
  // Supabase-style findings have the distinguishing identifier (table name)
  // in either detail or recommendation, inconsistently. Check both. Skip
  // backtick matches that are just the projectName (those don't distinguish).
  const backtick = (s?: string) => {
    if (!s) return null;
    const matches = [...s.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    return matches.find(m => m !== f.projectName) || null;
  };
  const fromDetail = backtick(f.detail);
  if (fromDetail) return f.projectName ? `${f.projectName}/${fromDetail}` : fromDetail;
  const fromRec = backtick(f.recommendation);
  if (fromRec) return f.projectName ? `${f.projectName}/${fromRec}` : fromRec;
  if (f.projectName) return f.projectName;
  if (f.location) return f.location;
  if (f.artifactPath) return f.artifactPath;
  if (f.conflictingPath) return f.conflictingPath;
  if (f.affectedArtifacts && f.affectedArtifacts[0]) return f.affectedArtifacts[0];
  return '';
}

export function trackFindingsAsRecommendations(
  findings: FindingLike[],
  scoreAtGiven: number,
  agentRunId?: string,
): void {
  migrateFromJson();

  // Group by title first so a finding class that applies to N artifacts
  // becomes one card, not N near-identical cards.
  const groups = new Map<string, { first: FindingLike; subjects: string[] }>();
  for (const f of findings) {
    if (!f.title) continue;
    const severity = f.severity || 'recommended';
    if (severity === 'nice_to_have') continue;
    const subject = findingSubject(f);
    const entry = groups.get(f.title);
    if (entry) {
      if (subject && !entry.subjects.includes(subject)) entry.subjects.push(subject);
    } else {
      groups.set(f.title, { first: f, subjects: subject ? [subject] : [] });
    }
  }

  for (const [title, { first, subjects }] of groups) {
    if (findRecommendationByTitle(title)) continue;
    const count = subjects.length;
    const snippet = count > 1
      ? `${count} tilfælde: ${subjects.slice(0, 5).join(', ')}${subjects.length > 5 ? `, +${subjects.length - 5} mere` : ''}`
      : (first.recommendation || '').slice(0, 200);
    insertRecommendation({
      agentRunId,
      type: 'behavior',
      title,
      textSnippet: snippet,
      keywords: extractKeywords(title + ' ' + (first.recommendation || '')),
      severity: first.severity || 'recommended',
      scoreAtGiven,
      actionType: 'manual',
      actionData: first.recommendation,
    });
  }
}

/**
 * Type-aware implementation check. Uses structural context when available.
 */
export function checkImplementation(
  claudeMdContent: string,
  settingsContent: string,
  currentScore: number,
  context?: ImplementationContext,
): FeedbackReport {
  // Ensure JSON data is migrated
  migrateFromJson();

  const allRecs = getRecommendations();
  const claudeLower = claudeMdContent.toLowerCase();
  const settingsLower = settingsContent.toLowerCase();

  for (const row of allRecs) {
    if (row.status !== 'pending') continue;

    const rec = rowToTracked(row);
    let detected = false;

    switch (rec.type) {
      case 'mcp_server': {
        if (context?.installedServers) {
          const titleWords = rec.title.toLowerCase().split(/\s+/);
          detected = context.installedServers.some(server =>
            titleWords.some(w => w.length > 3 && server.toLowerCase().includes(w))
          );
        }
        if (!detected) detected = keywordMatch(rec, settingsLower);
        break;
      }
      case 'skill': {
        if (context?.skillNames) {
          const titleWords = rec.title.toLowerCase().split(/[\s/]+/);
          detected = context.skillNames.some(skill =>
            titleWords.some(w => w.length > 3 && skill.toLowerCase().includes(w))
          );
        }
        if (!detected) detected = keywordMatch(rec, claudeLower + ' ' + settingsLower);
        break;
      }
      case 'hook': {
        detected = keywordMatch(rec, settingsLower);
        break;
      }
      case 'claude_md_rule':
      case 'behavior':
      default: {
        const searchText = rec.textSnippet.slice(0, 50).toLowerCase();
        detected = claudeLower.includes(searchText) || settingsLower.includes(searchText);
        if (!detected) detected = keywordMatch(rec, claudeLower);
        if (!detected && context) {
          const titleLower = rec.title.toLowerCase().replace(/[`'"]/g, '');
          if ((titleLower.includes('mcp') || titleLower.includes('server')) && context.installedServers) {
            const titleWords = titleLower.split(/[\s./]+/).filter(w => w.length > 2);
            detected = context.installedServers.some(srv => {
              const srvLower = srv.toLowerCase();
              return titleWords.some(w => srvLower.includes(w) || w.includes(srvLower));
            });
          }
        }
        break;
      }
    }

    if (detected) {
      updateRecommendationStatus(row.id, 'implemented', currentScore);
    } else {
      const ageMs = Date.now() - row.given_at;
      if (ageMs > 30 * 24 * 60 * 60 * 1000) {
        updateRecommendationStatus(row.id, 'ignored');
      }
    }
  }

  // Build report from current DB state
  const updatedRecs = getRecommendations();
  const implemented = updatedRecs.filter((r: any) => r.status === 'implemented');
  const ignored = updatedRecs.filter((r: any) => r.status === 'ignored' || r.status === 'dismissed');
  const pending = updatedRecs.filter((r: any) => r.status === 'pending');

  let avgImprovement: number | null = null;
  const withScores = implemented.filter((r: any) => r.score_at_check != null);
  if (withScores.length > 0) {
    const totalImprovement = withScores.reduce((sum: number, r: any) =>
      sum + ((r.score_at_check || 0) - (r.score_at_given || 0)), 0);
    avgImprovement = Math.round(totalImprovement / withScores.length);
  }

  return {
    totalRecommendations: updatedRecs.length,
    implemented: implemented.length,
    ignored: ignored.length,
    pending: pending.length,
    avgScoreImprovement: avgImprovement,
    history: updatedRecs.slice(0, 10).map(rowToTracked),
  };
}

/** Check if 2+ of a recommendation's keywords appear in the content. */
function keywordMatch(rec: TrackedRecommendation, content: string): boolean {
  const keywords = rec.keywords;
  if (!keywords || keywords.length === 0) return false;
  const matches = keywords.filter(kw => content.includes(kw));
  return matches.length >= 2;
}
