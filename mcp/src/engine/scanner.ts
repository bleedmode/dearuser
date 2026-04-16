// Scanner — discovers collaboration artifacts from filesystem.
//
// Two scopes:
//   - 'project': look only at the given projectRoot and its matching
//     ~/.claude/projects/<flattened-cwd>/ directory. Use for per-project sanity.
//   - 'global' (default): aggregate memory, settings, and CLAUDE.md files
//     across EVERY project the user has worked in, plus all global config.
//     This is the right mode for collaboration analysis — it's about the
//     human↔agent relationship, which spans projects.

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import type { ScanResult, FileInfo, Scope } from '../types.js';

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

/**
 * Collect MCP server names from a settings/mcp config file.
 * Returns a set of lowercased server names so duplicates across files collapse.
 */
function collectServerNames(configContent: string): string[] {
  try {
    const data = JSON.parse(configContent);
    const servers = data.mcpServers || {};
    return Object.keys(servers).map(s => s.toLowerCase());
  } catch {
    return [];
  }
}

function readSettingsAndMcpConfig(home: string, projectRoot: string | null) {
  const settingsFiles: FileInfo[] = [];
  const serverNameSet = new Set<string>();
  let hooksCount = 0;

  const settingsPaths = [join(home, '.claude', 'settings.json')];
  const mcpPaths = [
    join(home, '.claude.json'),
    join(home, '.claude', 'mcp.json'),
  ];
  if (projectRoot) {
    settingsPaths.push(
      join(projectRoot, '.claude', 'settings.json'),
      join(projectRoot, '.claude', 'settings.local.json'),
    );
    mcpPaths.push(join(projectRoot, '.mcp.json'));
  }

  for (const path of settingsPaths) {
    const info = readFile(path);
    if (!info) continue;
    settingsFiles.push(info);
    try {
      const data = JSON.parse(info.content);
      // Count hook entries across all events
      const hooks = data.hooks || {};
      for (const event of Object.values(hooks)) {
        if (Array.isArray(event)) hooksCount += event.length;
      }
      // settings.json can also hold mcpServers
      for (const n of collectServerNames(info.content)) serverNameSet.add(n);
    } catch { /* ignore malformed */ }
  }

  for (const path of mcpPaths) {
    const info = readFile(path);
    if (!info) continue;
    for (const n of collectServerNames(info.content)) serverNameSet.add(n);
  }

  return {
    settingsFiles,
    installedServers: Array.from(serverNameSet),
    hooksCount,
  };
}

/**
 * List every project directory under ~/.claude/projects/. Each directory name
 * is a flattened absolute path (e.g. -Users-karlomacmini-clawd-poised-dk).
 */
function listProjectDirs(home: string): string[] {
  const base = join(home, '.claude', 'projects');
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(base, e.name));
  } catch {
    return [];
  }
}

/**
 * Discover actual project roots on disk by walking conventional parent dirs
 * one level deep. We can't reliably unflatten ~/.claude/projects/ names (both
 * "/" and "-" collapse to "-"), so we inspect the real filesystem instead.
 *
 * Returns paths that contain a .claude/ directory — those are the projects
 * where hooks and project-level settings can live.
 */
function discoverProjectRoots(home: string): string[] {
  const conventionalParents = [
    join(home, 'clawd'),
    join(home, 'dev'),
    join(home, 'Dev'),
    join(home, 'projects'),
    join(home, 'Projects'),
    join(home, 'code'),
    join(home, 'Code'),
    join(home, 'src'),
    join(home, 'work'),
    join(home, 'Work'),
    join(home, 'repos'),
    join(home, 'github'),
    join(home, 'GitHub'),
  ];

  const found = new Set<string>();
  for (const parent of conventionalParents) {
    if (!existsSync(parent)) continue;
    try {
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = join(parent, entry.name);
        // Has .claude/ → real project where hooks/settings can live
        if (existsSync(join(candidate, '.claude'))) {
          found.add(candidate);
        }
      }
    } catch { /* skip unreadable */ }
  }
  return Array.from(found);
}

/**
 * Un-flatten "-Users-karlomacmini-clawd-poised-dk" → "/Users/karlomacmini/clawd/poised-dk".
 * We can't know where segment boundaries originally were (both "/" and "-" become "-"),
 * so we return the reconstructed path for display only — not for opening files.
 */
function unflattenDisplay(dirName: string): string {
  return '/' + dirName.replace(/^-/, '').replace(/-/g, '/');
}

/**
 * Project-scoped scan — look at one directory and its paired ~/.claude/projects/ entry.
 */
