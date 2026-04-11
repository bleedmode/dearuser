// Scanner — discovers all collaboration artifacts from filesystem

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { ScanResult, FileInfo } from '../types.js';

function readFile(path: string): FileInfo | null {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    const content = readFileSync(path, 'utf-8');
    return { path, content, size: stat.size, lastModified: stat.mtime };
  } catch {
    return null;
  }
}

function countDirEntries(dir: string, pattern?: RegExp): number {
  try {
    if (!existsSync(dir)) return 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    if (pattern) {
      return entries.filter(e => e.isDirectory() && pattern.test(e.name)).length
        || entries.filter(e => e.isFile() && pattern.test(e.name)).length;
    }
    return entries.filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

function findMemoryFiles(dir: string): FileInfo[] {
  const files: FileInfo[] = [];
  try {
    if (!existsSync(dir)) return files;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith('.md') && entry !== 'MEMORY.md') {
        const info = readFile(join(dir, entry));
        if (info) files.push(info);
      }
    }
  } catch { /* ignore */ }
  return files;
}

function countMcpServers(home: string, projectRoot: string): number {
  let count = 0;

  // Check ~/.claude/mcp.json
  const globalMcp = readFile(join(home, '.claude', 'mcp.json'));
  if (globalMcp) {
    try {
      const data = JSON.parse(globalMcp.content);
      count += Object.keys(data.mcpServers || {}).length;
    } catch { /* ignore */ }
  }

  // Check .mcp.json in project
  const projectMcp = readFile(join(projectRoot, '.mcp.json'));
  if (projectMcp) {
    try {
      const data = JSON.parse(projectMcp.content);
      count += Object.keys(data.mcpServers || {}).length;
    } catch { /* ignore */ }
  }

  return count;
}

function countHooksFromSettings(home: string, projectRoot: string): number {
  let count = 0;
  const settingsPaths = [
    join(home, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json'),
  ];

  for (const path of settingsPaths) {
    const file = readFile(path);
    if (!file) continue;
    try {
      const data = JSON.parse(file.content);
      const hooks = data.hooks || {};
      for (const event of Object.values(hooks)) {
        if (Array.isArray(event)) count += event.length;
      }
    } catch { /* ignore */ }
  }

  return count;
}

export function scan(projectRoot: string): ScanResult {
  const home = homedir();
  const absRoot = resolve(projectRoot);

  // CLAUDE.md files
  const projectClaudeMd = readFile(join(absRoot, 'CLAUDE.md'))
    || readFile(join(absRoot, 'claude.md'));
  const globalClaudeMd = readFile(join(home, '.claude', 'CLAUDE.md'));

  // Memory files — check both project-specific and local memory dirs
  const memoryFiles: FileInfo[] = [];

  // Global project memory (in ~/.claude/projects/)
  // The path format encodes the project path with dashes
  const encodedPath = absRoot.replace(/\//g, '-');
  const projectMemoryDir = join(home, '.claude', 'projects', encodedPath, 'memory');
  memoryFiles.push(...findMemoryFiles(projectMemoryDir));

  // Local memory (in .claude/memory/)
  memoryFiles.push(...findMemoryFiles(join(absRoot, '.claude', 'memory')));

  // Settings files
  const settingsFiles: FileInfo[] = [];
  for (const path of [
    join(home, '.claude', 'settings.json'),
    join(absRoot, '.claude', 'settings.json'),
    join(absRoot, '.claude', 'settings.local.json'),
  ]) {
    const info = readFile(path);
    if (info) settingsFiles.push(info);
  }

  // Count automation artifacts
  const hooksCount = countHooksFromSettings(home, absRoot);
  const skillsCount = countDirEntries(join(home, '.claude', 'skills'));
  const scheduledTasksCount = countDirEntries(join(home, '.claude', 'scheduled-tasks'));
  const commandsCount = countDirEntries(join(absRoot, '.claude', 'commands'), /\.md$/)
    || (() => {
      try {
        return readdirSync(join(absRoot, '.claude', 'commands'))
          .filter(f => f.endsWith('.md')).length;
      } catch { return 0; }
    })();
  const mcpServersCount = countMcpServers(home, absRoot);

  // Competing formats
  const competingFormats = {
    cursorrules: existsSync(join(absRoot, '.cursorrules')),
    agentsMd: existsSync(join(absRoot, 'agents.md')) || existsSync(join(absRoot, 'AGENTS.md')),
    copilotInstructions: existsSync(join(absRoot, '.github', 'copilot-instructions.md')),
  };

  return {
    globalClaudeMd,
    projectClaudeMd,
    memoryFiles,
    settingsFiles,
    hooksCount,
    skillsCount,
    scheduledTasksCount,
    commandsCount,
    mcpServersCount,
    competingFormats,
  };
}
