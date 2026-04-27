// fetch.ts — substrate corpus (2026-04-24)
//
// Goal: find public GitHub repos that commit BOTH a CLAUDE.md AND Claude Code
// substrate (.claude/skills/, .claude/hooks/, .claude/commands/,
// .claude/scheduled-tasks/, or .mcp.json). These are power-user setups.
//
// Strategy:
// 1. Stratified `gh search code` across substrate-revealing filename queries.
// 2. Dedupe to unique repos.
// 3. For each repo, pull the full default-branch tree via GraphQL (recursive
//    Tree or REST /git/trees/HEAD?recursive=1). Count substrate artifacts.
// 4. Require CLAUDE.md at repo root (or fall back to first CLAUDE.md in tree).
// 5. Fetch CLAUDE.md content, dedupe by content hash.
// 6. Write manifest.jsonl with substrate counts alongside.
//
// Methodological note: this corpus is intentionally biased toward repos that
// publish substrate. That is the entire point — we want a "with substrate"
// distribution. Sampling bias is discussed in report.md.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

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

interface RepoMetadata {
  stargazerCount: number;
  description: string | null;
  primaryLanguage: { name: string } | null;
}

interface SubstrateCounts {
  hooks: number;
  skills: number;
  commands: number;
  scheduledTasks: number;
  mcpServers: number;
  memoryFiles: number;
  hasClaudeMd: boolean;
  claudeMdPath: string | null;
}

interface ManifestRow {
  idx: number;
  repo: string;
  stars: number;
  description: string | null;
  language: string | null;
  url: string;
  file: string;
  claudeMdPath: string;
  claudeMdSize: number;
  contentHash: string;
  substrate: SubstrateCounts;
  substrateTotal: number;
}

const HERE = import.meta.dirname ?? __dirname;
const DATA_DIR = join(HERE, 'data');
const RAW_DIR = join(DATA_DIR, 'raw');
const CANDIDATES_FILE = join(DATA_DIR, 'candidates.jsonl');
const SUBSTRATE_FILE = join(DATA_DIR, 'substrate.jsonl');
const METADATA_FILE = join(DATA_DIR, 'metadata.jsonl');
const MANIFEST_FILE = join(DATA_DIR, 'manifest.jsonl');

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Stage 1: Search — stratified substrate-revealing queries.
// ---------------------------------------------------------------------------

interface SearchArgs {
  filename?: string;
  path?: string;
  extraQuery?: string;
  label: string;
  limit?: number;
}

// These queries each target a filename pattern that reveals substrate.
// gh search code's `--filename` matches only the basename. `path:` qualifier
// is NOT supported. We use --limit 100 per query and stratify by size ranges
// to get past the 100-per-page cap; --limit 1000 triggers hard rate-limiting.
// We accept some noise — Stage 2 re-verifies via tree scan.
const QUERIES: SearchArgs[] = [
  // SKILL.md files — narrow with free-text "claude" to skew toward .claude/skills/
  { label: 'skill_md_a',        filename: 'SKILL.md',    extraQuery: 'claude', limit: 100 },
  { label: 'skill_md_b',        filename: 'SKILL.md',    extraQuery: 'claude agent', limit: 100 },
  { label: 'skill_md_c',        filename: 'SKILL.md',    extraQuery: 'allowed_tools', limit: 100 },
  { label: 'skill_md_d',        filename: 'SKILL.md',    extraQuery: 'description trigger', limit: 100 },
  // .mcp.json — Claude Code's MCP config standard. Multiple narrowings.
  { label: 'mcp_json_a',        filename: '.mcp.json',   limit: 100 },
  { label: 'mcp_json_b',        filename: '.mcp.json',   extraQuery: 'mcpServers', limit: 100 },
  { label: 'mcp_json_c',        filename: '.mcp.json',   extraQuery: 'stdio claude', limit: 100 },
  // settings.json that mentions hook events (strong Claude Code signal)
  { label: 'settings_pre',      filename: 'settings.json', extraQuery: 'PreToolUse', limit: 100 },
  { label: 'settings_post',     filename: 'settings.json', extraQuery: 'PostToolUse', limit: 100 },
  { label: 'settings_stop',     filename: 'settings.json', extraQuery: 'Stop claude', limit: 100 },
  // commands directory — commands are *.md files; narrow via "allowed-tools"
  // or "description:" front-matter typical of slash-command definitions.
  { label: 'command_md',        filename: 'commands',     extraQuery: 'allowed-tools claude', limit: 100 },
  // path: qualifier works as a free-text term in gh search code.
  { label: 'path_hooks',        extraQuery: 'path:.claude/hooks', limit: 100 },
  { label: 'path_commands',     extraQuery: 'path:.claude/commands', limit: 100 },
  { label: 'path_scheduled',    extraQuery: 'path:.claude/scheduled-tasks', limit: 100 },
  { label: 'path_skills',       extraQuery: 'path:.claude/skills', limit: 100 },
  { label: 'path_memory',       extraQuery: 'path:.claude/memory', limit: 100 },
  { label: 'path_agents',       extraQuery: 'path:.claude/agents', limit: 100 },
  // path: queries that need a keyword to pass GH's validation.
  { label: 'path_hooks_kw',     extraQuery: 'path:.claude/hooks hook', limit: 100 },
  { label: 'path_hooks_cmd',    extraQuery: 'path:.claude/hooks command', limit: 100 },
  { label: 'path_agents_kw',    extraQuery: 'path:.claude/agents claude', limit: 100 },
  { label: 'path_agents_desc',  extraQuery: 'path:.claude/agents description', limit: 100 },
  { label: 'path_skills_kw',    extraQuery: 'path:.claude/skills description', limit: 100 },
  { label: 'path_skills_tools', extraQuery: 'path:.claude/skills allowed', limit: 100 },
  { label: 'path_commands_kw',  extraQuery: 'path:.claude/commands description', limit: 100 },
  { label: 'path_memory_kw',    extraQuery: 'path:.claude/memory feedback', limit: 100 },
  { label: 'mcp_servers',       filename: '.mcp.json',   extraQuery: 'command', limit: 100 },
  { label: 'mcp_args',          filename: '.mcp.json',   extraQuery: 'args', limit: 100 },
  { label: 'settings_hooks_kw', filename: 'settings.json', extraQuery: 'hooks matcher', limit: 100 },
];

