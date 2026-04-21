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

export interface UserPreferences {
  name?: string;
  agentName?: string;
  role?: 'coder' | 'occasional' | 'non_coder' | null;
  cadence?: 'daily' | 'weekly' | 'on-demand' | 'event' | null;
  audience?: 'self' | 'team' | 'customers' | null;
  substrate?: string | null;
  stack?: string[];
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

/** Agent's first name. Defaults to "Bobby" if onboarding hasn't set one. */
export function getAgentName(): string {
  const name = getPreferences().agentName;
  if (!name || typeof name !== 'string') return 'Bobby';
  return name.trim().split(/\s+/)[0] || 'Bobby';
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
