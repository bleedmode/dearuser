// git-scanner — local .git directory analysis.
//
// Scans project directories (typically the scanRoots from the global ScanResult)
// and extracts commit-activity signals without hitting any remote. Privacy-
// preserving; nothing leaves the user's machine.
//
// Signals extracted per repo:
//   - Last commit date + stale-days
//   - Commit count last 7 / 30 days
//   - Uncommitted file count
//   - "Fix again" / "revert" signals in recent commit messages
//   - Top 3 most-churned files in last 30 days (friction candidate files)

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface GitRepoInfo {
  path: string;
  name: string;
  lastCommitDate: Date | null;
  lastCommitMessage: string;
  staleDays: number | null;
  commits7d: number;
  commits30d: number;
  uncommittedFiles: number;
  /** Messages matching "fix again", "revert", "still broken" patterns in last 30d. */
  revertSignals: string[];
  /** Top 3 file paths with the highest change-count in last 30d — candidate friction points. */
  topChurnFiles: Array<{ path: string; changes: number }>;
}

export interface GitScanResult {
  repos: GitRepoInfo[];
  totalScanned: number;
  stale: GitRepoInfo[];       // > 60 days since last commit
  active: GitRepoInfo[];      // commits in last 7 days
}

/** Run a git command in a specific repo directory. Returns trimmed stdout or null on failure. */
function gitIn(repoPath: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    return out.trim();
  } catch {
    return null;
  }
}

/** Parse a git log line in format: `<hash>\t<iso-date>\t<message>` */
function parseLogLine(line: string): { hash: string; date: Date; message: string } | null {
  const parts = line.split('\t');
  if (parts.length < 3) return null;
  const date = new Date(parts[1]);
  if (isNaN(date.getTime())) return null;
  return { hash: parts[0], date, message: parts.slice(2).join('\t') };
}