async function search(args: SearchArgs): Promise<SearchResult[]> {
  const flags: string[] = ['--limit', String(args.limit ?? 100), '--json', 'repository,path,url'];
  if (args.filename) flags.push('--filename', args.filename);
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

async function stageSearch(): Promise<void> {
  const seen = new Set<string>();
  if (existsSync(CANDIDATES_FILE)) {
    for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r: SearchResult = JSON.parse(line);
        seen.add(r.repository.nameWithOwner);
      } catch {/* */}
    }
    console.log(`candidates.jsonl has ${seen.size} entries — resuming`);
  } else {
    writeFileSync(CANDIDATES_FILE, '');
  }

  for (let i = 0; i < QUERIES.length; i += 1) {
    const q = QUERIES[i];
    console.log(`[${i + 1}/${QUERIES.length}] search: ${q.label}`);
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
    console.log(`    got ${results.length} raw, ${newCount} new (total ${seen.size})`);
    // Code search rate limit = 10 req/min = 6s per request. --limit 100 = 1
    // request. 8s cushion is safe.
    if (i < QUERIES.length - 1) await sleep(8_000);
  }
  console.log(`\nStage 1 done — ${seen.size} unique candidate repos.`);
}

// ---------------------------------------------------------------------------
// Stage 2: Tree walk — for each candidate, pull the repo tree recursively and
// count substrate artifacts. Also determine CLAUDE.md path.
// ---------------------------------------------------------------------------

async function ghApi(cmd: string): Promise<string | null> {
  let attempt = 0;
  while (attempt < 4) {
    try {
      return sh(cmd);
    } catch (e: unknown) {
      const msg = (e as Error).message || String(e);
      if (msg.includes('rate limit') || msg.includes('403')) {
        const wait = 30_000 * (attempt + 1);
        console.log(`    rate-limited on api — waiting ${wait / 1000}s...`);
        await sleep(wait);
        attempt += 1;
      } else if (msg.includes('404')) {
        return null;
      } else {
        return null;
      }
    }
  }
  return null;
}

async function fetchRepoTree(nameWithOwner: string): Promise<string[] | null> {
  // Use git/trees/HEAD?recursive=1. Returns up to 100k entries.
  const out = await ghApi(
    `gh api "repos/${nameWithOwner}/git/trees/HEAD?recursive=1" --jq '.tree[] | select(.type=="blob") | .path' 2>/dev/null`,
  );
  if (!out) return null;
  return out.trim().split('\n').filter(Boolean);
}

