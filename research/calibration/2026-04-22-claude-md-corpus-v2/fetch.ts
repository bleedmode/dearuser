// fetch.ts (v2) — pull 1000+ public CLAUDE.md files from GitHub.
//
// Strategy:
// - GitHub's code-search caps any single query at 1000 results. We stratify by
//   `size:` qualifier to get past that cap. Each size bucket is a separate
//   1000-slot.
// - Search rate limit is 10 req/min. Each search request returns up to 100
//   items. We page through with --limit 1000 (gh CLI handles paging internally
//   but counts against rate at ~1 request per 100 results).
// - Core rate limit (5000/hr) is used for content fetches. One fetch per
//   unique repo after dedup.
// - Dedupe by `owner/repo` (one CLAUDE.md per repo — prefer root-level one)
//   and then by content hash (catch forks that don't identify as forks).
// - Checkpoint to disk between stages so rate-limit interruptions don't lose
//   work. Re-running the script resumes.

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

interface ManifestRow {
  idx: number;
  repo: string;
  path: string;
  stars: number;
  description: string | null;
  language: string | null;
  url: string;
  file: string;
  size: number;
  contentHash: string;
  sizeBucket: string;
  starsBucket: string;
}

const HERE = import.meta.dirname ?? __dirname;
const DATA_DIR = join(HERE, 'data');
const RAW_DIR = join(DATA_DIR, 'raw');
const CANDIDATES_FILE = join(DATA_DIR, 'candidates.jsonl');   // raw search results (one per line)
const METADATA_FILE = join(DATA_DIR, 'metadata.jsonl');       // repo metadata
const MANIFEST_FILE = join(DATA_DIR, 'manifest.jsonl');       // final downloaded files
const PROGRESS_FILE = join(DATA_DIR, 'progress.json');

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface SearchArgs {
  sizeRange?: string;      // e.g. "<500", "500..1000", ">50000"
  starsRange?: string;     // e.g. "<10", "10..100"
  language?: string;       // e.g. "TypeScript"
}

