// audit-scanner — discover artifacts (skills, scheduled tasks, commands,
// hooks, memory files, MCP servers) for the audit tool.
//
// Distinct from engine/scanner.ts, which counts things but doesn't open them.
// Audit needs to read prompt content so we can extract produces/consumes edges.

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AuditArtifact } from '../types.js';

/** Parse YAML-ish frontmatter from a markdown file. Returns the map plus the body. */
function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { fm: {}, body: content };

  const fm: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      // Strip surrounding quotes if present
      let value = kv[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      fm[kv[1]] = value;
    }
  }
  return { fm, body: match[2] };
}

/** First non-empty, non-header line of a body — used as fallback description. */
function firstContentLine(body: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('```')) continue;
    return trimmed.slice(0, 200);
  }
  return '';
}

interface FileStatInfo {
  content: string;
  path: string;
  size: number;
  mtime: Date;
}

/** Read a SKILL.md-style file from a directory. Returns null if not found. */
function readSkillFile(dir: string): FileStatInfo | null {
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(skillPath)) return null;
  try {
    const stat = statSync(skillPath);
    const content = readFileSync(skillPath, 'utf-8');
    return {
      content,
      path: skillPath,
      size: Number(stat.size),
      mtime: stat.mtime,
    };
  } catch {
    return null;
  }
}

/** Scan skills: ~/.claude/skills/<name>/SKILL.md */
function scanSkills(home: string): AuditArtifact[] {
  const skillsDir = join(home, '.claude', 'skills');
  if (!existsSync(skillsDir)) return [];

  const artifacts: AuditArtifact[] = [];
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = readSkillFile(join(skillsDir, entry.name));
      if (!file) continue;

      const { fm, body } = parseFrontmatter(file.content);
      artifacts.push({
        id: `skill:${fm.name || entry.name}`,
        type: 'skill',
        name: fm.name || entry.name,
        path: file.path,
        description: fm.description || firstContentLine(body),
        prompt: body,
        metadata: {
          lastModified: file.mtime,
          size: file.size,
          frontmatter: fm,
        },
      });
    }
  } catch { /* ignore */ }
  return artifacts;
}

/** Scan scheduled tasks: ~/.claude/scheduled-tasks/<name>/SKILL.md */
function scanScheduledTasks(home: string): AuditArtifact[] {
  const dir = join(home, '.claude', 'scheduled-tasks');
  if (!existsSync(dir)) return [];

  const artifacts: AuditArtifact[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = readSkillFile(join(dir, entry.name));
      if (!file) continue;

      const { fm, body } = parseFrontmatter(file.content);
      artifacts.push({
        id: `scheduled_task:${fm.name || entry.name}`,
        type: 'scheduled_task',
        name: fm.name || entry.name,
        path: file.path,
        description: fm.description || firstContentLine(body),
        prompt: body,
        metadata: {
          lastModified: file.mtime,
          size: file.size,
          frontmatter: fm,
        },
      });
    }
  } catch { /* ignore */ }
  return artifacts;
}

/** Scan commands: ~/.claude/commands/*.md (each file is a command). */
function scanCommands(home: string): AuditArtifact[] {
  const dir = join(home, '.claude', 'commands');
  if (!existsSync(dir)) return [];

  const artifacts: AuditArtifact[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const path = join(dir, entry.name);
      try {
        const stat = statSync(path);
        const content = readFileSync(path, 'utf-8');
        const { fm, body } = parseFrontmatter(content);
        const name = fm.name || entry.name.replace(/\.md$/, '');
        artifacts.push({
          id: `command:${name}`,
          type: 'command',
          name,
          path,
          description: fm.description || firstContentLine(body),
          prompt: body,
          metadata: {
            lastModified: stat.mtime,
            size: stat.size,
            frontmatter: fm,
          },
        });
      } catch { /* ignore single file */ }
    }
  } catch { /* ignore */ }
  return artifacts;
}

/**
 * Scan hooks from ~/.claude/settings.json. Each hook is an artifact because
 * it runs in response to events and may read/write files.
 */