function countSubstrate(paths: string[]): SubstrateCounts {
  // Note: These are GLOB-like path-based counts. They are conservative
  // approximations of what mcp/src/engine/scanner does on local disk.
  const counts: SubstrateCounts = {
    hooks: 0,
    skills: 0,
    commands: 0,
    scheduledTasks: 0,
    mcpServers: 0,
    memoryFiles: 0,
    hasClaudeMd: false,
    claudeMdPath: null,
  };

  // Track skills by unique parent dir (one skill = one .claude/skills/<name>/SKILL.md).
  const skillDirs = new Set<string>();
  const scheduledDirs = new Set<string>();

  for (const p of paths) {
    // CLAUDE.md — prefer root path.
    if (/^CLAUDE\.md$/i.test(p) && !counts.claudeMdPath) {
      counts.hasClaudeMd = true;
      counts.claudeMdPath = p;
    } else if (/\/CLAUDE\.md$/i.test(p) && !counts.claudeMdPath) {
      // Fallback non-root CLAUDE.md (will be overridden by a root match above)
      counts.hasClaudeMd = true;
      counts.claudeMdPath = p;
    }

    // Hooks — .claude/hooks/* shell scripts or JS/TS hook files.
    // Count files directly inside .claude/hooks/ (or nested)
    if (/(^|\/)\.claude\/hooks\/.+/.test(p) && !/\.md$/i.test(p)) {
      counts.hooks += 1;
    }

    // Skills — .claude/skills/<slug>/SKILL.md counts once per slug.
    const skillMatch = p.match(/(^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/i);
    if (skillMatch) {
      skillDirs.add(skillMatch[2]);
    }

    // Commands — .claude/commands/*.md
    if (/(^|\/)\.claude\/commands\/.+\.md$/i.test(p)) {
      counts.commands += 1;
    }

    // Scheduled tasks — .claude/scheduled-tasks/<slug>/SKILL.md or similar.
    const schedMatch = p.match(/(^|\/)\.claude\/scheduled-tasks\/([^/]+)\//i);
    if (schedMatch) {
      scheduledDirs.add(schedMatch[2]);
    }

    // Memory files — .claude/memory/*.md or memory/*.md under .claude
    if (/(^|\/)\.claude\/memory\/.+\.md$/i.test(p)) {
      counts.memoryFiles += 1;
    }

    // .mcp.json at any depth — counted later via content fetch.
    // (Presence flagged below; per-server count requires fetching the file.)
  }

  counts.skills = skillDirs.size;
  counts.scheduledTasks = scheduledDirs.size;
  return counts;
}

async function fetchMcpJson(nameWithOwner: string, mcpPaths: string[]): Promise<number> {
  // Sum number of MCP servers across all .mcp.json files in the repo.
  let total = 0;
  for (const p of mcpPaths) {
    const encoded = p.split('/').map(encodeURIComponent).join('/');
    const out = await ghApi(
      `gh api "repos/${nameWithOwner}/contents/${encoded}" --jq .content 2>/dev/null`,
    );
    if (!out) continue;
    try {
      const raw = Buffer.from(out.trim().replace(/\n/g, ''), 'base64').toString('utf-8');
      const json = JSON.parse(raw);
      const servers = json?.mcpServers ?? json?.servers ?? json;
      if (servers && typeof servers === 'object') {
        total += Object.keys(servers).length;
      }
    } catch {/* */}
  }
  return total;
}

async function stageSubstrate(): Promise<void> {
  const already = new Set<string>();
  if (existsSync(SUBSTRATE_FILE)) {
    for (const line of readFileSync(SUBSTRATE_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        already.add(o.repo);
      } catch {/* */}
    }
    console.log(`substrate.jsonl has ${already.size} entries — resuming`);
  } else {
    writeFileSync(SUBSTRATE_FILE, '');
  }

  const candidates: SearchResult[] = [];
  const candidateRepos = new Set<string>();
  for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r: SearchResult = JSON.parse(line);
      if (!candidateRepos.has(r.repository.nameWithOwner)) {
        candidates.push(r);
        candidateRepos.add(r.repository.nameWithOwner);
      }
    } catch {/* */}
  }
  const todo = candidates.filter((r) => !already.has(r.repository.nameWithOwner));
  console.log(`Walking trees for ${todo.length} repos (of ${candidates.length} unique)...`);

  let processed = 0;
  for (const r of todo) {
    const repo = r.repository.nameWithOwner;
    const paths = await fetchRepoTree(repo);
    if (!paths) {
      appendFileSync(SUBSTRATE_FILE, JSON.stringify({ repo, failed: true }) + '\n');
      processed += 1;
      continue;
    }
    const counts = countSubstrate(paths);

    // Count MCP servers by pulling .mcp.json content.
    const mcpPaths = paths.filter((p) => /(^|\/)\.mcp\.json$/i.test(p));
    if (mcpPaths.length > 0) {
      counts.mcpServers = await fetchMcpJson(repo, mcpPaths);
    }

    appendFileSync(
      SUBSTRATE_FILE,
      JSON.stringify({ repo, substrate: counts, treeSize: paths.length }) + '\n',
    );
    processed += 1;
    if (processed % 25 === 0) {
      console.log(`    trees ${processed}/${todo.length}...`);
    }
    // Light throttle — core REST budget is 5000/hr, each tree is ~1-2 calls.
    await sleep(250);
  }
  console.log(`Stage 2 done — walked ${processed} trees.`);
}

