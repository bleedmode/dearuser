// GitHub advisor orchestrator
//
// Discovers GitHub repos by walking the search roots and reading .git/config
// for each repository. Calls Dependabot alerts + secret-scanning alerts via
// `gh` CLI (requires gh authenticated — transparent skip otherwise).
//
// We do NOT duplicate what GitHub scans (deps, secrets). We aggregate.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PlatformAdvisorFinding, PlatformAdvisorStatus, GapSeverity } from '../types.js';

export interface GitHubRepo {
  slug: string; // "owner/repo"
  projectName: string;
  localPath: string;
}

/** Parse a git config file and extract github owner/repo if the origin points to GitHub. */
function parseGitHubRemote(gitConfigPath: string): string | undefined {
  try {
    const content = fs.readFileSync(gitConfigPath, 'utf-8');
    // SSH: git@github.com:owner/repo.git   HTTPS: https://github.com/owner/repo.git
    const match = content.match(/github\.com[:/]([^/\s]+\/[^/\s.]+)(?:\.git)?/);
    return match ? match[1].replace(/\.git$/, '') : undefined;
  } catch {
    return undefined;
  }
}

/** Walk search roots looking for git repos with GitHub remotes. */
export function discoverGitHubRepos(searchRoot: string): GitHubRepo[] {
  const found: GitHubRepo[] = [];
  const seenSlugs = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // If this dir has a .git subdir, it's a repo root — check the remote
    const gitConfig = path.join(dir, '.git', 'config');
    if (fs.existsSync(gitConfig)) {
      const slug = parseGitHubRemote(gitConfig);
      if (slug && !seenSlugs.has(slug)) {
        seenSlugs.add(slug);
        found.push({
          slug,
          projectName: path.basename(dir),
          localPath: dir,
        });
      }
      return; // don't recurse into repo subdirs
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

interface DependabotAlert {
  state: string;
  security_advisory?: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    summary: string;
    cve_id?: string | null;
    ghsa_id?: string;
  };
  security_vulnerability?: {
    package?: { name: string };
    vulnerable_version_range?: string;
  };
  html_url?: string;
  number?: number;
}

interface SecretScanningAlert {
  state: string;
  secret_type_display_name?: string;
  secret_type?: string;
  html_url?: string;
  number?: number;
}

/** Check if `gh` CLI is installed and authenticated. */
function isGhAvailable(): boolean {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Call GitHub API via gh CLI. Returns parsed JSON or throws a structured error. */
function ghApi(endpoint: string): unknown {
  const out = execFileSync('gh', ['api', endpoint], { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

function mapSeverity(level: string): GapSeverity {
  switch (level) {
    case 'critical': return 'critical';
    case 'high': return 'critical';
    case 'medium': return 'recommended';
    default: return 'nice_to_have';
  }
}

/** Orchestrate GitHub advisor scans across discovered repos. */
export async function runGitHubAdvisor(searchRoots: string[]): Promise<{
  findings: PlatformAdvisorFinding[];
  status: PlatformAdvisorStatus;
}> {
  if (!isGhAvailable()) {
    return {
      findings: [],
      status: {
        platform: 'github',
        status: 'skipped',
        projectsScanned: 0,
        reason: '`gh` CLI not installed or not authenticated. Run: gh auth login',
      },
    };
  }

  const allRepos: GitHubRepo[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      allRepos.push(...discoverGitHubRepos(root));
    }
  }

  if (allRepos.length === 0) {
    return {
      findings: [],
      status: {
        platform: 'github',
        status: 'skipped',
        projectsScanned: 0,
        reason: 'No GitHub repos found in search roots',
      },
    };
  }

  const findings: PlatformAdvisorFinding[] = [];
  let scanned = 0;
  const notes: string[] = [];

  for (const repo of allRepos) {
    let repoCountedAsScanned = false;

    // Dependabot alerts
    try {
      const alerts = ghApi(`repos/${repo.slug}/dependabot/alerts?state=open&per_page=50`) as DependabotAlert[];
      if (Array.isArray(alerts)) {
        repoCountedAsScanned = true;
        for (const alert of alerts) {
          const sev = alert.security_advisory?.severity || 'low';
          const pkg = alert.security_vulnerability?.package?.name || 'dependency';
          const range = alert.security_vulnerability?.vulnerable_version_range || '';
          findings.push({
            id: `github:dependabot:${repo.slug}:${alert.number}`,
            platform: 'github',
            projectName: repo.projectName,
            projectRef: repo.slug,
            severity: mapSeverity(sev),
            title: `${alert.security_advisory?.summary || 'Vulnerable dependency'} (${pkg})`,
            category: `dependabot_${sev}`,
            detail: `${pkg}${range ? ` ${range}` : ''} — ${alert.security_advisory?.cve_id || alert.security_advisory?.ghsa_id || 'GHSA'}`,
            fixUrl: alert.html_url,
            recommendation: `Review and patch dependency via GitHub Dependabot dashboard`,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 403 typically means alerts disabled for private repo — inform, don't fail
      if (msg.includes('403') || msg.toLowerCase().includes('disabled')) {
        findings.push({
          id: `github:dependabot-disabled:${repo.slug}`,
          platform: 'github',
          projectName: repo.projectName,
          projectRef: repo.slug,
          severity: 'nice_to_have',
          title: 'Dependabot alerts are disabled',
          category: 'dependabot_disabled',
          detail: 'GitHub cannot warn you about vulnerable dependencies until you enable Dependabot for this repo.',
          fixUrl: `https://github.com/${repo.slug}/settings/security_analysis`,
          recommendation: 'Enable Dependabot alerts under Security & analysis settings',
        });
        repoCountedAsScanned = true;
      } else {
        notes.push(`${repo.slug} (dependabot): ${msg.slice(0, 80)}`);
      }
    }

    // Secret scanning alerts
    try {
      const alerts = ghApi(`repos/${repo.slug}/secret-scanning/alerts?state=open&per_page=50`) as SecretScanningAlert[];
      if (Array.isArray(alerts)) {
        for (const alert of alerts) {
          findings.push({
            id: `github:secret:${repo.slug}:${alert.number}`,
            platform: 'github',
            projectName: repo.projectName,
            projectRef: repo.slug,
            severity: 'critical',
            title: `Leaked secret detected — ${alert.secret_type_display_name || alert.secret_type || 'credential'}`,
            category: 'secret_scanning_alert',
            detail: 'GitHub detected a real credential in your repository. Rotate immediately.',
            fixUrl: alert.html_url,
            recommendation: 'Rotate the credential and revoke the old one. Then dismiss the alert.',
          });
        }
      }
    } catch {
      // secret scanning requires GHAS (paid) — silently skip if not available
    }

    if (repoCountedAsScanned) scanned++;
  }

  return {
    findings,
    status: {
      platform: 'github',
      status: scanned > 0 ? 'ok' : 'error',
      projectsScanned: scanned,
      reason: notes.length > 0 ? `Some repos errored: ${notes.slice(0, 3).join('; ')}` : undefined,
    },
  };
}
