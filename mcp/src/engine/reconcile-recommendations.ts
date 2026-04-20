// reconcile-recommendations.ts
//
// Reconciles pending recommendations against actual disk state. Fixes the
// "already installed but still listed as pending" drift that happens when
// the agent runs a shell_exec-type recommendation (we hand it the command,
// but the DB never learns whether it was actually executed).
//
// The sources of truth are standard Claude Code files present on every
// install, so this generalizes to any user:
//   - ~/.claude.json         (mcpServers — global + per-project)
//   - ~/.claude/settings.json (hooks, permissions, env)
//   - ~/.claude/CLAUDE.md    (rules)
//
// Call reconcilePendingRecommendations() before reading pending recs.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getRecommendations, updateRecommendationStatus } from './db.js';

const HOME = homedir();
const CLAUDE_JSON = join(HOME, '.claude.json');
const SETTINGS_JSON = join(HOME, '.claude', 'settings.json');
const CLAUDE_MD = join(HOME, '.claude', 'CLAUDE.md');

function readJsonSafe(path: string): any {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readTextSafe(path: string): string {
  try {
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** All MCP server names across global + per-project mcpServers in ~/.claude.json. */
function collectMcpServers(): Set<string> {
  const names = new Set<string>();
  const claudeJson = readJsonSafe(CLAUDE_JSON);
  if (!claudeJson) return names;
  if (claudeJson.mcpServers && typeof claudeJson.mcpServers === 'object') {
    for (const n of Object.keys(claudeJson.mcpServers)) names.add(n);
  }
  if (claudeJson.projects && typeof claudeJson.projects === 'object') {
    for (const proj of Object.values<any>(claudeJson.projects)) {
      if (proj && proj.mcpServers && typeof proj.mcpServers === 'object') {
        for (const n of Object.keys(proj.mcpServers)) names.add(n);
      }
    }
  }
  return names;
}

/** "claude mcp add <name> -- ..." → "<name>". Null if not that shape. */
function parseMcpAddCommand(cmd: string): string | null {
  const m = cmd.match(/claude\s+mcp\s+add\s+(\S+)/);
  return m ? m[1] : null;
}

/** Recursive structural "contains": every key/value in target exists in obj. */
function deepContains(obj: any, target: any): boolean {
  if (obj === target) return true;
  if (target == null) return obj == null;
  if (typeof target !== 'object') return obj === target;
  if (typeof obj !== 'object' || obj == null) return false;
  if (Array.isArray(target)) {
    if (!Array.isArray(obj)) return false;
    return target.every((item) => obj.some((o: any) => deepContains(o, item)));
  }
  for (const k of Object.keys(target)) {
    if (!(k in obj)) return false;
    if (!deepContains(obj[k], target[k])) return false;
  }
  return true;
}

/**
 * Check if a pending recommendation is already implemented on disk.
 * Returns false on "unknown" — we only mark implemented when we can prove it.
 */
export function isRecommendationImplemented(rec: any): boolean {
  if (!rec || !rec.action_type || !rec.action_data) return false;

  switch (rec.action_type) {
    case 'shell_exec': {
      const name = parseMcpAddCommand(String(rec.action_data));
      if (!name) return false;
      return collectMcpServers().has(name);
    }
    case 'settings_merge': {
      let snippet: any;
      try {
        snippet = JSON.parse(String(rec.action_data));
      } catch {
        return false;
      }
      const settings = readJsonSafe(SETTINGS_JSON);
      if (!settings) return false;
      return deepContains(settings, snippet);
    }
    case 'claude_md_append': {
      const txt = readTextSafe(CLAUDE_MD);
      const snippet = String(rec.action_data || '').trim();
      if (!txt || snippet.length < 20) return false;
      const firstLine = snippet.split('\n')[0].trim();
      return firstLine.length >= 20 ? txt.includes(firstLine) : txt.includes(snippet);
    }
    default:
      return false;
  }
}

/**
 * Scan all pending recommendations and mark implemented ones based on disk
 * state. Idempotent — safe to call on every read.
 */
export function reconcilePendingRecommendations(): { reconciled: number } {
  const pending = getRecommendations('pending');
  let reconciled = 0;
  for (const rec of pending) {
    if (isRecommendationImplemented(rec)) {
      updateRecommendationStatus(rec.id, 'implemented');
      reconciled++;
    }
  }
  return { reconciled };
}
