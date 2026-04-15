// npm advisor orchestrator
//
// Discovers projects with package.json + package-lock.json in the search roots,
// runs `npm audit --json` per project, aggregates vulnerabilities.
//
// Requires node_modules to be installed (npm audit works on lockfile + installed
// deps). Skips projects that don't have a lockfile.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PlatformAdvisorFinding, PlatformAdvisorStatus, GapSeverity } from '../types.js';

export interface NpmProject {
  projectName: string;
  localPath: string;
}

export function discoverNpmProjects(searchRoot: string): NpmProject[] {
  const found: NpmProject[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Does this dir have package.json AND a lockfile? (audit needs lockfile)
    const hasPkg = entries.some(e => e.isFile() && e.name === 'package.json');
    const hasLock = entries.some(e => e.isFile() && (e.name === 'package-lock.json' || e.name === 'npm-shrinkwrap.json'));
    if (hasPkg && hasLock) {
      const rel = path.relative(searchRoot, dir);
      const projectName = rel ? rel.split(path.sep)[0] : path.basename(dir);
      if (!seen.has(dir)) {
        seen.add(dir);
        found.push({ projectName, localPath: dir });
      }
      // don't recurse into sub-packages
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(searchRoot, 0);
  return found;
}

interface NpmAuditResult {
  metadata?: {
    vulnerabilities?: Record<string, number>;
    totalDependencies?: number;
  };
  vulnerabilities?: Record<string, {
    name?: string;
    severity?: 'low' | 'moderate' | 'high' | 'critical';
    via?: Array<string | { title?: string; url?: string; source?: number }>;
    fixAvailable?: boolean | { name: string; version: string; isSemVerMajor: boolean };
  }>;
}

function mapSeverity(sev: string): GapSeverity {
  switch (sev) {
    case 'critical': return 'critical';
    case 'high': return 'critical';
    case 'moderate': return 'recommended';
    default: return 'nice_to_have';
  }
}

export async function runNpmAdvisor(searchRoots: string[]): Promise<{
  findings: PlatformAdvisorFinding[];
  status: PlatformAdvisorStatus;
}> {
  const allProjects: NpmProject[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      allProjects.push(...discoverNpmProjects(root));
    }
  }

  if (allProjects.length === 0) {
    return {
      findings: [],
      status: { platform: 'npm', status: 'skipped', projectsScanned: 0, reason: 'No npm projects with lockfile found' },
    };
  }

  const findings: PlatformAdvisorFinding[] = [];
  let scanned = 0;
  const errors: string[] = [];

  for (const project of allProjects) {
    try {
      const raw = execFileSync('npm', ['audit', '--json'], {
        cwd: project.localPath,
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const audit = JSON.parse(raw) as NpmAuditResult;
      scanned++;

      for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities || {})) {
        if (!vuln.severity || vuln.severity === 'low') continue; // skip noise
        const sources = (vuln.via || []).filter((v): v is { title?: string; url?: string; source?: number } => typeof v === 'object');
        const firstSource = sources[0];
        findings.push({
          id: `npm:${project.projectName}:${pkgName}:${vuln.severity}`,
          platform: 'npm',
          projectName: project.projectName,
          projectRef: pkgName,
          severity: mapSeverity(vuln.severity),
          title: firstSource?.title || `${pkgName}: ${vuln.severity} severity vulnerability`,
          category: `npm_${vuln.severity}`,
          detail: `${pkgName} has ${vuln.severity} vulnerability${vuln.fixAvailable ? ' (fix available)' : ''}`,
          fixUrl: firstSource?.url,
          recommendation: vuln.fixAvailable
            ? `Run \`npm audit fix\` in ${project.projectName} to patch`
            : `No direct fix available — review advisory or replace dependency`,
        });
      }
    } catch (err) {
      const e = err as { stdout?: Buffer; message?: string };
      // npm audit exits non-zero when vulns found, but still outputs JSON on stdout
      try {
        if (e.stdout) {
          const audit = JSON.parse(e.stdout.toString()) as NpmAuditResult;
          scanned++;
          for (const [pkgName, vuln] of Object.entries(audit.vulnerabilities || {})) {
            if (!vuln.severity || vuln.severity === 'low') continue;
            const sources = (vuln.via || []).filter((v): v is { title?: string; url?: string; source?: number } => typeof v === 'object');
            const firstSource = sources[0];
            findings.push({
              id: `npm:${project.projectName}:${pkgName}:${vuln.severity}`,
              platform: 'npm',
              projectName: project.projectName,
              projectRef: pkgName,
              severity: mapSeverity(vuln.severity),
              title: firstSource?.title || `${pkgName}: ${vuln.severity} severity`,
              category: `npm_${vuln.severity}`,
              detail: `${pkgName} has ${vuln.severity} vulnerability${vuln.fixAvailable ? ' (fix available)' : ''}`,
              fixUrl: firstSource?.url,
              recommendation: vuln.fixAvailable ? `Run \`npm audit fix\` in ${project.projectName}` : 'Review advisory manually',
            });
          }
          continue;
        }
      } catch {
        /* fallthrough */
      }
      errors.push(`${project.projectName}: ${e.message?.slice(0, 80) || 'npm audit failed'}`);
    }
  }

  return {
    findings,
    status: {
      platform: 'npm',
      status: scanned > 0 ? 'ok' : (errors.length > 0 ? 'error' : 'skipped'),
      projectsScanned: scanned,
      reason: errors.length > 0 ? `Errors: ${errors.slice(0, 3).join('; ')}` : undefined,
    },
  };
}
