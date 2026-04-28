// user-preferences.ts — thin read/write layer over ~/.dearuser/config.json.
//
// Written by onboarding (Q0 asks the user's name, Q1-Q4 collect work/data
// pattern). Read by dashboard (personalised greeting) and by downstream
// tools that want to tailor output based on role / cadence / substrate.
//
// All fields are optional — Dear User works without any preferences. If
// the config file doesn't exist, every getter returns null.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.dearuser');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

/**
 * True when the user has never completed onboarding. Used by the top-level
 * tools (collab/security/health) to short-circuit into an onboarding nudge
 * instead of silently scanning before any setup has happened. Heuristic:
 * config file missing, OR no name/role/cadence set at all.
 */
export function isFirstTime(): boolean {
  const cfg = readConfig();
  if (!cfg) return true;
  const p = cfg.preferences || {};
  // v4 signal: outcome + cadence are the two always-asked v4 fields.
  // v3 fallback: name + role + cadence (old onboarding).
  if (p.outcome || p.autonomy) return false;
  return !p.name && !p.role && !p.cadence;
}

export interface UserPreferences {
  name?: string;
  agentName?: string;

  // --- v4 onboarding (current) ----------------------------------------------
  /** Q1 — "What should I help you achieve?" — raw free text. Feeds
   *  personalisation in the first paragraph of every collab report and
   *  biases persona-detection when scan is still thin. */
  outcome?: string;
  /** Q2 — how autonomous the user wants their agent. Feeds scorer mismatch
   *  checks (auto without hooks = risk; ask-all with many do-rules = friction). */
  autonomy?: 'auto' | 'ask-risky' | 'ask-all' | null;
  /** Q3 — how often the agent should work. Compared against scheduledTasksCount
   *  to flag cadence-mismatch. */
  cadence?: 'daily' | 'weekly' | 'on-demand' | 'event' | null;
  /** Q4 — who sees the output. Team/customers require memory + documentation
   *  that self-use doesn't; surfaces as recommendations when missing. */
  audience?: 'self' | 'team' | 'customers' | null;

  /** Q4 (v4.2 replacement for cadence) — when a tool finishes, do we auto-open
   *  the report in the user's default browser? Default true for backwards
   *  compat with users who already had the auto-open behaviour. Set false to
   *  stay in the terminal — useful for users running headless or who just
   *  don't want a browser tab popping up on every collab call. Read by
   *  openInBrowser() in index.ts; the dashboard process is still spawned in
   *  the background regardless, so URLs in the response remain clickable. */
  autoOpenBrowser?: boolean;

  // --- Legacy (v3 onboarding, still readable but no longer asked) -----------
  // Kept so older config.json files don't lose data on upgrade.
  role?: 'coder' | 'occasional' | 'non_coder' | null;
  substrate?: string | null;
  stack?: string[];
  work?: string;
  pains?: string;
  dataDescription?: string;
}

interface FullConfig {
  searchRoots?: string[];
  preferences?: UserPreferences;
  tokens?: Record<string, string>;
}

function readConfig(): FullConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as FullConfig;
  } catch {
    return null;
  }
}

export function getPreferences(): UserPreferences {
  return readConfig()?.preferences || {};
}

/** First name or null. Used by the dashboard to address the user by name. */
export function getUserName(): string | null {
  const name = getPreferences().name;
  if (!name || typeof name !== 'string') return null;
  // Take just the first word — people sometimes type their full name
  return name.trim().split(/\s+/)[0] || null;
}

/**
 * Merge partial preferences into the saved config. Creates the file and
 * directory if needed. Non-destructive: existing preferences and other
 * top-level fields (searchRoots, tokens) are preserved.
 */
export function updatePreferences(patch: Partial<UserPreferences>): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = readConfig() || {};
  const merged: FullConfig = {
    ...existing,
    preferences: { ...(existing.preferences || {}), ...patch },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}
