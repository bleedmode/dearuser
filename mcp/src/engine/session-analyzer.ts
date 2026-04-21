// Session Analyzer — extracts collaboration patterns from Claude Code session data.
//
// Data source: ~/.claude/projects/<flattened-cwd>/<session-id>.jsonl
// Each line is a JSON event; user prompts look like:
//   { type: "user", message: { role: "user", content: "text" | [{type:"text",text:"..."}, ...] }, ... }
//
// Prior versions of this file read ~/.claude/history.jsonl, which only contains
// CLI login events ({display:"login",...}) — that produced the "avg prompt = 8 chars,
// 0 corrections" bug that showed up in analyze reports.

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SessionStats {
  totalSessions: number;
  totalMessages: number;
  avgSessionDuration: number; // minutes (not computed yet — 0 until wired)
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
  negationCount: number;
  revertSignals: number;
  frustrationSignals: number;
  examples: string[];
}

export interface SessionAnalysis {
  stats: SessionStats;
  promptPatterns: PromptPatterns;
  corrections: CorrectionSignals;
}

// Negation patterns — used when the user is pushing back on what the agent did.
// We require word boundaries to avoid false positives on "notify", "nothing", etc.
const NEGATION_PATTERNS = [
  /\bnej\b/i, /\bstop\b/i, /\bdon'?t\b/i, /\bforkert\b/i, /\bikke\b/i,
  /\baldrig\b/i, /\bnever\b/i, /\bwrong\b/i, /^no[,.\s!]/i,
  /\bnot that\b/i, /\bnot what\b/i, /\bthat'?s not\b/i,
];

const REVERT_PATTERNS = [
  /\bundo\b/i, /\brevert\b/i, /\bgo back\b/i, /\bfortryd\b/i,
  /\brollback\b/i, /\brestore\b/i,
];

const FRUSTRATION_PATTERNS = [
  /\bwhy did you\b/i, /\bagain\b/i, /\bstill wrong\b/i,
  /\bI (just|already) (said|told|asked)\b/i,
  /\bhvorfor gjorde du\b/i, /\bstadig forkert\b/i, /\bendnu en gang\b/i,
];

/**
 * Extract plain text from a Claude message's `content` field. Content can be:
 *   - a string (simple case)
 *   - an array of parts: [{type:"text",text:"..."}, {type:"tool_use",...}, ...]
 * We only care about the human-typed text, so we concatenate text parts and
 * skip everything else.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p === 'object' && 'type' in p && p.type === 'text' && 'text' in p && typeof p.text === 'string') {
      parts.push(p.text);
    }
  }
  return parts.join('\n');
}

/**
 * Some "user" entries in the jsonl are not actually typed by the human:
 *   - tool_result messages from tool executions
 *   - system-reminder blocks injected by the harness
 *   - pure command-name bumps like "<command-name>standup</command-name>"
 * Filter those out so stats reflect real human prompts.
 */
function isRealUserPrompt(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const trimmed = text.trim();
  // Purely harness/system content
  if (trimmed.startsWith('<system-reminder>') && trimmed.endsWith('</system-reminder>')) return false;
  if (trimmed.startsWith('<command-message>') || trimmed.startsWith('<command-name>')) return false;
  if (trimmed.startsWith('[Request interrupted')) return false;
  if (trimmed.startsWith('Caveat: The messages')) return false;
  return true;
}

/**
 * Walk ~/.claude/projects/ and return all per-session .jsonl files, including
 * subagent files nested under <session-id>/subagents/. Each file represents
 * one session (or one subagent conversation).
 */
function findAllSessionJsonlFiles(claudeDir: string): string[] {
  const projectsDir = join(claudeDir, 'projects');
  if (!existsSync(projectsDir)) return [];

  const files: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 4) return; // safety: don't recurse forever
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isFile() && e.name.endsWith('.jsonl')) {
          files.push(full);
        } else if (e.isDirectory()) {
          walk(full, depth + 1);
        }
      }
    } catch { /* unreadable dir */ }
  };
  walk(projectsDir);
  return files;
}

/**
 * Infer the project name from the flattened directory name Claude Code uses:
 *   /Users/alice/dev/my-app  →  -Users-alice-dev-my-app
 * We un-flatten by taking the last non-empty segment after the final dash-group.
 */
