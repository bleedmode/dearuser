// implementer.ts — applies a recommendation to the user's filesystem.
//
// Three safe actions (plus a manual fallback):
//   claude_md_append  — append markdown to ~/.claude/CLAUDE.md (with backup)
//   settings_merge    — merge JSON into ~/.claude/settings.json (with backup)
//   shell_exec        — return the command for the agent to run via Bash
//   manual            — return the instructions, require the human to act
//
// Every filesystem write is preceded by a timestamped backup in
// ~/.dearuser/backups/ so the user can recover if an implementation goes
// wrong. No overwrites without a backup, ever.
//
// Called by the mcp__dearuser__implement_recommendation tool.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_MD = join(CLAUDE_DIR, 'CLAUDE.md');
const SETTINGS_JSON = join(CLAUDE_DIR, 'settings.json');
const BACKUP_DIR = join(homedir(), '.dearuser', 'backups');

export interface ImplementResult {
  ok: boolean;
  summary: string;
  /** Path(s) written, for the user-facing confirmation */
  changed?: string[];
  /** Backup(s) created */
  backups?: string[];
  /** For shell_exec: the command the agent should run via Bash. We don't
   *  spawn it ourselves to keep the human in the loop on destructive actions. */
  command?: string;
  /** Human-readable instructions for manual type */
  instructions?: string;
  /** Error message if ok=false */
  error?: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupFile(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const base = path.split('/').pop() || 'file';
  const dest = join(BACKUP_DIR, `${base}.${timestamp()}.bak`);
  copyFileSync(path, dest);
  return dest;
}

/**
 * Append a markdown block to ~/.claude/CLAUDE.md. If the exact block already
 * exists, do nothing (idempotent). Otherwise append with a leading blank
 * line if the file doesn't end in one.
 */
export function implementClaudeMdAppend(content: string): ImplementResult {
  try {
    if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true });
    const existing = existsSync(CLAUDE_MD) ? readFileSync(CLAUDE_MD, 'utf-8') : '';

    // Idempotency: if the block is already there, no-op.
    if (existing.includes(content.trim())) {
      return {
        ok: true,
        summary: 'Reglen stod allerede i din CLAUDE.md — intet at gøre.',
      };
    }

    const backup = existsSync(CLAUDE_MD) ? backupFile(CLAUDE_MD) : null;
    const sep = existing && !existing.endsWith('\n\n') ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
    writeFileSync(CLAUDE_MD, existing + sep + content.trim() + '\n', 'utf-8');

    return {
      ok: true,
      summary: `Tilføjet til ~/.claude/CLAUDE.md${backup ? ` (backup: ${backup})` : ''}`,
      changed: [CLAUDE_MD],
      backups: backup ? [backup] : [],
    };
  } catch (err) {
    return { ok: false, summary: 'Kunne ikke opdatere CLAUDE.md', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Merge a JSON snippet into ~/.claude/settings.json. The snippet is expected
 * to be a full object like {"hooks": {"PostToolUse": [...]}}. We do a deep
 * merge: top-level keys merge, arrays concat.
 *
 * The snippet can be wrapped with `// Add to .claude/settings.json:` comments
 * — we strip those before parsing.
 */
export function implementSettingsMerge(snippet: string): ImplementResult {
  try {
    // Strip any preamble that precedes the JSON object. Our templates often
    // start with a header like "Add to .claude/settings.json:" or a JS
    // comment explaining where the snippet goes. Slice from the first '{'
    // to the matching last '}' to keep just the JSON payload.
    let jsonText = snippet
      .replace(/^\s*\/\/[^\n]*\n/gm, '')
      .replace(/^\s*\/\*[\s\S]*?\*\//g, '')
      .trim();
    const firstBrace = jsonText.indexOf('{');
    const lastBrace = jsonText.lastIndexOf('}');
    if (firstBrace > 0 && lastBrace > firstBrace) {
      jsonText = jsonText.slice(firstBrace, lastBrace + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      return {
        ok: false,
        summary: 'Kunne ikke læse anbefalings-JSON',
        error: `Parser-fejl: ${e instanceof Error ? e.message : e}. Indhold: ${jsonText.slice(0, 200)}`,
      };
    }

    if (!existsSync(CLAUDE_DIR)) mkdirSync(CLAUDE_DIR, { recursive: true });
    const existing = existsSync(SETTINGS_JSON)
      ? JSON.parse(readFileSync(SETTINGS_JSON, 'utf-8') || '{}')
      : {};

    const merged = deepMerge(existing, parsed);
    const before = JSON.stringify(existing);
    const after = JSON.stringify(merged);
    if (before === after) {
      return { ok: true, summary: 'Indstillingen var der allerede — intet at gøre.' };
    }

    const backup = existsSync(SETTINGS_JSON) ? backupFile(SETTINGS_JSON) : null;
    writeFileSync(SETTINGS_JSON, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

    return {
      ok: true,
      summary: `Tilføjet til ~/.claude/settings.json${backup ? ` (backup: ${backup})` : ''}`,
      changed: [SETTINGS_JSON],
      backups: backup ? [backup] : [],
    };
  } catch (err) {
    return { ok: false, summary: 'Kunne ikke opdatere settings.json', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * For shell-based installs (e.g. `claude mcp add exa -- npx -y exa-mcp`) we
 * do NOT spawn the command ourselves. The MCP server sandbox is too coupled
 * to Claude Code's own shell environment for us to guarantee a clean run.
 * Instead we return the command and let the agent run it via the Bash tool
 * (which has the user's shell set up correctly).
 */
export function prepareShellExec(command: string): ImplementResult {
  if (!command || command.trim().length === 0) {
    return { ok: false, summary: 'Ingen kommando at køre.', error: 'empty command' };
  }
  return {
    ok: true,
    summary: `Kør denne kommando for at installere: ${command}`,
    command: command.trim(),
  };
}

/**
 * Manual implementations — we can't do this one automatically, so we pass
 * the instructions back and let the human + agent figure it out together.
 */
export function prepareManual(instructions: string): ImplementResult {
  return {
    ok: true,
    summary: 'Denne anbefaling kræver at du (eller din assistent) selv gør et par ting.',
    instructions: instructions || 'Ingen specifikke instruktioner gemt — prøv at spørge din assistent om hjælp til at implementere den.',
  };
}

// ---------------------------------------------------------------------------
// deepMerge — small helper that merges objects recursively. Arrays concat
// and dedupe (so running implementSettingsMerge twice doesn't double-insert
// the same hook). Scalars from the new object win.
// ---------------------------------------------------------------------------

function deepMerge(a: any, b: any): any {
  if (Array.isArray(a) && Array.isArray(b)) {
    // Concat and dedupe by JSON identity — robust enough for hook blocks
    const seen = new Set<string>();
    const out: any[] = [];
    for (const item of [...a, ...b]) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); out.push(item); }
    }
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out: any = { ...a };
    for (const key of Object.keys(b)) {
      out[key] = key in a ? deepMerge(a[key], b[key]) : b[key];
    }
    return out;
  }
  return b !== undefined ? b : a;
}
