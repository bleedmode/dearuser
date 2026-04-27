// fetch-expand.ts — expand the substrate corpus candidate pool beyond the 440
// found by the original fetch.ts. Strategy: broaden the search space using
// language-stratified, size-stratified, and new path queries. Appends to
// data/candidates.jsonl (skips repos already seen).
//
// Only stage 1 (search). Afterwards, run: tsx fetch.ts substrate; tsx fetch.ts
// metadata; tsx fetch.ts content — they resume naturally from candidates.jsonl.

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

interface SearchResult {
  path: string;
  repository: {
    nameWithOwner: string;
    url: string;
    isFork: boolean;
    isPrivate: boolean;
  };
  url: string;
}

interface SearchArgs {
  label: string;
  filename?: string;
  extraQuery?: string;
  language?: string;
  size?: string;
  limit?: number;
}

const HERE = import.meta.dirname ?? __dirname;
const DATA_DIR = join(HERE, 'data');
const CANDIDATES_FILE = join(DATA_DIR, 'candidates.jsonl');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// New queries that target different slices than original fetch.ts.
// Rationale: original had 28 queries; each code-search can return max 1000 raw
// results, but narrow queries hit far fewer. By varying filename/extra/size/
// language we reach fresh slices of the 1000-cap window.
const LANGUAGES = ['TypeScript', 'Python', 'JavaScript', 'Go', 'Rust', 'Ruby', 'Java', 'Shell'];

const QUERIES: SearchArgs[] = [];

// 1. Language-stratified path searches — the 1000-cap window shifts by language.
for (const lang of LANGUAGES) {
  QUERIES.push({ label: `lang_${lang}_skills`, extraQuery: 'path:.claude/skills', language: lang, limit: 100 });
  QUERIES.push({ label: `lang_${lang}_hooks`, extraQuery: 'path:.claude/hooks', language: lang, limit: 100 });
  QUERIES.push({ label: `lang_${lang}_agents`, extraQuery: 'path:.claude/agents', language: lang, limit: 100 });
  QUERIES.push({ label: `lang_${lang}_commands`, extraQuery: 'path:.claude/commands', language: lang, limit: 100 });
}

// 2. Language-stratified .mcp.json
for (const lang of LANGUAGES) {
  QUERIES.push({ label: `lang_${lang}_mcp`, filename: '.mcp.json', language: lang, limit: 100 });
}

// 3. Size-stratified SKILL.md
const SIZE_BUCKETS = ['<1000', '1000..3000', '3000..6000', '6000..12000', '>12000'];
for (const sz of SIZE_BUCKETS) {
  QUERIES.push({ label: `size_skill_${sz}`, filename: 'SKILL.md', extraQuery: 'claude', size: sz, limit: 100 });
}

// 4. Size-stratified CLAUDE.md combined with substrate keyword
for (const sz of SIZE_BUCKETS) {
  QUERIES.push({ label: `size_claude_${sz}`, filename: 'CLAUDE.md', extraQuery: 'path:.claude', size: sz, limit: 100 });
}

// 5. Additional path surfaces
QUERIES.push({ label: 'path_output_styles', extraQuery: 'path:.claude/output-styles', limit: 100 });
QUERIES.push({ label: 'path_plugins', extraQuery: 'path:.claude/plugins', limit: 100 });
QUERIES.push({ label: 'path_statusline', extraQuery: 'path:.claude statusline', limit: 100 });
QUERIES.push({ label: 'agents_md', filename: 'AGENTS.md', extraQuery: 'claude', limit: 100 });
QUERIES.push({ label: 'agents_md_sub', filename: 'AGENTS.md', extraQuery: 'path:.claude', limit: 100 });

// 6. Settings stratified
QUERIES.push({ label: 'settings_user', filename: 'settings.json', extraQuery: 'allowedTools', limit: 100 });
QUERIES.push({ label: 'settings_perm', filename: 'settings.json', extraQuery: 'permissions deny', limit: 100 });
QUERIES.push({ label: 'settings_model', filename: 'settings.json', extraQuery: 'env ANTHROPIC', limit: 100 });
QUERIES.push({ label: 'settings_hooks2', filename: 'settings.json', extraQuery: 'SubagentStop', limit: 100 });
QUERIES.push({ label: 'settings_hooks3', filename: 'settings.json', extraQuery: 'UserPromptSubmit', limit: 100 });

// 7. SKILL.md keyword stratification (different keywords = different hits)
QUERIES.push({ label: 'skill_e', filename: 'SKILL.md', extraQuery: 'when to use', limit: 100 });
QUERIES.push({ label: 'skill_f', filename: 'SKILL.md', extraQuery: 'Progressive', limit: 100 });
QUERIES.push({ label: 'skill_g', filename: 'SKILL.md', extraQuery: 'frontmatter', limit: 100 });
QUERIES.push({ label: 'skill_h', filename: 'SKILL.md', extraQuery: 'scripts/', limit: 100 });