function scanProject(projectRoot: string): ScanResult {
  const home = homedir();
  const absRoot = resolve(projectRoot);

  const projectClaudeMd = readFile(join(absRoot, 'CLAUDE.md'))
    || readFile(join(absRoot, 'claude.md'));
  const globalClaudeMd = readFile(join(home, '.claude', 'CLAUDE.md'));

  const memoryFiles: FileInfo[] = [];
  const encodedPath = absRoot.replace(/\//g, '-');
  memoryFiles.push(...findMemoryFiles(join(home, '.claude', 'projects', encodedPath, 'memory')));
  memoryFiles.push(...findMemoryFiles(join(absRoot, '.claude', 'memory')));

  const { settingsFiles, installedServers, hooksCount } = readSettingsAndMcpConfig(home, absRoot);

  const skillsCount = countDirEntries(join(home, '.claude', 'skills'));
  const scheduledTasksCount = countDirEntries(join(home, '.claude', 'scheduled-tasks'));
  const commandsCount = countDirEntries(join(absRoot, '.claude', 'commands'), /\.md$/);
  const mcpServersCount = installedServers.length;

  const competingFormats = {
    cursorrules: existsSync(join(absRoot, '.cursorrules')),
    agentsMd: existsSync(join(absRoot, 'agents.md')) || existsSync(join(absRoot, 'AGENTS.md')),
    copilotInstructions: existsSync(join(absRoot, '.github', 'copilot-instructions.md')),
  };

  return {
    scope: 'project',
    scanRoots: [absRoot],
    globalClaudeMd,
    projectClaudeMd,
    memoryFiles,
    settingsFiles,
    hooksCount,
    skillsCount,
    scheduledTasksCount,
    commandsCount,
    mcpServersCount,
    installedServers,
    competingFormats,
    projectsObserved: 1,
  };
}

/**
 * Global scan — the default. Aggregates memory and config across ALL projects
 * in ~/.claude/projects/. CLAUDE.md is taken from the user's global file
 * (~/.claude/CLAUDE.md); per-project CLAUDE.md files are intentionally not
 * merged to keep the rule inventory interpretable.
 */
function scanGlobal(): ScanResult {
  const home = homedir();

  const globalClaudeMd = readFile(join(home, '.claude', 'CLAUDE.md'));

  // Memory files: aggregate every ~/.claude/projects/<dir>/memory/*.md
  const memoryFiles: FileInfo[] = [];
  const projectDirs = listProjectDirs(home);
  for (const projDir of projectDirs) {
    memoryFiles.push(...findMemoryFiles(join(projDir, 'memory')));
  }

  // Settings + hooks + MCP servers: aggregate across ALL project-level
  // .claude/settings.json files plus the global one. Previously we only
  // read the global file, which missed hooks defined per-project.
  const realProjectRoots = discoverProjectRoots(home);
  const settingsAggregate = readSettingsAndMcpConfigAggregated(home, realProjectRoots);

  const skillsCount = countDirEntries(join(home, '.claude', 'skills'));
  const scheduledTasksCount = countDirEntries(join(home, '.claude', 'scheduled-tasks'));
  // Global custom commands live under ~/.claude/commands/; we count the skill
  // dir entries that aren't SKILL.md bundles (treat each .md as a command file).
  const commandsCount = countDirEntries(join(home, '.claude', 'commands'), /\.md$/);
  const mcpServersCount = settingsAggregate.installedServers.length;

  // Prefer real discovered project roots over the flattened-name guesses.
  // Fall back to the listProjectDirs view when no real roots are found.
  const scanRoots = realProjectRoots.length > 0
    ? realProjectRoots
    : projectDirs.map(unflattenDisplay);

  return {
    scope: 'global',
    scanRoots,
    globalClaudeMd,
    projectClaudeMd: null,
    memoryFiles,
    settingsFiles: settingsAggregate.settingsFiles,
    hooksCount: settingsAggregate.hooksCount,
    skillsCount,
    scheduledTasksCount,
    commandsCount,
    mcpServersCount,
    installedServers: settingsAggregate.installedServers,
    competingFormats: {
      // Competing formats are a per-project concern; skip detection in global mode.
      cursorrules: false,
      agentsMd: false,
      copilotInstructions: false,
    },
    projectsObserved: Math.max(projectDirs.length, realProjectRoots.length),
  };
}

/**
 * Aggregate hooks + MCP servers + settings files across the global config
 * AND every project-level .claude/ directory we discovered. This replaces
 * readSettingsAndMcpConfig when scanning in global scope.
 */
function readSettingsAndMcpConfigAggregated(home: string, projectRoots: string[]) {
  const settingsFiles: FileInfo[] = [];
  const serverNameSet = new Set<string>();
  let hooksCount = 0;

  // Global files first
  const globalSettingsPaths = [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.local.json'),
  ];
  const globalMcpPaths = [join(home, '.claude', 'mcp.json')];

  const allSettingsPaths = [...globalSettingsPaths];
  const allMcpPaths = [...globalMcpPaths];

  // Add each project's .claude/settings.json and .mcp.json
  for (const root of projectRoots) {
    allSettingsPaths.push(
      join(root, '.claude', 'settings.json'),
      join(root, '.claude', 'settings.local.json'),
    );
    allMcpPaths.push(join(root, '.mcp.json'));
  }

  for (const path of allSettingsPaths) {
    const info = readFile(path);
    if (!info) continue;
    settingsFiles.push(info);
    try {
      const data = JSON.parse(info.content);
      const hooks = data.hooks || {};
      for (const event of Object.values(hooks)) {
        if (Array.isArray(event)) hooksCount += event.length;
      }
      for (const n of collectServerNames(info.content)) serverNameSet.add(n);
    } catch { /* ignore malformed */ }
  }

  for (const path of allMcpPaths) {
    const info = readFile(path);
    if (!info) continue;
    for (const n of collectServerNames(info.content)) serverNameSet.add(n);
  }

  return {
    settingsFiles,
    installedServers: Array.from(serverNameSet),
    hooksCount,
  };
}

/**
 * Unified entry point. Defaults to global scope — collaboration quality is
 * a property of the human↔agent pair, not of any single project.
 */
export function scan(projectRoot?: string, scope: Scope = 'global'): ScanResult {
  if (scope === 'project') {
    if (!projectRoot) {
      // Callers should always pass a root for project scope; fall back to cwd.
      return scanProject(process.cwd());
    }
    return scanProject(projectRoot);
  }
  return scanGlobal();
}