/** Pattern-match commit messages for "this didn't work the first time" signals. */
const REVERT_PATTERNS = [
  /\brevert\b/i,
  /\bfix\s*(again|#2|v2|take\s*2|v3)\b/i,
  /\bstill\s+(broken|failing|wrong)\b/i,
  /\battempt\s*\d+\b/i,
  /\bactually\s+(works?|fixes?)\b/i,
  /\bfix\s+.*?(fix|fixes)/i,
];

function isRevertSignal(message: string): boolean {
  return REVERT_PATTERNS.some(p => p.test(message));
}

/**
 * Extract top N most-churned files in the last `days` days. Uses `git log`
 * with `--numstat` to count per-file modifications.
 */
function extractTopChurn(repoPath: string, days: number, topN: number): Array<{ path: string; changes: number }> {
  const since = `${days}.days.ago`;
  const raw = gitIn(repoPath, [
    'log',
    `--since=${since}`,
    '--pretty=format:',
    '--numstat',
  ]);
  if (!raw) return [];

  const counts = new Map<string, number>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: "<added>\t<deleted>\t<path>"; "-" for binary files
    const parts = trimmed.split('\t');
    if (parts.length !== 3) continue;
    const path = parts[2];
    if (!path) continue;
    counts.set(path, (counts.get(path) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([path, changes]) => ({ path, changes }));
}

/** Count commits since a relative date spec like "7.days.ago". */
function countCommitsSince(repoPath: string, since: string): number {
  const out = gitIn(repoPath, ['rev-list', '--count', `--since=${since}`, 'HEAD']);
  if (out === null) return 0;
  const n = parseInt(out, 10);
  return isNaN(n) ? 0 : n;
}

/** Count uncommitted files (staged + unstaged + untracked). */
function countUncommitted(repoPath: string): number {
  const out = gitIn(repoPath, ['status', '--porcelain']);
  if (out === null || out.length === 0) return 0;
  return out.split('\n').filter(l => l.trim().length > 0).length;
}

/** Scan one repo. Returns null if the path isn't a git repo. */
export function scanRepo(repoPath: string): GitRepoInfo | null {
  if (!existsSync(join(repoPath, '.git'))) return null;

  // Last commit
  const lastLog = gitIn(repoPath, ['log', '-1', '--pretty=format:%H%x09%aI%x09%s']);
  let lastCommitDate: Date | null = null;
  let lastCommitMessage = '';
  if (lastLog) {
    const parsed = parseLogLine(lastLog);
    if (parsed) {
      lastCommitDate = parsed.date;
      lastCommitMessage = parsed.message;
    }
  }

  const now = Date.now();
  const staleDays = lastCommitDate
    ? Math.floor((now - lastCommitDate.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  // Recent commits (past 30 days) — for revert-signal detection and counts
  const recentLog = gitIn(repoPath, ['log', '--since=30.days.ago', '--pretty=format:%H%x09%aI%x09%s']);
  const revertSignals: string[] = [];
  if (recentLog) {
    for (const line of recentLog.split('\n')) {
      const parsed = parseLogLine(line);
      if (!parsed) continue;
      if (isRevertSignal(parsed.message)) {
        revertSignals.push(parsed.message);
      }
    }
  }

  return {
    path: repoPath,
    name: repoPath.split('/').filter(Boolean).pop() || repoPath,
    lastCommitDate,
    lastCommitMessage,
    staleDays,
    commits7d: countCommitsSince(repoPath, '7.days.ago'),
    commits30d: countCommitsSince(repoPath, '30.days.ago'),
    uncommittedFiles: countUncommitted(repoPath),
    revertSignals: revertSignals.slice(0, 5),
    topChurnFiles: extractTopChurn(repoPath, 30, 3),
  };
}

/**
 * Discover candidate project directories by:
 *   1. Walking common parent dirs one level deep (~/dev, ~/projects, ~/code, …)
 *   2. Including any explicit paths the caller passed (e.g. from CLAUDE.md)
 *
 * Returns ONLY paths that actually contain a .git directory — saves `scanRepo`
 * from having to check every candidate.
 */
function discoverGitRepos(explicitPaths: string[]): string[] {
  const home = homedir();
  const conventionalParents = [
    join(home, 'dev'),
    join(home, 'Dev'),
    join(home, 'projects'),
    join(home, 'Projects'),
    join(home, 'code'),
    join(home, 'Code'),
    join(home, 'src'),
    join(home, 'work'),
    join(home, 'Work'),
    join(home, 'repos'),
    join(home, 'github'),
    join(home, 'GitHub'),
  ];

  const found = new Set<string>();

  // 1. Conventional parents: look one level deep for .git
  for (const parent of conventionalParents) {
    if (!existsSync(parent)) continue;
    try {
      const stat = statSync(parent);
      if (!stat.isDirectory()) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(parent, entry.name);
        if (existsSync(join(candidate, '.git'))) {
          found.add(candidate);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  // 2. Explicit caller paths — trust them if they have a .git
  for (const p of explicitPaths) {
    if (!p) continue;
    if (p === home || p === '/') continue;
    if (existsSync(join(p, '.git'))) {
      found.add(p);
    }
  }

  return Array.from(found);
}

/**
 * Scan every path that looks like a project root. De-duplicates paths, skips
 * anything that isn't a git repo. If `candidatePaths` is empty we still
 * walk the conventional parent directories — so `analyze` works out of the
 * box even when the scope doesn't surface project paths.
 */
export function scanGitRepos(candidatePaths: string[]): GitScanResult {
  const repos: GitRepoInfo[] = [];
  const seen = new Set<string>();

  for (const path of discoverGitRepos(candidatePaths)) {
    if (seen.has(path)) continue;
    seen.add(path);
    const info = scanRepo(path);
    if (info) repos.push(info);
  }

  const stale = repos.filter(r => r.staleDays !== null && r.staleDays > 60);
  const active = repos.filter(r => r.commits7d > 0);

  return {
    repos,
    totalScanned: repos.length,
    stale,
    active,
  };
}
