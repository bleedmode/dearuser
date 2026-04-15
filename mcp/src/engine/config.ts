// Dear User config — optional ~/.dearuser/config.json
//
// Lets external users (no 1Password, different folder layout) tailor Dear User
// without patching code. All fields optional. Absent file = use defaults.
//
// Example config:
// {
//   "searchRoots": ["~/code", "~/work/projects"],
//   "tokens": {
//     "supabase": "sbp_xxxxx",          // or omit and use SUPABASE_ACCESS_TOKEN env var
//     "vercel": "xxxxx"                  // or omit and use VERCEL_TOKEN env var
//   },
//   "disabledAdvisors": ["vercel"]      // skip specific advisors
// }

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface DearUserConfig {
  searchRoots: string[];
  tokens: {
    supabase?: string;
    vercel?: string;
  };
  disabledAdvisors: Array<'supabase' | 'github' | 'npm' | 'vercel'>;
}

export interface RawConfig {
  searchRoots?: string[];
  tokens?: { supabase?: string; vercel?: string };
  disabledAdvisors?: string[];
}

/** Expand ~ and environment variables in a path string. */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  return path.resolve(p);
}

/** Default search roots — tried in order. We don't force ~/clawd on external users. */
function defaultSearchRoots(): string[] {
  const candidates = [
    path.join(os.homedir(), 'clawd'),     // PVS internal convention
    path.join(os.homedir(), 'code'),       // common dev convention
    path.join(os.homedir(), 'projects'),   // common dev convention
    path.join(os.homedir(), 'work'),       // common dev convention
    path.join(os.homedir(), 'src'),        // common dev convention
  ];
  const existing = candidates.filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
  // If none of the conventional folders exist, fall back to home — still scoped,
  // avoids scanning the whole FS.
  return existing.length > 0 ? existing : [os.homedir()];
}

/** Read and validate config. Returns merged config with defaults filled in. */
export function loadConfig(): DearUserConfig {
  const configPath = path.join(os.homedir(), '.dearuser', 'config.json');

  let raw: RawConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RawConfig;
    } catch (err) {
      // Malformed config: warn via stderr but don't crash — graceful degradation
      process.stderr.write(`[dearuser] Warning: ${configPath} is malformed, using defaults (${err instanceof Error ? err.message : err})\n`);
    }
  }

  const searchRoots = Array.isArray(raw.searchRoots) && raw.searchRoots.length > 0
    ? raw.searchRoots.map(expandPath)
    : defaultSearchRoots();

  const validPlatforms = new Set(['supabase', 'github', 'npm', 'vercel']);
  const disabledAdvisors = (raw.disabledAdvisors || [])
    .filter((p): p is 'supabase' | 'github' | 'npm' | 'vercel' => validPlatforms.has(p));

  return {
    searchRoots,
    tokens: {
      supabase: raw.tokens?.supabase,
      vercel: raw.tokens?.vercel,
    },
    disabledAdvisors,
  };
}

/** Convenience: return the config's Supabase token if set, else undefined. */
export function configSupabaseToken(): string | undefined {
  return loadConfig().tokens.supabase;
}

/** Convenience: return the config's Vercel token if set, else undefined. */
export function configVercelToken(): string | undefined {
  return loadConfig().tokens.vercel;
}