async function search(args: SearchArgs, limit: number): Promise<SearchResult[]> {
  // gh search code uses separate flags for size/stars/language, not inline qualifiers.
  const flags: string[] = ['--filename', 'CLAUDE.md', '--limit', String(limit), '--json', 'repository,path,url'];
  if (args.sizeRange) flags.push('--size', args.sizeRange);
  if (args.language) flags.push('--language', args.language);
  // Note: code-search does not support --stars, so we rely on size + broad query.
  const cmd = `gh search code ${flags.map((f) => JSON.stringify(f)).join(' ')}`;

  let attempt = 0;
  while (attempt < 8) {
    let stdout = '';
    let stderr = '';
    let threw = false;
    try {
      // Capture stdout; let stderr bubble to a separate buffer via execSync options.
      stdout = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 100 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }) as unknown as string;
    } catch (e: unknown) {
      threw = true;
      const ex = e as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
      stdout = (ex.stdout ?? '').toString();
      stderr = (ex.stderr ?? '').toString();
    }
    const combined = stdout + stderr;

    if (/rate limit|HTTP 403/i.test(combined)) {
      // Look for reset epoch in message if available, else wait a fixed time.
      const wait = 65_000;
      console.log(`    rate-limited — waiting ${wait / 1000}s (attempt ${attempt + 1})...`);
      await sleep(wait);
      attempt += 1;
      continue;
    }
    if (/422|Unprocessable/i.test(combined)) {
      console.log(`    422 skipping: ${JSON.stringify(args)}`);
      return [];
    }
    if (threw || !stdout.trim().startsWith('[')) {
      console.log(`    unexpected error: ${(combined || '(empty)').split('\n')[0].slice(0, 140)}`);
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

async function fetchRepoMeta(nameWithOwner: string): Promise<RepoMetadata | null> {
  const out = await ghApi(
    `gh api repos/${nameWithOwner} --jq '{stargazerCount: .stargazers_count, description, primaryLanguage: {name: .language}}' 2>/dev/null`,
  );
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

async function fetchRawContent(nameWithOwner: string, path: string): Promise<string | null> {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const out = await ghApi(
    `gh api "repos/${nameWithOwner}/contents/${encoded}" --jq .content 2>/dev/null`,
  );
  if (!out) return null;
  const base64 = out.trim().replace(/\n/g, '');
  if (!base64) return null;
  try {
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Batch-fetch contents via GraphQL. One query returns up to N (owner,
 * path) tuples' contents. Much faster than REST. Returns a map keyed by
 * "owner/name" with the raw file text (or null if not found).
 *
 * Note: GitHub's GraphQL complexity budget caps ~300 nodes per query. We
 * keep batches small (30) to be safe.
 */
async function fetchContentsBatch(
  entries: Array<{ repo: string; path: string }>,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const fields: string[] = [];
  for (let j = 0; j < entries.length; j += 1) {
    const [owner, name] = entries[j].repo.split('/');
    const safeOwner = JSON.stringify(owner ?? '');
    const safeName = JSON.stringify(name ?? '');
    // Use HEAD:path expression — GitHub resolves HEAD to the default branch.
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

function starsBucket(s: number): string {
  if (s === 0) return '0';
  if (s < 10) return '1-9';
  if (s < 100) return '10-99';
  if (s < 1000) return '100-999';
  return '1000+';
}

function sizeBucket(bytes: number): string {
  if (bytes < 1024) return '<1KB';
  if (bytes < 5 * 1024) return '1-5KB';
  if (bytes < 20 * 1024) return '5-20KB';
  return '20KB+';
}

// ---------------------------------------------------------------------------
// Stage 1: Search — collect candidates from multiple stratified queries.
// ---------------------------------------------------------------------------

async function stageSearch(): Promise<void> {
  // If candidates.jsonl already has content, load it and append to it —
  // re-running the stage fills in missing buckets without losing prior results.
  const seenFromDisk = new Set<string>();
  if (existsSync(CANDIDATES_FILE)) {
    for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r: SearchResult = JSON.parse(line);
        seenFromDisk.add(r.repository.nameWithOwner);
      } catch {/* skip */}
    }
    console.log(`candidates.jsonl has ${seenFromDisk.size} entries — resuming`);
  }

  // Stratification strategy: split by size buckets to dodge the 1000-cap.
  // GitHub's code-search --size flag takes ranges like "<500", "500..1000",
  // ">50000" (bytes). Empirically CLAUDE.md sizes skew small, so we need fine
  // granularity in the lower range.
  //
  // Using smaller per-bucket limits keeps us under GitHub's secondary abuse
  // detection (which kicks in after ~10 consecutive --limit=1000 calls).
  const queries: Array<{ label: string; args: SearchArgs; limit: number }> = [
    { label: '<500B',          args: { sizeRange: '<500' },         limit: 1000 },
    { label: '500-999B',       args: { sizeRange: '500..999' },     limit: 1000 },
    { label: '1000-1499B',     args: { sizeRange: '1000..1499' },   limit: 1000 },
    { label: '1500-1999B',     args: { sizeRange: '1500..1999' },   limit: 1000 },
    { label: '2000-2999B',     args: { sizeRange: '2000..2999' },   limit: 1000 },
    { label: '3000-3999B',     args: { sizeRange: '3000..3999' },   limit: 1000 },
    { label: '4000-4999B',     args: { sizeRange: '4000..4999' },   limit: 1000 },
    { label: '5000-6999B',     args: { sizeRange: '5000..6999' },   limit: 1000 },
    { label: '7000-9999B',     args: { sizeRange: '7000..9999' },   limit: 1000 },
    { label: '10000-14999B',   args: { sizeRange: '10000..14999' }, limit: 1000 },
    { label: '15000-24999B',   args: { sizeRange: '15000..24999' }, limit: 1000 },
    { label: '25000-49999B',   args: { sizeRange: '25000..49999' }, limit: 1000 },
    { label: '>49999B',        args: { sizeRange: '>49999' },       limit: 1000 },
  ];

  const seen = new Set<string>(seenFromDisk);
  const all: SearchResult[] = Array.from(seenFromDisk, (s) => ({ repository: { nameWithOwner: s, url: '', isFork: false, isPrivate: false }, path: '', url: '' }));
  if (!existsSync(CANDIDATES_FILE)) writeFileSync(CANDIDATES_FILE, '');

  for (let i = 0; i < queries.length; i += 1) {
    const { label, args, limit } = queries[i];
    console.log(`[${i + 1}/${queries.length}] search: ${label}`);
    const results = await search(args, limit);
    let newCount = 0;
    for (const r of results) {
      if (r.repository.isFork || r.repository.isPrivate) continue;
      const key = r.repository.nameWithOwner;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(r);
      appendFileSync(CANDIDATES_FILE, JSON.stringify(r) + '\n');
      newCount += 1;
    }
    console.log(`    got ${results.length} raw, ${newCount} new unique repos (total ${all.length})`);
    // Code search is 10 req/min; --limit 1000 burns up to 10 API calls (100/page)
    // in one burst. Cooldown must be ~70s per query to be safe.
    if (i < queries.length - 1) await sleep(70_000);
  }
  console.log(`\nStage 1 done — ${all.length} unique candidate repos.`);
}

// ---------------------------------------------------------------------------
// Stage 2: Metadata — fetch stars/language for each candidate via GraphQL
// in batches of 100 repos per query. Dramatically fewer API calls than REST.
// ---------------------------------------------------------------------------

async function stageMetadata(): Promise<void> {
  const already = new Map<string, RepoMetadata | null>();
  if (existsSync(METADATA_FILE)) {
    for (const line of readFileSync(METADATA_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        already.set(o.repo, o.meta ?? null);
      } catch {/* skip */}
    }
    console.log(`metadata.jsonl has ${already.size} entries — resuming`);
  } else {
    writeFileSync(METADATA_FILE, '');
  }

  const candidates: SearchResult[] = [];
  for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      candidates.push(JSON.parse(line));
    } catch {/* skip */}
  }
  const todo = candidates.filter((r) => !already.has(r.repository.nameWithOwner));
  console.log(`Fetching metadata for ${todo.length} candidates (batched GraphQL, 40/query)...`);

  const batchSize = 40;
  let processed = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    const query = buildGraphqlQuery(chunk.map((r) => r.repository.nameWithOwner));
    const out = await ghApi(`gh api graphql -f query='${query.replace(/'/g, "'\\''")}' 2>/dev/null`);
    if (!out) {
      // Fallback: mark each failed
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r.repository.nameWithOwner, meta: null, failed: true }) + '\n');
      }
      processed += chunk.length;
      continue;
    }
    try {
      const parsed = JSON.parse(out);
      for (let j = 0; j < chunk.length; j += 1) {
        const repo = chunk[j].repository.nameWithOwner;
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
    } catch (e) {
      console.log(`    graphql parse error: ${(e as Error).message.slice(0, 120)}`);
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r.repository.nameWithOwner, meta: null, failed: true }) + '\n');
      }
    }
    processed += chunk.length;
    if (processed % 200 === 0 || processed >= todo.length) {
      console.log(`    meta ${processed}/${todo.length}...`);
    }
  }
  console.log(`Stage 2 done.`);
}