// ---------------------------------------------------------------------------
// Stage 3: Metadata — stars/description/language via batched GraphQL.
// ---------------------------------------------------------------------------

function buildGraphqlMetaQuery(nameWithOwners: string[]): string {
  const fields: string[] = [];
  for (let j = 0; j < nameWithOwners.length; j += 1) {
    const [owner, name] = nameWithOwners[j].split('/');
    const safeOwner = JSON.stringify(owner ?? '');
    const safeName = JSON.stringify(name ?? '');
    fields.push(
      `r${j}: repository(owner: ${safeOwner}, name: ${safeName}) { stargazerCount description primaryLanguage { name } }`,
    );
  }
  return `query { ${fields.join(' ')} }`;
}

async function stageMetadata(): Promise<void> {
  const already = new Map<string, RepoMetadata | null>();
  if (existsSync(METADATA_FILE)) {
    for (const line of readFileSync(METADATA_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        already.set(o.repo, o.meta ?? null);
      } catch {/* */}
    }
    console.log(`metadata.jsonl has ${already.size} entries — resuming`);
  } else {
    writeFileSync(METADATA_FILE, '');
  }

  // Only pull metadata for repos that passed substrate filter.
  const passingRepos: string[] = [];
  for (const line of readFileSync(SUBSTRATE_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.substrate && o.substrate.hasClaudeMd) {
        const s = o.substrate as SubstrateCounts;
        const total = s.hooks + s.skills + s.commands + s.scheduledTasks + s.mcpServers + s.memoryFiles;
        if (total > 0) passingRepos.push(o.repo);
      }
    } catch {/* */}
  }
  const todo = passingRepos.filter((r) => !already.has(r));
  console.log(`Fetching metadata for ${todo.length} repos (of ${passingRepos.length} passing)...`);

  const batchSize = 40;
  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    const query = buildGraphqlMetaQuery(chunk);
    const out = await ghApi(`gh api graphql -f query='${query.replace(/'/g, "'\\''")}' 2>/dev/null`);
    if (!out) {
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r, meta: null, failed: true }) + '\n');
      }
      continue;
    }
    try {
      const parsed = JSON.parse(out);
      for (let j = 0; j < chunk.length; j += 1) {
        const repo = chunk[j];
        const node = parsed.data?.[`r${j}`];
        if (!node) {
          appendFileSync(METADATA_FILE, JSON.stringify({ repo, meta: null, failed: true }) + '\n');
          continue;
        }
        const meta: RepoMetadata = {
          stargazerCount: node.stargazerCount ?? 0,
          description: node.description ?? null,
          primaryLanguage: node.primaryLanguage ? { name: node.primaryLanguage.name } : null,
        };
        appendFileSync(METADATA_FILE, JSON.stringify({ repo, meta }) + '\n');
      }
    } catch {
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r, meta: null, failed: true }) + '\n');
      }
    }
    if ((i + batchSize) % 200 === 0) console.log(`    meta ${Math.min(i + batchSize, todo.length)}/${todo.length}...`);
  }
  console.log(`Stage 3 done.`);
}

// ---------------------------------------------------------------------------
// Stage 4: Content — fetch CLAUDE.md for each passing repo, dedupe by hash.
// ---------------------------------------------------------------------------

async function fetchContentsBatch(
  entries: Array<{ repo: string; path: string }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const fields: string[] = [];
  for (let j = 0; j < entries.length; j += 1) {
    const [owner, name] = entries[j].repo.split('/');
    const safeOwner = JSON.stringify(owner ?? '');
    const safeName = JSON.stringify(name ?? '');
    const expr = JSON.stringify(`HEAD:${entries[j].path}`);
    fields.push(
      `r${j}: repository(owner: ${safeOwner}, name: ${safeName}) { object(expression: ${expr}) { ... on Blob { text } } }`,
    );
  }
  const query = `query { ${fields.join(' ')} }`;
  const res = await ghApi(`gh api graphql -f query='${query.replace(/'/g, "'\\''")}' 2>/dev/null`);
  if (!res) {
    for (const e of entries) out.set(e.repo, null);
    return out;
  }
  try {
    const parsed = JSON.parse(res);
    for (let j = 0; j < entries.length; j += 1) {
      const node = parsed.data?.[`r${j}`]?.object;
      out.set(entries[j].repo, node?.text ?? null);
    }
  } catch {
    for (const e of entries) out.set(e.repo, null);
  }
  return out;
}

