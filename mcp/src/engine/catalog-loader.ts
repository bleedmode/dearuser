// catalog-loader — runtime loader for the tool recommendation catalog.
//
// Architecture: the catalog is data, not code. This lets us keep Dear User
// "a learning product" — new MCP servers and tools surface in the catalog
// within hours of being researched, without users having to run
// `npm update @poisedhq/dearuser-mcp`.
//
// Load priority (newest usable wins):
//   1. Fresh cache at ~/.dearuser/catalog-cache.json (within TTL)
//   2. Remote fetch from GitHub raw URL → update cache, return
//   3. Stale cache (even if older than TTL — better than nothing)
//   4. Bundled catalog.json shipped with the npm package
//
// Privacy: outbound is a plain GET of public static JSON from GitHub, no
// auth, no user data. Same profile as `brew update` or `apt-get update`.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ToolRecommendation } from '../templates/tool-catalog.js';

const CACHE_DIR = join(homedir(), '.dearuser');
const CACHE_FILE = join(CACHE_DIR, 'catalog-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 4000;
const CATALOG_URL = 'https://raw.githubusercontent.com/bleedmode/dearuser/main/catalog.json';

export interface CatalogDocument {
  version: string;
  lastSynced: string;
  source?: string;
  tools: ToolRecommendation[];
}

/** In-memory snapshot — set once at first load, updated by background refresh. */
let snapshot: CatalogDocument | null = null;

function readCache(): CatalogDocument | null {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    const text = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(text) as CatalogDocument;
  } catch {
    return null;
  }
}

function isCacheFresh(): boolean {
  if (!existsSync(CACHE_FILE)) return false;
  try {
    const mtime = statSync(CACHE_FILE).mtimeMs;
    return Date.now() - mtime < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function writeCache(doc: CatalogDocument): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  } catch {
    // Cache write failure shouldn't break anything — we still have the
    // in-memory snapshot.
  }
}

/** Fetch the latest catalog from GitHub. Returns null on any failure. */
async function fetchRemote(): Promise<CatalogDocument | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(CATALOG_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const doc = (await res.json()) as CatalogDocument;
    if (!doc || !Array.isArray(doc.tools)) return null;
    return doc;
  } catch {
    return null;
  }
}

/**
 * Load the bundled catalog.json shipped with the npm package. This is the
 * last-resort fallback when both fetch and cache fail — still serves the
 * catalog snapshot at install time, so users are never left with nothing.
 *
 * The bundle is TS-imported rather than read from disk because esbuild
 * resolves the JSON import at build time and inlines it. If the require
 * fails (unexpected build layout), we fall through to an empty catalog.
 */
function loadBundled(): CatalogDocument | null {
  try {
    // esbuild inlines this JSON at build time via the json loader.
    // Path is relative to the source file, resolved by esbuild.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require('../../../catalog.json');
    return bundled as CatalogDocument;
  } catch {
    return null;
  }
}

/**
 * Kick off a background refresh that fetches the latest catalog and updates
 * cache + in-memory snapshot. Fire-and-forget — caller doesn't wait.
 */
function scheduleBackgroundRefresh(): void {
  fetchRemote().then(doc => {
    if (!doc) return;
    writeCache(doc);
    snapshot = doc;
  }).catch(() => { /* silent — next startup will retry */ });
}

/**
 * Synchronous catalog accessor. Returns the current in-memory snapshot
 * (initialised lazily from cache → bundled on first access). Background
 * refresh fires when the cache is stale so the next call gets newer data.
 */
export function loadCatalog(): CatalogDocument {
  if (snapshot) {
    // If cache is stale, refresh in the background for next caller.
    if (!isCacheFresh()) scheduleBackgroundRefresh();
    return snapshot;
  }

  // First access this process — prefer cache, fall back to bundled.
  const cached = readCache();
  if (cached) {
    snapshot = cached;
    if (!isCacheFresh()) scheduleBackgroundRefresh();
    return snapshot;
  }

  const bundled = loadBundled();
  if (bundled) {
    snapshot = bundled;
    // First run — no cache yet. Write bundled as initial cache so the
    // stale-vs-fresh check works consistently, and kick a refresh.
    writeCache(bundled);
    scheduleBackgroundRefresh();
    return snapshot;
  }

  // Nothing available — return an empty but well-formed doc so callers
  // can keep running.
  snapshot = { version: '0', lastSynced: 'never', tools: [] };
  return snapshot;
}

/**
 * Shortcut for callers that only need the tools array. Most code paths
 * use this instead of the full CatalogDocument.
 */
export function getCatalogTools(): ToolRecommendation[] {
  return loadCatalog().tools;
}