function scanHooks(home: string): AuditArtifact[] {
  const settingsPath = join(home, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return [];

  const artifacts: AuditArtifact[] = [];
  try {
    const stat = statSync(settingsPath);
    const content = readFileSync(settingsPath, 'utf-8');
    const data = JSON.parse(content);
    const hooks = data.hooks || {};

    for (const [event, eventHooks] of Object.entries(hooks)) {
      if (!Array.isArray(eventHooks)) continue;
      for (let i = 0; i < eventHooks.length; i++) {
        const hook = eventHooks[i];
        // Hook shape varies; extract command or description
        const command = hook?.command || hook?.hooks?.[0]?.command || '';
        const matcher = hook?.matcher || '';
        const description = matcher
          ? `${event} hook for ${matcher}: ${command.slice(0, 120)}`
          : `${event} hook: ${command.slice(0, 120)}`;

        artifacts.push({
          id: `hook:${event}:${i}`,
          type: 'hook',
          name: `${event}[${i}]`,
          path: settingsPath,
          description,
          prompt: typeof command === 'string' ? command : JSON.stringify(hook),
          metadata: {
            lastModified: stat.mtime,
            size: 0,
            frontmatter: { event, matcher },
          },
        });
      }
    }
  } catch { /* ignore malformed */ }
  return artifacts;
}

/**
 * Scan MCP servers from ~/.claude/mcp.json and ~/.claude/settings.json.
 * Artifacts so we can reason about which are referenced by skills/hooks.
 */
function scanMcpServers(home: string): AuditArtifact[] {
  const candidates = [
    join(home, '.claude', 'mcp.json'),
    join(home, '.claude', 'settings.json'),
  ];
  const seen = new Set<string>();
  const artifacts: AuditArtifact[] = [];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const stat = statSync(path);
      const content = readFileSync(path, 'utf-8');
      const data = JSON.parse(content);
      const servers = data.mcpServers || {};
      for (const [name, config] of Object.entries(servers)) {
        const lower = name.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);

        const cfg = config as { command?: string; args?: string[]; url?: string };
        const description = cfg.command
          ? `MCP server — command: ${cfg.command} ${(cfg.args || []).join(' ')}`.slice(0, 200)
          : cfg.url
            ? `MCP server — url: ${cfg.url}`
            : `MCP server ${name}`;

        artifacts.push({
          id: `mcp_server:${lower}`,
          type: 'mcp_server',
          name,
          path,
          description,
          prompt: JSON.stringify(config),
          metadata: {
            lastModified: stat.mtime,
            size: 0,
          },
        });
      }
    } catch { /* ignore malformed */ }
  }
  return artifacts;
}

/**
 * Count list-like entries in a memory-file body. Used to flag substrate
 * mismatch (markdown being used as a database).
 */
function countStructuredEntries(content: string): { entryCount: number; structured: boolean } {
  // Strip frontmatter first so it doesn't skew the count
  const { body } = parseFrontmatter(content);

  // Bullet-list entries
  const bullets = (body.match(/^\s*[-*+]\s+/gm) || []).length;
  // Numbered list entries
  const numbered = (body.match(/^\s*\d+\.\s+/gm) || []).length;
  // --- separated blocks (often used as "record" separators)
  const dashBlocks = (body.match(/^---\s*$/gm) || []).length;
  // Horizontal rules between ## sections (also record-like)
  const h2Sections = (body.match(/^##\s+/gm) || []).length;

  // Structured signals: dates, IDs, key:value patterns
  const dateLines = (body.match(/\d{4}-\d{2}-\d{2}/g) || []).length;
  const kvPattern = (body.match(/^\s*[\w-]+:\s+\S+/gm) || []).length;

  const entryCount = Math.max(bullets, numbered, dashBlocks + 1, h2Sections);
  // "Structured" = at least 5 entries AND meaningful date/kv density
  const structured = entryCount >= 5 && (dateLines >= 3 || kvPattern >= 5);

  return { entryCount, structured };
}

/**
 * Scan memory files from ~/.claude/projects/<flattened-path>/memory/*.md.
 * Each memory file is an artifact because it can drift into being a database.
 */
function scanMemoryFiles(home: string): AuditArtifact[] {
  const projectsBase = join(home, '.claude', 'projects');
  if (!existsSync(projectsBase)) return [];

  const artifacts: AuditArtifact[] = [];
  try {
    const projectDirs = readdirSync(projectsBase, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(projectsBase, e.name, 'memory'));

    for (const memDir of projectDirs) {
      if (!existsSync(memDir)) continue;
      try {
        const files = readdirSync(memDir, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith('.md')) continue;
          if (f.name === 'MEMORY.md') continue; // index, not a memory
          const path = join(memDir, f.name);
          try {
            const stat = statSync(path);
            const content = readFileSync(path, 'utf-8');
            const { fm, body } = parseFrontmatter(content);
            const { entryCount, structured } = countStructuredEntries(content);

            artifacts.push({
              id: `memory_file:${f.name}`,
              type: 'memory_file',
              name: fm.name || f.name.replace(/\.md$/, ''),
              path,
              description: fm.description || firstContentLine(body),
              prompt: body,
              metadata: {
                lastModified: stat.mtime,
                size: stat.size,
                frontmatter: fm,
                entryCount,
                structuredEntries: structured,
              },
            });
          } catch { /* ignore single file */ }
        }
      } catch { /* ignore dir */ }
    }
  } catch { /* ignore base */ }
  return artifacts;
}

/**
 * Full audit scan — returns every artifact we can see in the user's AI stack.
 * Deduplicates memory files across project directories since flattened paths
 * often collide.
 */
export function scanArtifacts(): AuditArtifact[] {
  const home = homedir();
  return [
    ...scanSkills(home),
    ...scanScheduledTasks(home),
    ...scanCommands(home),
    ...scanHooks(home),
    ...scanMcpServers(home),
    ...scanMemoryFiles(home),
  ];
}