// 8. .mcp.json keyword stratification
QUERIES.push({ label: 'mcp_d', filename: '.mcp.json', extraQuery: 'npx', limit: 100 });
QUERIES.push({ label: 'mcp_e', filename: '.mcp.json', extraQuery: 'uvx', limit: 100 });
QUERIES.push({ label: 'mcp_f', filename: '.mcp.json', extraQuery: 'docker mcp', limit: 100 });
QUERIES.push({ label: 'mcp_g', filename: '.mcp.json', extraQuery: 'env transport', limit: 100 });

// 9. Commands — more angles
QUERIES.push({ label: 'cmd_argument', extraQuery: 'path:.claude/commands $ARGUMENTS', limit: 100 });
QUERIES.push({ label: 'cmd_argument_hint', extraQuery: 'path:.claude/commands argument-hint', limit: 100 });
QUERIES.push({ label: 'cmd_model', extraQuery: 'path:.claude/commands model', limit: 100 });

// 10. Hooks — more angles
QUERIES.push({ label: 'hooks_sh', extraQuery: 'path:.claude/hooks bash', limit: 100 });
QUERIES.push({ label: 'hooks_py', extraQuery: 'path:.claude/hooks python', limit: 100 });
QUERIES.push({ label: 'hooks_node', extraQuery: 'path:.claude/hooks node', limit: 100 });

// 11. Agents — more angles
QUERIES.push({ label: 'agents_tools', extraQuery: 'path:.claude/agents tools', limit: 100 });
QUERIES.push({ label: 'agents_sonnet', extraQuery: 'path:.claude/agents sonnet', limit: 100 });
QUERIES.push({ label: 'agents_opus', extraQuery: 'path:.claude/agents opus', limit: 100 });

async function search(args: SearchArgs): Promise<SearchResult[]> {
  const flags: string[] = ['--limit', String(args.limit ?? 100), '--json', 'repository,path,url'];
  if (args.filename) flags.push('--filename', args.filename);
  if (args.language) flags.push('--language', args.language);
  if (args.size) flags.push('--size', args.size);
  const pos: string[] = [];
  if (args.extraQuery) pos.push(args.extraQuery);
  const cmd = `gh search code ${pos.map((p) => JSON.stringify(p)).join(' ')} ${flags.map((f) => JSON.stringify(f)).join(' ')}`;

  let attempt = 0;
  while (attempt < 6) {
    let stdout = '';
    let stderr = '';
    let threw = false;
    try {
      stdout = execSync(cmd, { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as string;
    } catch (e: unknown) {
      threw = true;
      const ex = e as { stdout?: Buffer | string; stderr?: Buffer | string };
      stdout = (ex.stdout ?? '').toString();
      stderr = (ex.stderr ?? '').toString();
    }
    const combined = stdout + stderr;

    if (/rate limit|HTTP 403/i.test(combined)) {
      const wait = 65_000;
      console.log(`    rate-limited — waiting ${wait / 1000}s (attempt ${attempt + 1})...`);
      await sleep(wait);
      attempt += 1;
      continue;
    }
    if (/422|Unprocessable/i.test(combined)) {
      console.log(`    422 skipping ${args.label}`);
      return [];
    }
    if (threw || !stdout.trim().startsWith('[')) {
      console.log(`    unexpected on ${args.label}: ${(combined || '(empty)').split('\n')[0].slice(0, 160)}`);
      return [];
    }
    try {
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }
  return [];
}

async function main(): Promise<void> {
  const seen = new Set<string>();
  if (existsSync(CANDIDATES_FILE)) {
    for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r: SearchResult = JSON.parse(line);
        seen.add(r.repository.nameWithOwner);
      } catch {/* */}
    }
    console.log(`candidates.jsonl has ${seen.size} entries — will append new only`);
  } else {
    writeFileSync(CANDIDATES_FILE, '');
  }

  const startSize = seen.size;
  for (let i = 0; i < QUERIES.length; i += 1) {
    const q = QUERIES[i];
    console.log(`[${i + 1}/${QUERIES.length}] ${q.label}`);
    const results = await search(q);
    let newCount = 0;
    for (const r of results) {
      if (r.repository.isFork || r.repository.isPrivate) continue;
      const key = r.repository.nameWithOwner;
      if (seen.has(key)) continue;
      seen.add(key);
      appendFileSync(CANDIDATES_FILE, JSON.stringify(r) + '\n');
      newCount += 1;
    }
    console.log(`    got ${results.length} raw, ${newCount} new (total ${seen.size}, +${seen.size - startSize})`);
    if (i < QUERIES.length - 1) await sleep(8_000);
  }
  console.log(`\nExpand done — ${seen.size} unique candidates (+${seen.size - startSize} new).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
