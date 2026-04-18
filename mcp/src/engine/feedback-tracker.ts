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
export function trackRecommendations(
  recommendations: Array<{ title: string; textBlock: string; target: string; priority?: string }>,
  collaborationScore: number,
  agentRunId?: string,
): void {
  // Ensure JSON data is migrated
  migrateFromJson();

  for (const rec of recommendations) {
    // Skip if already tracked
    const existing = findRecommendationByTitle(rec.title);
    if (existing) continue;

    const type = rec.target.includes('hook') ? 'hook'
      : rec.target.includes('skill') ? 'skill'
      : rec.target.includes('mcp') ? 'mcp_server'
      : rec.target.includes('behavior') ? 'behavior'
      : 'claude_md_rule';

    insertRecommendation({
      agentRunId,
      type: type as any,
      title: rec.title,
      textSnippet: rec.textBlock.slice(0, 100),
      keywords: extractKeywords(rec.title + ' ' + rec.textBlock.slice(0, 200)),
      severity: (rec.priority as any) || 'recommended',
      scoreAtGiven: collaborationScore,
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

    insertRecommendation({
      agentRunId,
      type: dbType,
      title: tool.name,
      textSnippet: snippet.slice(0, 180),
      keywords: tool.solves || [],
      severity: 'recommended',
      scoreAtGiven: collaborationScore,
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
