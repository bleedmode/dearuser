// Feedback Tracker — tracks whether recommendations were implemented and their effect

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface TrackedRecommendation {
  id: string;
  type: 'claude_md_rule' | 'hook' | 'skill' | 'mcp_server';
  title: string;
  textSnippet: string;       // first 100 chars of the recommendation
  keywords?: string[];        // extracted at tracking time for semantic matching
  givenAt: string;            // ISO timestamp
  status: 'pending' | 'implemented' | 'ignored';
  scoreAtGiven: number;       // collaboration score when recommendation was given
  scoreAtCheck?: number;      // collaboration score at next check
  checkedAt?: string;
}

/** Context from the scanner for structural implementation checks. */
export interface ImplementationContext {
  installedServers?: string[];  // MCP server names from settings
  skillNames?: string[];        // skill directory names
  hooksCount?: number;          // total hooks in settings
}

export interface FeedbackReport {
  totalRecommendations: number;
  implemented: number;
  ignored: number;
  pending: number;
  avgScoreImprovement: number | null;
  history: TrackedRecommendation[];
}

const TRACKER_DIR = join(homedir(), '.dearuser');
const TRACKER_FILE = join(TRACKER_DIR, 'recommendations.json');

function ensureDir() {
  if (!existsSync(TRACKER_DIR)) {
    mkdirSync(TRACKER_DIR, { recursive: true });
  }
}

function loadTracker(): TrackedRecommendation[] {
  ensureDir();
  if (!existsSync(TRACKER_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TRACKER_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTracker(recs: TrackedRecommendation[]) {
  ensureDir();
  writeFileSync(TRACKER_FILE, JSON.stringify(recs, null, 2));
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
  // Deduplicate and take top 5 most distinctive (longest = likely most specific)
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length);
  return unique.slice(0, 5);
}

/**
 * Record new recommendations from an analysis run
 */
export function trackRecommendations(
  recommendations: Array<{ title: string; textBlock: string; target: string }>,
  collaborationScore: number
): void {
  const existing = loadTracker();
  const now = new Date().toISOString();

  for (const rec of recommendations) {
    if (existing.some(e => e.title === rec.title)) continue;

    existing.push({
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: rec.target.includes('hook') ? 'hook'
        : rec.target.includes('skill') ? 'skill'
        : rec.target.includes('mcp') ? 'mcp_server'
        : 'claude_md_rule',
      title: rec.title,
      textSnippet: rec.textBlock.slice(0, 100),
      keywords: extractKeywords(rec.title + ' ' + rec.textBlock.slice(0, 200)),
      givenAt: now,
      status: 'pending',
      scoreAtGiven: collaborationScore,
    });
  }

  saveTracker(existing);
}

/**
 * Type-aware implementation check. Uses structural context when available
 * (e.g., installed MCP servers, skill directories) rather than relying solely
 * on brittle substring matching.
 */
export function checkImplementation(
  claudeMdContent: string,
  settingsContent: string,
  currentScore: number,
  context?: ImplementationContext
): FeedbackReport {
  const recs = loadTracker();
  const now = new Date().toISOString();
  const claudeLower = claudeMdContent.toLowerCase();
  const settingsLower = settingsContent.toLowerCase();

  for (const rec of recs) {
    if (rec.status !== 'pending') continue;

    let detected = false;

    switch (rec.type) {
      case 'mcp_server': {
        // Structural check: is an MCP server with a matching name installed?
        if (context?.installedServers) {
          const titleWords = rec.title.toLowerCase().split(/\s+/);
          detected = context.installedServers.some(server =>
            titleWords.some(w => w.length > 3 && server.toLowerCase().includes(w))
          );
        }
        // Fallback: keyword match in settings
        if (!detected) detected = keywordMatch(rec, settingsLower);
        break;
      }

      case 'skill': {
        // Structural check: does a matching skill directory exist?
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
        // Keyword match against settings (hooks live there)
        detected = keywordMatch(rec, settingsLower);
        break;
      }

      case 'claude_md_rule':
      default: {
        // Substring match (legacy) + keyword match (new)
        const searchText = rec.textSnippet.slice(0, 50).toLowerCase();
        detected = claudeLower.includes(searchText) || settingsLower.includes(searchText);
        if (!detected) detected = keywordMatch(rec, claudeLower);
        // Fallback: if title mentions MCP/server/hook/skill, try structural checks too
        // (handles recs tracked with wrong type before type-aware logic existed)
        if (!detected && context) {
          const titleLower = rec.title.toLowerCase().replace(/[`'"]/g, '');
          if ((titleLower.includes('mcp') || titleLower.includes('server')) && context.installedServers) {
            // Extract clean words from title — strip punctuation, file extensions
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
      rec.status = 'implemented';
      rec.scoreAtCheck = currentScore;
      rec.checkedAt = now;
    } else {
      const ageMs = Date.now() - new Date(rec.givenAt).getTime();
      if (ageMs > 30 * 24 * 60 * 60 * 1000) {
        rec.status = 'ignored';
        rec.checkedAt = now;
      }
    }
  }

  saveTracker(recs);

  const implemented = recs.filter(r => r.status === 'implemented');
  const ignored = recs.filter(r => r.status === 'ignored');
  const pending = recs.filter(r => r.status === 'pending');

  let avgImprovement: number | null = null;
  const withScores = implemented.filter(r => r.scoreAtCheck !== undefined);
  if (withScores.length > 0) {
    const totalImprovement = withScores.reduce((sum, r) => sum + ((r.scoreAtCheck || 0) - r.scoreAtGiven), 0);
    avgImprovement = Math.round(totalImprovement / withScores.length);
  }

  return {
    totalRecommendations: recs.length,
    implemented: implemented.length,
    ignored: ignored.length,
    pending: pending.length,
    avgScoreImprovement: avgImprovement,
    history: recs.slice(-10),
  };
}

/** Check if 2+ of a recommendation's keywords appear in the content. */
function keywordMatch(rec: TrackedRecommendation, content: string): boolean {
  const keywords = rec.keywords;
  if (!keywords || keywords.length === 0) return false;
  const matches = keywords.filter(kw => content.includes(kw));
  return matches.length >= 2;
}
