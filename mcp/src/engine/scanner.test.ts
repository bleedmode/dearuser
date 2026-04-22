// scanner.test.ts — AGENTS.md native support
//
// Dear User treats AGENTS.md (Linux Foundation cross-tool standard) as a
// first-class input alongside CLAUDE.md. Users of Cursor, Codex, Aider,
// Cline, and Zed frequently have an AGENTS.md but no CLAUDE.md — if the
// scanner only looked at CLAUDE.md they'd install Dear User and see an
// empty report. These tests lock the behavior down.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scan } from './scanner.js';
import { parse } from './parser.js';

describe('scanner — AGENTS.md native support', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'du-scanner-agents-'));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('discovers AGENTS.md when CLAUDE.md is absent', () => {
    const agentsContent = '# Agent Contract\n\nYou are helpful. Never delete files without asking first.\n';
    writeFileSync(join(dir, 'AGENTS.md'), agentsContent);

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd).not.toBeNull();
    expect(result.projectClaudeMd?.content).toContain('Agent Contract');
    expect(result.projectClaudeMd?.kind).toBe('agents');
  });

  it('discovers lowercase agents.md', () => {
    writeFileSync(join(dir, 'agents.md'), '# Lowercase agents.md\n\nRules here.');

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd).not.toBeNull();
    expect(result.projectClaudeMd?.content).toContain('Lowercase agents.md');
    expect(result.projectClaudeMd?.kind).toBe('agents');
  });

  it('discovers singular agent.md (Cursor-style variant)', () => {
    writeFileSync(join(dir, 'agent.md'), '# Singular agent.md\n\nRules.');

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd).not.toBeNull();
    expect(result.projectClaudeMd?.content).toContain('Singular agent.md');
    expect(result.projectClaudeMd?.kind).toBe('agents');
  });

  it('discovers .agents.md dotfile variant', () => {
    writeFileSync(join(dir, '.agents.md'), '# Dotfile .agents.md\n\nRules.');

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd).not.toBeNull();
    expect(result.projectClaudeMd?.content).toContain('Dotfile');
    expect(result.projectClaudeMd?.kind).toBe('agents');
  });

  it('merges CLAUDE.md + AGENTS.md when both exist in same directory', () => {
    const claudeContent = '# CLAUDE.md\n\nClaude-specific rule: use Danish when user writes in Danish.';
    const agentsContent = '# AGENTS.md\n\nCross-tool rule: always write tests.';
    writeFileSync(join(dir, 'CLAUDE.md'), claudeContent);
    writeFileSync(join(dir, 'AGENTS.md'), agentsContent);

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd).not.toBeNull();
    expect(result.projectClaudeMd?.kind).toBe('merged');
    expect(result.projectClaudeMd?.content).toContain('Claude-specific rule');
    expect(result.projectClaudeMd?.content).toContain('Cross-tool rule');
    expect(result.projectClaudeMd?.mergedPaths?.length).toBe(2);
  });

  it('prefers canonical AGENTS.md over variants when multiple exist', () => {
    // Note: macOS filesystem is case-insensitive so we can't reliably create
    // both CLAUDE.md and claude.md in the same dir. Instead we verify that
    // AGENTS.md wins over agent.md / .agents.md when those coexist.
    writeFileSync(join(dir, 'AGENTS.md'), 'canonical agents');
    writeFileSync(join(dir, 'agent.md'), 'singular variant should be second');
    writeFileSync(join(dir, '.agents.md'), 'dotfile variant should be third');

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd?.content).toBe('canonical agents');
    expect(result.projectClaudeMd?.path.endsWith('AGENTS.md')).toBe(true);
    expect(result.projectClaudeMd?.kind).toBe('agents');
  });

  it('marks a CLAUDE.md-only scan with kind: claude', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Regular CLAUDE.md');

    const result = scan(dir, 'project');

    expect(result.projectClaudeMd?.kind).toBe('claude');
  });

  it('parser extracts rules from AGENTS.md content unchanged', () => {
    const agentsContent = `# Agent Contract

## Rules
- Never commit without tests
- Always ask before deleting files
- Do yourself: run build, commit, push

## Autonomy
You may run linters without asking.
`;
    writeFileSync(join(dir, 'AGENTS.md'), agentsContent);

    const result = scan(dir, 'project');
    expect(result.projectClaudeMd).not.toBeNull();

    const parsed = parse(result);
    // Parser is content-based — it should pull rules out of AGENTS.md just
    // like it does from CLAUDE.md.
    expect(parsed.rules.length).toBeGreaterThan(0);
    const prohibitions = parsed.rules.filter(r => r.type === 'prohibition');
    expect(prohibitions.length).toBeGreaterThan(0);
  });

  it('returns null when neither CLAUDE.md nor AGENTS.md exist', () => {
    // Empty directory
    const result = scan(dir, 'project');
    expect(result.projectClaudeMd).toBeNull();
  });

  it('honours AGENTS.md in nested .claude/ style global scan location', () => {
    // Simulate a global config directory layout with AGENTS.md instead of CLAUDE.md.
    const home = join(dir, 'fakehome');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'AGENTS.md'), '# Global agent contract');
    // Project root with no contract of its own
    const projRoot = join(dir, 'proj');
    mkdirSync(projRoot);

    // Bend HOME so the project scan sees our fake global config.
    const origHome = process.env.HOME;
    process.env.HOME = home;
    try {
      const result = scan(projRoot, 'project');
      expect(result.globalClaudeMd).not.toBeNull();
      expect(result.globalClaudeMd?.content).toContain('Global agent contract');
      expect(result.globalClaudeMd?.kind).toBe('agents');
    } finally {
      process.env.HOME = origHome;
    }
  });
});
