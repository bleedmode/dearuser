// version-check.ts — async "is there a newer version on npm?" probe.
//
// First-time-UX problem this solves: when we ship a fix to npm, users on
// older versions never see it because (a) `npx @poisedhq/dearuser-mcp`
// without `-y`/`@latest` happily re-uses the cached tarball, and (b) once
// Claude Code spawns the MCP, it stays in memory until the session restarts.
// The MCP itself can't force a respawn from inside, but it CAN tell the
// user that a newer version exists so they decide to act.
//
// Design choices:
// - Hit registry.npmjs.org/<pkg>/latest (tiny JSON, no auth) at startup.
// - Cache result in ~/.dearuser/version-check.json with a 24h TTL so we
//   don't spam npm on every Claude Code session.
// - 5-second timeout — never block tool responses on a slow registry.
// - Fail closed: if the check errors, we just return null and stay quiet.
//   Users on old versions don't get warned, but we don't surface noise either.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PACKAGE_NAME = '@poisedhq/dearuser-mcp';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;

const CACHE_PATH = join(homedir(), '.dearuser', 'version-check.json');

interface CacheEntry {
  fetchedAt: number;
  latestVersion: string;
}

let inMemoryLatest: string | null = null;

/**
 * Compare two semver-ish strings (`1.0.7` vs `1.0.10`). Returns -1 / 0 / 1.
 * Anything non-numeric in a segment is treated as 0 — we only ever compare
 * versions we minted ourselves, so simple is fine. Pre-release/build suffixes
 * are stripped before comparing.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const aP = parse(a);
  const bP = parse(b);
  for (let i = 0; i < Math.max(aP.length, bP.length); i++) {
    const ai = aP[i] ?? 0;
    const bi = bP[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

function readCache(): CacheEntry | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const data = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    if (typeof data?.latestVersion !== 'string' || typeof data?.fetchedAt !== 'number') return null;
    return data as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    const dir = join(homedir(), '.dearuser');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(entry));
  } catch { /* cache write failure is non-fatal */ }
}

/**
 * Fire-and-forget: refresh the cached "latest version" if we don't have a
 * fresh enough record. Resolves once the cache is updated (or the fetch
 * gives up). Callers should NOT await this on the hot path — call it once
 * at MCP startup and read `getCachedLatestVersion()` from tool handlers.
 */
export async function refreshLatestVersion(): Promise<void> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    inMemoryLatest = cached.latestVersion;
    return;
  }
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json() as any;
    if (typeof data?.version !== 'string') return;
    inMemoryLatest = data.version;
    writeCache({ fetchedAt: Date.now(), latestVersion: data.version });
  } catch {
    // Network blip, offline, registry down — stay silent. Worst case a user
    // on an outdated version doesn't get nudged. Better than spamming
    // "couldn't reach npm" into every collab report.
  }
}

/** Returns the cached latest version string, or null if we never fetched. */
export function getCachedLatestVersion(): string | null {
  if (inMemoryLatest) return inMemoryLatest;
  const cached = readCache();
  if (cached) {
    inMemoryLatest = cached.latestVersion;
    return cached.latestVersion;
  }
  return null;
}

/**
 * If the running version is older than the cached npm latest, return a
 * short markdown notice the caller can prepend to a tool response. Returns
 * null when running version is up-to-date or we don't yet have data.
 *
 * Wording: addressed to the user (not the agent) and explicit about the
 * action — clearing the npx cache + restarting Claude Code is the only
 * reliable way to get the new version into a running session. Without
 * those steps a `claude mcp add` with no version pin will keep using the
 * cached tarball indefinitely.
 */
export function getStaleVersionNotice(currentVersion: string): string | null {
  const latest = getCachedLatestVersion();
  if (!latest) return null;
  if (compareVersions(currentVersion, latest) >= 0) return null;
  return [
    '> **Heads up — a newer Dear User is available.**',
    `> You're on **${currentVersion}**, latest is **${latest}**. To update:`,
    '>',
    '> ```bash',
    '> rm -rf ~/.npm/_npx',
    '> ```',
    '>',
    '> Then quit and reopen Claude Code. The next tool call will fetch the latest.',
    '',
  ].join('\n');
}
