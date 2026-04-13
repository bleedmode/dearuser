// Feedback Tracker — tracks whether recommendations were implemented and their effect

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface TrackedRecommendation {
  id: string;
  type: 'claude_md_rule' | 'hook' | 'skill' | 'mcp_server';
  title: string;
  textSnippet: string;       // first 100 chars of the recommendation
  givenAt: string;            // ISO timestamp
  status: 'pending' | 'implemented' | 'ignored';
  scoreAtGiven: number;       // collaboration score when recommendation was given
  scoreAtCheck?: number;      // collaboration score at next check
  checkedAt?: string;
}

export interface FeedbackReport {
  totalRecommendations: number;
  implemented: number;
  ignored: number;
  pending: number;
  avgScoreImprovement: number | null;
  history: TrackedRecommendation[];
}

const TRACKER_DIR = join(homedir(), '.agent-wrapped');
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
    // Don't re-track if already tracked (by title match)
    if (existing.some(e => e.title === rec.title)) continue;

    existing.push({
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: rec.target.includes('hook') ? 'hook'
        : rec.target.includes('skill') ? 'skill'
        : rec.target.includes('mcp') ? 'mcp_server'
        : 'claude_md_rule',
      title: rec.title,
      textSnippet: rec.textBlock.slice(0, 100),
      givenAt: now,
      status: 'pending',
      scoreAtGiven: collaborationScore,
    });
  }

  saveTracker(existing);
}

/**
 * Check which recommendations have been implemented
 * by looking for their text in the user's CLAUDE.md and settings
 */
export function checkImplementation(
  claudeMdContent: string,
  settingsContent: string,
  currentScore: number
): FeedbackReport {
  const recs = loadTracker();
  const now = new Date().toISOString();

  for (const rec of recs) {
    if (rec.status !== 'pending') continue;

    // Check if recommendation text appears in CLAUDE.md or settings
    const searchText = rec.textSnippet.slice(0, 50).toLowerCase();
    const inClaudeMd = claudeMdContent.toLowerCase().includes(searchText);
    const inSettings = settingsContent.toLowerCase().includes(searchText);

    if (inClaudeMd || inSettings) {
      rec.status = 'implemented';
      rec.scoreAtCheck = currentScore;
      rec.checkedAt = now;
    } else {
      // If recommendation is older than 30 days and not implemented, mark as ignored
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

  // Calculate average score improvement for implemented recommendations
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
    history: recs.slice(-10), // last 10
  };
}