/**
 * Build a GraphQL query that fetches stars+description+language for up to N
 * repos in one request. Alias each repo as `r0`, `r1`, ... to keep the
 * response shape predictable regardless of owner/name characters.
 */
function buildGraphqlQuery(nameWithOwners: string[]): string {
  const fields: string[] = [];
  for (let j = 0; j < nameWithOwners.length; j += 1) {
    const [owner, name] = nameWithOwners[j].split('/');
    // GraphQL strings — escape quotes/backslashes.
    const safeOwner = JSON.stringify(owner ?? '');
    const safeName = JSON.stringify(name ?? '');
    fields.push(
      `r${j}: repository(owner: ${safeOwner}, name: ${safeName}) { stargazerCount description primaryLanguage { name } }`,
    );
  }
  return `query { ${fields.join(' ')} }`;
}

// ---------------------------------------------------------------------------
// Stage 3: Content — fetch raw content for each candidate, dedupe by content
// hash, write manifest.jsonl.
// ---------------------------------------------------------------------------

async function stageContent(): Promise<void> {
  const candidates = new Map<string, SearchResult>();
  for (const line of readFileSync(CANDIDATES_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r: SearchResult = JSON.parse(line);
      const existing = candidates.get(r.repository.nameWithOwner);
      if (!existing) {
        candidates.set(r.repository.nameWithOwner, r);
      } else {
        // Prefer root-level CLAUDE.md path
        const scoreOf = (p: string) => (p === 'CLAUDE.md' ? 2 : p.toLowerCase() === 'claude.md' ? 1 : 0);
        if (scoreOf(r.path) > scoreOf(existing.path)) candidates.set(r.repository.nameWithOwner, r);
      }
    } catch {/* skip */}
  }

  const metaByRepo = new Map<string, RepoMetadata>();
  for (const line of readFileSync(METADATA_FILE, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.meta) metaByRepo.set(o.repo, o.meta);
    } catch {/* skip */}
  }

  // Resume if partial
  const alreadyDownloaded = new Set<string>();
  const alreadyHashes = new Set<string>();
  if (existsSync(MANIFEST_FILE)) {
    for (const line of readFileSync(MANIFEST_FILE, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const o: ManifestRow = JSON.parse(line);
        alreadyDownloaded.add(o.repo);
        alreadyHashes.add(o.contentHash);
      } catch {/* skip */}
    }
    console.log(`manifest.jsonl has ${alreadyDownloaded.size} entries — resuming`);
  } else {
    writeFileSync(MANIFEST_FILE, '');
  }

  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });

  let idx = alreadyDownloaded.size;
  let fetched = 0;
  let skipped = 0;
  const todo = Array.from(candidates.values()).filter((r) => !alreadyDownloaded.has(r.repository.nameWithOwner));
  console.log(`Need to fetch ${todo.length} content files (${alreadyDownloaded.size} already done)...`);

  const batchSize = 30;
  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    const entries = chunk
      .filter((r) => metaByRepo.has(r.repository.nameWithOwner))
      .map((r) => ({ repo: r.repository.nameWithOwner, path: r.path }));
    const missingMeta = chunk.length - entries.length;
    skipped += missingMeta;
    if (entries.length === 0) continue;

    const results = await fetchContentsBatch(entries);
    for (const e of entries) {
      const content = results.get(e.repo);
      if (!content) { skipped += 1; continue; }

      const contentHash = createHash('sha256').update(content).digest('hex');
      if (alreadyHashes.has(contentHash)) { skipped += 1; continue; }
      alreadyHashes.add(contentHash);

      const meta = metaByRepo.get(e.repo)!;
      idx += 1;
      const safeName = e.repo.replace(/\//g, '__');
      const file = `${String(idx).padStart(4, '0')}_${safeName}.md`;
      writeFileSync(join(RAW_DIR, file), content, 'utf-8');
      const originalR = chunk.find((r) => r.repository.nameWithOwner === e.repo);
      const row: ManifestRow = {
        idx,
        repo: e.repo,
        path: e.path,
        stars: meta.stargazerCount,
        description: meta.description,
        language: meta.primaryLanguage?.name ?? null,
        url: originalR?.url ?? `https://github.com/${e.repo}`,
        file,
        size: content.length,
        contentHash,
        sizeBucket: sizeBucket(content.length),
        starsBucket: starsBucket(meta.stargazerCount),
      };
      appendFileSync(MANIFEST_FILE, JSON.stringify(row) + '\n');
      fetched += 1;
    }
    if (fetched % 100 < 30 && fetched > 0) {
      console.log(`    fetched ${fetched} / ${todo.length} (total idx ${idx}, skipped ${skipped})`);
    }
  }

  console.log(`Stage 3 done — fetched ${fetched}, skipped ${skipped}, total ${idx}`);
}

async function main(): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const stage = process.argv[2] || 'all';
  if (stage === 'all' || stage === 'search') await stageSearch();
  if (stage === 'all' || stage === 'metadata') await stageMetadata();
  if (stage === 'all' || stage === 'content') await stageContent();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