async function stageContent(): Promise<void> {
  const substrateByRepo = new Map<string, SubstrateCounts>();
  for (const line of readFileSync(SUBSTRATE_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.substrate) substrateByRepo.set(o.repo, o.substrate);
    } catch {/* */}
  }

  const metaByRepo = new Map<string, RepoMetadata>();
  for (const line of readFileSync(METADATA_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.meta) metaByRepo.set(o.repo, o.meta);
    } catch {/* */}
  }

  const alreadyDownloaded = new Set<string>();
  const alreadyHashes = new Set<string>();
  if (existsSync(MANIFEST_FILE)) {
    for (const line of readFileSync(MANIFEST_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o: ManifestRow = JSON.parse(line);
        alreadyDownloaded.add(o.repo);
        alreadyHashes.add(o.contentHash);
      } catch {/* */}
    }
    console.log(`manifest.jsonl has ${alreadyDownloaded.size} entries — resuming`);
  } else {
    writeFileSync(MANIFEST_FILE, '');
  }

  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

  const candidateUrlByRepo = new Map<string, string>();
  for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r: SearchResult = JSON.parse(line);
      if (!candidateUrlByRepo.has(r.repository.nameWithOwner)) {
        candidateUrlByRepo.set(r.repository.nameWithOwner, r.repository.url);
      }
    } catch {/* */}
  }

  const todo: Array<{ repo: string; substrate: SubstrateCounts }> = [];
  for (const [repo, substrate] of substrateByRepo) {
    if (!substrate.hasClaudeMd || !substrate.claudeMdPath) continue;
    const total = substrate.hooks + substrate.skills + substrate.commands + substrate.scheduledTasks + substrate.mcpServers + substrate.memoryFiles;
    if (total === 0) continue;
    if (alreadyDownloaded.has(repo)) continue;
    if (!metaByRepo.has(repo)) continue;
    todo.push({ repo, substrate });
  }
  console.log(`Need to fetch CLAUDE.md for ${todo.length} repos...`);

  let idx = alreadyDownloaded.size;
  let fetched = 0;
  let skipped = 0;
  const batchSize = 30;
  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    const entries = chunk.map((c) => ({ repo: c.repo, path: c.substrate.claudeMdPath! }));
    const results = await fetchContentsBatch(entries);
    for (const c of chunk) {
      const content = results.get(c.repo);
      if (!content) { skipped += 1; continue; }
      const contentHash = createHash('sha256').update(content).digest('hex');
      if (alreadyHashes.has(contentHash)) { skipped += 1; continue; }
      alreadyHashes.add(contentHash);
      const meta = metaByRepo.get(c.repo)!;
      idx += 1;
      const safeName = c.repo.replace(/\//g, '__');
      const file = `${String(idx).padStart(4, '0')}_${safeName}.md`;
      writeFileSync(join(RAW_DIR, file), content, 'utf-8');
      const total = c.substrate.hooks + c.substrate.skills + c.substrate.commands + c.substrate.scheduledTasks + c.substrate.mcpServers + c.substrate.memoryFiles;
      const row: ManifestRow = {
        idx,
        repo: c.repo,
        stars: meta.stargazerCount,
        description: meta.description,
        language: meta.primaryLanguage?.name ?? null,
        url: candidateUrlByRepo.get(c.repo) ?? `https://github.com/${c.repo}`,
        file,
        claudeMdPath: c.substrate.claudeMdPath!,
        claudeMdSize: content.length,
        contentHash,
        substrate: c.substrate,
        substrateTotal: total,
      };
      appendFileSync(MANIFEST_FILE, JSON.stringify(row) + '\n');
      fetched += 1;
    }
    if ((i + batchSize) % 90 === 0) {
      console.log(`    fetched ${fetched}/${todo.length} (skipped ${skipped})`);
    }
  }
  console.log(`Stage 4 done — fetched ${fetched}, skipped ${skipped}, total ${idx}`);
}

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const stage = process.argv[2] || 'all';
  if (stage === 'all' || stage === 'search') await stageSearch();
  if (stage === 'all' || stage === 'substrate') await stageSubstrate();
  if (stage === 'all' || stage === 'metadata') await stageMetadata();
  if (stage === 'all' || stage === 'content') await stageContent();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
