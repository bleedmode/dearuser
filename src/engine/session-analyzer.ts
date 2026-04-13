// Session Analyzer — extracts collaboration patterns from Claude Code session data

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SessionStats {
  totalSessions: number;
  totalMessages: number;
  avgSessionDuration: number; // minutes
  sessionsLast7Days: number;
  sessionsLast30Days: number;
  mostActiveProject: string | null;
  projectDistribution: Record<string, number>;
}

export interface PromptPatterns {
  totalPrompts: number;
  avgPromptLength: number;
  shortPrompts: number;  // under 20 chars
  longPrompts: number;   // over 500 chars
  clearCommands: number; // /clear usage
  rewindCommands: number;
  promptsWithFilePaths: number;
  promptsWithErrorMessages: number;
}

export interface CorrectionSignals {
  negationCount: number;  // "nej", "stop", "don't", "forkert", etc.
  revertSignals: number;  // "undo", "revert", "go back", etc.
  frustrationSignals: number; // "why", "again", "wrong", etc.
  examples: string[];     // top 5 correction examples
}

export interface SessionAnalysis {
  stats: SessionStats;
  promptPatterns: PromptPatterns;
  corrections: CorrectionSignals;
}

// Negation patterns across languages
const NEGATION_PATTERNS = [
  /\bnej\b/i, /\bstop\b/i, /\bdon'?t\b/i, /\bforkert\b/i, /\bikkeg?\b/i,
  /\baldrig\b/i, /\bnever\b/i, /\bwrong\b/i, /\bno[,.\s!]/i,
  /\bnot that\b/i, /\bnot what\b/i, /\bthat'?s not\b/i,
];

const REVERT_PATTERNS = [
  /\bundo\b/i, /\brevert\b/i, /\bgo back\b/i, /\bfortryd\b/i,
  /\brollback\b/i, /\brestore\b/i, /\bprevious\b/i,
];

const FRUSTRATION_PATTERNS = [
  /\bwhy did you\b/i, /\bagain\b/i, /\bstill wrong\b/i,
  /\bI (just|already) (said|told|asked)\b/i,
  /\bhvorfor\b/i, /\bstadig\b/i, /\bigen\b/i,
];

function parseSessionMetadata(claudeDir: string): SessionStats {
  const sessionsDir = join(claudeDir, 'sessions');
  const stats: SessionStats = {
    totalSessions: 0,
    totalMessages: 0,
    avgSessionDuration: 0,
    sessionsLast7Days: 0,
    sessionsLast30Days: 0,
    mostActiveProject: null,
    projectDistribution: {},
  };

  if (!existsSync(sessionsDir)) return stats;

  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      try {
        const content = readFileSync(join(sessionsDir, file), 'utf-8');
        const session = JSON.parse(content);
        stats.totalSessions++;

        if (session.startedAt) {
          const age = now - session.startedAt;
          if (age < sevenDays) stats.sessionsLast7Days++;
          if (age < thirtyDays) stats.sessionsLast30Days++;
        }

        if (session.cwd) {
          // Extract project name from path
          const parts = session.cwd.split('/');
          const project = parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
          stats.projectDistribution[project] = (stats.projectDistribution[project] || 0) + 1;
        }
      } catch { /* skip invalid files */ }
    }

    // Find most active project
    let maxCount = 0;
    for (const [project, count] of Object.entries(stats.projectDistribution)) {
      if (count > maxCount) {
        maxCount = count;
        stats.mostActiveProject = project;
      }
    }
  } catch { /* ignore */ }

  return stats;
}

function parsePromptHistory(claudeDir: string): PromptPatterns {
  const historyFile = join(claudeDir, 'history.jsonl');
  const patterns: PromptPatterns = {
    totalPrompts: 0,
    avgPromptLength: 0,
    shortPrompts: 0,
    longPrompts: 0,
    clearCommands: 0,
    rewindCommands: 0,
    promptsWithFilePaths: 0,
    promptsWithErrorMessages: 0,
  };

  if (!existsSync(historyFile)) return patterns;

  try {
    const content = readFileSync(historyFile, 'utf-8');
    const lines = content.trim().split('\n');
    let totalLength = 0;

    // Only analyze last 200 entries
    const recentLines = lines.slice(-200);

    for (const line of recentLines) {
      try {
        const entry = JSON.parse(line);
        const prompt = entry.display || '';
        if (!prompt) continue;

        patterns.totalPrompts++;
        totalLength += prompt.length;

        if (prompt.length < 20) patterns.shortPrompts++;
        if (prompt.length > 500) patterns.longPrompts++;
        if (prompt.startsWith('/clear')) patterns.clearCommands++;
        if (prompt.startsWith('/rewind')) patterns.rewindCommands++;
        if (/\/[a-zA-Z_-]+\//.test(prompt) || /\.[a-z]{2,4}\b/.test(prompt)) patterns.promptsWithFilePaths++;
        if (/error|Error|ERROR|exception|failed|failure|bug|crash/i.test(prompt)) patterns.promptsWithErrorMessages++;
      } catch { /* skip invalid lines */ }
    }

    if (patterns.totalPrompts > 0) {
      patterns.avgPromptLength = Math.round(totalLength / patterns.totalPrompts);
    }
  } catch { /* ignore */ }

  return patterns;
}

function scanForCorrections(claudeDir: string): CorrectionSignals {
  const signals: CorrectionSignals = {
    negationCount: 0,
    revertSignals: 0,
    frustrationSignals: 0,
    examples: [],
  };

  // Scan history.jsonl for correction patterns
  const historyFile = join(claudeDir, 'history.jsonl');
  if (!existsSync(historyFile)) return signals;

  try {
    const content = readFileSync(historyFile, 'utf-8');
    const lines = content.trim().split('\n').slice(-200);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const prompt = entry.display || '';
        if (!prompt || prompt.startsWith('/')) continue;

        let isCorrection = false;

        for (const pattern of NEGATION_PATTERNS) {
          if (pattern.test(prompt)) {
            signals.negationCount++;
            isCorrection = true;
            break;
          }
        }

        for (const pattern of REVERT_PATTERNS) {
          if (pattern.test(prompt)) {
            signals.revertSignals++;
            isCorrection = true;
            break;
          }
        }

        for (const pattern of FRUSTRATION_PATTERNS) {
          if (pattern.test(prompt)) {
            signals.frustrationSignals++;
            isCorrection = true;
            break;
          }
        }

        if (isCorrection && signals.examples.length < 5) {
          // Truncate for privacy
          signals.examples.push(prompt.slice(0, 80) + (prompt.length > 80 ? '...' : ''));
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

  return signals;
}

export function analyzeSession(projectRoot?: string): SessionAnalysis {
  const claudeDir = join(homedir(), '.claude');

  return {
    stats: parseSessionMetadata(claudeDir),
    promptPatterns: parsePromptHistory(claudeDir),
    corrections: scanForCorrections(claudeDir),
  };
}
