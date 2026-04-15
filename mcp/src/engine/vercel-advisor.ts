// Vercel advisor orchestrator
//
// Discovers Vercel-linked projects via .vercel/project.json (created by
// `vercel link` or `vercel deploy`). Calls the Vercel Management API to audit
// env vars — flags any production env var stored as "plain" instead of
// "encrypted". Plain env vars are visible to anyone with project access.
//
// Unlike Supabase/GitHub, Vercel has no single "security advisor" endpoint —
// this is the most security-relevant API-level signal available.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import type { PlatformAdvisorFinding, PlatformAdvisorStatus, GapSeverity } from '../types.js';

export interface VercelProject {
  projectId: string;
  projectName: string;
  orgId?: string;
  localPath: string;
}

/** Look for .vercel/project.json files. */
export function discoverVercelProjects(searchRoot: string): VercelProject[] {
  const found: VercelProject[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const vercelProject = path.join(dir, '.vercel', 'project.json');
    if (fs.existsSync(vercelProject)) {
      try {
        const data = JSON.parse(fs.readFileSync(vercelProject, 'utf-8')) as {
          projectId?: string;
          orgId?: string;
          projectName?: string;
        };
        if (data.projectId && !seen.has(data.projectId)) {
          seen.add(data.projectId);
          found.push({
            projectId: data.projectId,
            orgId: data.orgId,
            projectName: data.projectName || path.basename(dir),
            localPath: dir,
          });
        }
      } catch {
        /* malformed, skip */
      }
      return; // don't recurse once we've found a linked project
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(searchRoot, 0);
  return found;
}

export function resolveVercelToken(): { token: string; source: string } | undefined {
  if (process.env.VERCEL_TOKEN) {
    return { token: process.env.VERCEL_TOKEN, source: 'env:VERCEL_TOKEN' };
  }
  const opTokenPath = path.join(os.homedir(), '.config', 'openclaw', 'op-token');
  if (fs.existsSync(opTokenPath)) {
    try {
      const opToken = fs.readFileSync(opTokenPath, 'utf-8').trim();
      const token = execSync(
        'op item get "Vercel access token" --vault Bobby --fields label=password --reveal',
        { env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: opToken }, encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (token) return { token, source: '1password:Bobby' };
    } catch {
      /* fall through */
    }
  }
  return undefined;
}

interface VercelEnvVar {
  id?: string;
  key: string;
  type: 'plain' | 'encrypted' | 'secret' | 'system' | 'sensitive';
  target?: string[];
  value?: string;
}

async function fetchEnvVars(projectId: string, orgId: string | undefined, token: string): Promise<VercelEnvVar[]> {
  const query = orgId ? `?teamId=${orgId}` : '';
  const url = `https://api.vercel.com/v9/projects/${projectId}/env${query}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Vercel API ${response.status} for project ${projectId}`);
  const data = await response.json() as { envs?: VercelEnvVar[] };
  return data.envs || [];
}

export async function runVercelAdvisor(searchRoots: string[]): Promise<{
  findings: PlatformAdvisorFinding[];
  status: PlatformAdvisorStatus;
}> {
  const allProjects: VercelProject[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      allProjects.push(...discoverVercelProjects(root));
    }
  }

  if (allProjects.length === 0) {
    return {
      findings: [],
      status: { platform: 'vercel', status: 'skipped', projectsScanned: 0, reason: 'No Vercel-linked projects found (no .vercel/project.json)' },
    };
  }

  const tokenInfo = resolveVercelToken();
  if (!tokenInfo) {
    return {
      findings: [],
      status: {
        platform: 'vercel',
        status: 'skipped',
        projectsScanned: 0,
        reason: `${allProjects.length} Vercel project(s) found but no token. Set VERCEL_TOKEN or configure 1Password.`,
      },
    };
  }

  const findings: PlatformAdvisorFinding[] = [];
  let scanned = 0;
  const errors: string[] = [];

  for (const project of allProjects) {
    try {
      const envs = await fetchEnvVars(project.projectId, project.orgId, tokenInfo.token);
      scanned++;

      for (const env of envs) {
        // Flag plaintext env vars in production
        if (env.type === 'plain' && env.target?.includes('production')) {
          const severity: GapSeverity = 'recommended';
          findings.push({
            id: `vercel:plain-env:${project.projectId}:${env.key}`,
            platform: 'vercel',
            projectName: project.projectName,
            projectRef: project.projectId,
            severity,
            title: `Env var \`${env.key}\` stored as plain (not encrypted)`,
            category: 'vercel_plain_env',
            detail: `Production env var "${env.key}" is type="plain" — visible in dashboard to anyone with project access. If this holds any secret, it should be type="encrypted".`,
            fixUrl: `https://vercel.com/dashboard/project/${project.projectId}/settings/environment-variables`,
            recommendation: 'If this contains a secret, delete it and re-add it as an encrypted variable.',
          });
        }
      }
    } catch (err) {
      errors.push(`${project.projectName}: ${err instanceof Error ? err.message.slice(0, 80) : 'fetch failed'}`);
    }
  }

  return {
    findings,
    status: {
      platform: 'vercel',
      status: scanned > 0 ? 'ok' : (errors.length > 0 ? 'error' : 'skipped'),
      projectsScanned: scanned,
      reason: errors.length > 0 ? `Errors: ${errors.slice(0, 3).join('; ')}` : undefined,
    },
  };
}
