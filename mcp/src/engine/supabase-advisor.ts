// Supabase Advisor orchestrator
//
// Discovers Supabase projects in the user's stack, calls Supabase's own Advisor
// API for each, and normalizes findings into PlatformAdvisorFinding shape.
//
// Token resolution priority:
//   1. env var SUPABASE_ACCESS_TOKEN (standard for external users)
//   2. 1Password CLI (internal PVS setup, uses ~/.config/openclaw/op-token)
//   3. give up gracefully with skipped status
//
// We do NOT re-scan for RLS — that's what Supabase Advisor already does. We
// just aggregate its output. Orchestration, not reimplementation.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { PlatformAdvisorFinding, PlatformAdvisorStatus, GapSeverity } from '../types.js';

export interface SupabaseProject {
  ref: string;
  projectName: string;
  sourcePath: string; // the .env file where we found it
}

/** Scan a directory tree for .env files containing SUPABASE_URL. Extract project refs. */
export function discoverSupabaseProjects(searchRoot: string): SupabaseProject[] {
  const found: SupabaseProject[] = [];
  const seenRefs = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 4) return; // don't recurse too deep — projects live near the top
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // skip noise
        if (['node_modules', '.git', 'dist', 'build', '.next', '.vercel', '.expo'].includes(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile() && (entry.name === '.env' || entry.name === '.env.local' || entry.name === '.env.production')) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          // SUPABASE_URL=https://<ref>.supabase.co  (strip quotes if present)
          const match = content.match(/SUPABASE_URL\s*=\s*["']?https?:\/\/([a-z0-9]+)\.supabase\.co/i);
          if (match) {
            const ref = match[1];
            if (!seenRefs.has(ref)) {
              seenRefs.add(ref);
              // derive a human name from the folder structure — first dir under searchRoot
              const rel = path.relative(searchRoot, dir);
              const projectName = rel.split(path.sep)[0] || path.basename(dir);
              found.push({ ref, projectName, sourcePath: full });
            }
          }
        } catch {
          // unreadable .env, skip
        }
      }
    }
  }

  walk(searchRoot, 0);
  return found;
}

/** Resolve a Supabase access token. Returns undefined if nothing is available. */
export function resolveSupabaseToken(): { token: string; source: string } | undefined {
  // 1. Env var — standard for external users
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    return { token: process.env.SUPABASE_ACCESS_TOKEN, source: 'env:SUPABASE_ACCESS_TOKEN' };
  }

  // 2. 1Password CLI — internal PVS setup
  const opTokenPath = path.join(os.homedir(), '.config', 'openclaw', 'op-token');
  if (fs.existsSync(opTokenPath)) {
    try {
      const opToken = fs.readFileSync(opTokenPath, 'utf-8').trim();
      const token = execSync(
        'op item get "Supabase Access Token Bobby Agent" --vault Bobby --fields label=credential --reveal',
        { env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: opToken }, encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (token) return { token, source: '1password:Bobby' };
    } catch {
      // op CLI missing or failed — fall through
    }
  }

  return undefined;
}

interface SupabaseLint {
  name: string;
  title: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  facing?: string;
  categories?: string[];
  description?: string;
  detail?: string;
  remediation?: string;
  metadata?: Record<string, unknown>;
  cache_key?: string;
}

/** Map Supabase severity to our internal scale. */
function mapSeverity(level: string): GapSeverity {
  switch (level) {
    case 'ERROR': return 'critical';
    case 'WARN': return 'recommended';
    default: return 'nice_to_have';
  }
}

/** Call Supabase Advisor API for a single project. */
async function fetchAdvisor(ref: string, token: string): Promise<SupabaseLint[]> {
  const url = `https://api.supabase.com/v1/projects/${ref}/advisors/security`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Supabase Advisor API returned ${response.status} for project ${ref}`);
  }
  const data = await response.json() as { lints?: SupabaseLint[] };
  return data.lints || [];
}

/**
 * Orchestrate Supabase Advisor scans across all discovered projects.
 * Returns both findings and a per-platform status (so the report can say
 * "skipped — no token" transparently).
 */
export async function runSupabaseAdvisor(searchRoots: string[]): Promise<{
  findings: PlatformAdvisorFinding[];
  status: PlatformAdvisorStatus;
}> {
  // Discover projects across all roots
  const allProjects: SupabaseProject[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      allProjects.push(...discoverSupabaseProjects(root));
    }
  }

  if (allProjects.length === 0) {
    return {
      findings: [],
      status: {
        platform: 'supabase',
        status: 'skipped',
        projectsScanned: 0,
        reason: 'No Supabase projects found (no .env files with SUPABASE_URL)',
      },
    };
  }

  const tokenInfo = resolveSupabaseToken();
  if (!tokenInfo) {
    return {
      findings: [],
      status: {
        platform: 'supabase',
        status: 'skipped',
        projectsScanned: 0,
        reason: `${allProjects.length} Supabase project(s) detected but no token available. Set SUPABASE_ACCESS_TOKEN env var or configure 1Password.`,
      },
    };
  }

  const findings: PlatformAdvisorFinding[] = [];
  let scanned = 0;
  const errors: string[] = [];

  for (const project of allProjects) {
    try {
      const lints = await fetchAdvisor(project.ref, tokenInfo.token);
      scanned++;
      for (const lint of lints) {
        findings.push({
          id: `supabase:${project.ref}:${lint.cache_key || lint.name}`,
          platform: 'supabase',
          projectName: project.projectName,
          projectRef: project.ref,
          severity: mapSeverity(lint.level),
          title: lint.title,
          category: lint.name,
          detail: lint.detail || lint.description || '',
          fixUrl: lint.remediation,
          recommendation: `Open Supabase Advisor for \`${project.projectName}\` and address this lint. See: ${lint.remediation || `https://supabase.com/dashboard/project/${project.ref}/database/security-advisor`}`,
        });
      }
    } catch (err) {
      errors.push(`${project.projectName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    findings,
    status: {
      platform: 'supabase',
      status: errors.length > 0 && scanned === 0 ? 'error' : 'ok',
      projectsScanned: scanned,
      reason: errors.length > 0 ? `Errors: ${errors.join('; ')}` : undefined,
    },
  };
}
