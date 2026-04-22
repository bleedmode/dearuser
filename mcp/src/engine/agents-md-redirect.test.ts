import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { followAgentsMdRedirect } from './agents-md-redirect.js';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ScanResult } from '../types.js';

function makeScan(claudeMdPath: string, claudeMdContent: string): ScanResult {
  return {
    scope: 'project',
    scanRoots: [],
    globalClaudeMd: null,
    projectClaudeMd: {
      path: claudeMdPath,
      content: claudeMdContent,
      size: Buffer.byteLength(claudeMdContent, 'utf8'),
    },
    memoryFiles: [],
    settingsFiles: [],
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    installedServers: [],
    competingFormats: { cursorrules: false, agentsMd: false, copilotInstructions: false },
    projectsObserved: 1,
  };
}

describe('followAgentsMdRedirect (R2 calibration)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'du-redirect-'));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('swaps CLAUDE.md content for AGENTS.md content when CLAUDE.md is a small redirect', () => {
    const claudeMdPath = join(dir, 'CLAUDE.md');
    const agentsMdPath = join(dir, 'AGENTS.md');
    const redirectStub = 'Please read and strictly follow the rules defined in ./AGENTS.md';
    const realContract = '# Real Agent Contract\n\nYou are a product-obsessed engineer. Follow these rules.\n';

    writeFileSync(claudeMdPath, redirectStub);
    writeFileSync(agentsMdPath, realContract);

    const scan = makeScan(claudeMdPath, redirectStub);
    const redirect = followAgentsMdRedirect(scan);

    expect(redirect).toBeDefined();
    expect(redirect?.agentsMdPath).toBe(agentsMdPath);
    expect(scan.projectClaudeMd!.content).toContain('Real Agent Contract');
  });

  it('does NOT follow when CLAUDE.md is large (real content, not a redirect)', () => {
    const big = '# My Agent Contract\n' + 'Rule. '.repeat(200); // > 500 bytes
    const claudeMdPath = join(dir, 'CLAUDE.md');
    const agentsMdPath = join(dir, 'AGENTS.md');

    writeFileSync(claudeMdPath, big);
    writeFileSync(agentsMdPath, 'Other content');

    const scan = makeScan(claudeMdPath, big);
    const redirect = followAgentsMdRedirect(scan);

    expect(redirect).toBeUndefined();
    expect(scan.projectClaudeMd!.content).toBe(big);
  });

  it('does NOT follow when CLAUDE.md is small but does not reference AGENTS.md', () => {
    const claudeMdPath = join(dir, 'CLAUDE.md');
    const stub = 'tiny notes, nothing about agents';
    writeFileSync(claudeMdPath, stub);

    const scan = makeScan(claudeMdPath, stub);
    const redirect = followAgentsMdRedirect(scan);
    expect(redirect).toBeUndefined();
  });

  it('does NOT follow when AGENTS.md is missing even if CLAUDE.md mentions it', () => {
    const claudeMdPath = join(dir, 'CLAUDE.md');
    const stub = 'See AGENTS.md for rules.';
    writeFileSync(claudeMdPath, stub);
    // No AGENTS.md written.

    const scan = makeScan(claudeMdPath, stub);
    const redirect = followAgentsMdRedirect(scan);
    expect(redirect).toBeUndefined();
  });
});