function projectNameFromFlattened(dirName: string): string {
  // Example dirName: "-Users-alice-dev-my-app"
  const segments = dirName.split('-').filter(Boolean);
  return segments[segments.length - 1] || 'unknown';
}

export function analyzeSession(_projectRoot?: string): SessionAnalysis {
  const claudeDir = join(homedir(), '.claude');

  const stats: SessionStats = {
    totalSessions: 0,
    totalMessages: 0,
    avgSessionDuration: 0,
    sessionsLast7Days: 0,
    sessionsLast30Days: 0,
    mostActiveProject: null,
    projectDistribution: {},
  };

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

  const corrections: CorrectionSignals = {
    negationCount: 0,
    revertSignals: 0,
    frustrationSignals: 0,
    examples: [],
  };

  const files = findAllSessionJsonlFiles(claudeDir);
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  let totalLength = 0;
  // To cap work on huge histories: process at most the 30 most-recently-modified
  // files (covers roughly the last month for an active user).
  const filesByMtime = files
    .map(f => {
      try { return { f, m: statSync(f).mtimeMs }; } catch { return { f, m: 0 }; }
    })
    .sort((a, b) => b.m - a.m)
    .slice(0, 30);

  for (const { f, m } of filesByMtime) {
    stats.totalSessions++;

    // Recency based on file mtime (last activity in session)
    const age = now - m;
    if (age < sevenDays) stats.sessionsLast7Days++;
    if (age < thirtyDays) stats.sessionsLast30Days++;

    // Project attribution — the parent directory name (flattened cwd)
    const parentDir = f.split('/').slice(-2, -1)[0];
    const project = parentDir ? projectNameFromFlattened(parentDir) : 'unknown';
    stats.projectDistribution[project] = (stats.projectDistribution[project] || 0) + 1;

    let content: string;
    try {
      content = readFileSync(f, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;

      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;

      // We only care about top-level user-typed prompts.
      if (obj.type !== 'user') continue;

      const message = obj.message as Record<string, unknown> | undefined;
      if (!message || message.role !== 'user') continue;

      const prompt = extractMessageText(message.content);
      if (!isRealUserPrompt(prompt)) continue;

      stats.totalMessages++;
      patterns.totalPrompts++;
      totalLength += prompt.length;

      if (prompt.length < 20) patterns.shortPrompts++;
      if (prompt.length > 500) patterns.longPrompts++;
      if (prompt.trim().startsWith('/clear')) patterns.clearCommands++;
      if (prompt.trim().startsWith('/rewind')) patterns.rewindCommands++;
      if (/\/[a-zA-Z0-9_\-.]+\.[a-z]{2,4}\b/.test(prompt) || /[\w/.-]+:\d+/.test(prompt)) {
        patterns.promptsWithFilePaths++;
      }
      if (/\b(error|exception|failed|failure|crash|traceback|stacktrace)\b/i.test(prompt)) {
        patterns.promptsWithErrorMessages++;
      }

      // Correction signals — a single prompt can fire multiple buckets.
      let isCorrection = false;
      if (NEGATION_PATTERNS.some(p => p.test(prompt))) {
        corrections.negationCount++;
        isCorrection = true;
      }
      if (REVERT_PATTERNS.some(p => p.test(prompt))) {
        corrections.revertSignals++;
        isCorrection = true;
      }
      if (FRUSTRATION_PATTERNS.some(p => p.test(prompt))) {
        corrections.frustrationSignals++;
        isCorrection = true;
      }

      if (isCorrection && corrections.examples.length < 5) {
        // Truncate and collapse whitespace for readability/privacy.
        const cleaned = prompt.replace(/\s+/g, ' ').trim();
        corrections.examples.push(cleaned.slice(0, 100) + (cleaned.length > 100 ? '…' : ''));
      }
    }
  }

  if (patterns.totalPrompts > 0) {
    patterns.avgPromptLength = Math.round(totalLength / patterns.totalPrompts);
  }

  let maxCount = 0;
  for (const [project, count] of Object.entries(stats.projectDistribution)) {
    if (count > maxCount) {
      maxCount = count;
      stats.mostActiveProject = project;
    }
  }

  return { stats, promptPatterns: patterns, corrections };
}
