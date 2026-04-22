// fetch.ts — pull public CLAUDE.md files from GitHub via `gh search code`.
//
// Strategy:
// - Search `filename:CLAUDE.md` (gh search code), pull 150 candidates to allow
//   for filtering.
// - Dedupe by nameWithOwner (one CLAUDE.md per repo).
// - Fetch raw content via `gh api repos/<owner>/<repo>/contents/<path>?ref=<sha>`.
// - Prefer repos >= 10 stars when available, but don't reject sub-10-star ones
//   outright — the stars signal is noisy for CLAUDE.md which is often in tool
//   repos or fresh personal projects.
// - Write each file to `data/raw/<idx>_<owner>__<repo>.md` plus a manifest.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

interface RepoMetadata {
  stargazerCount: number;
  description: string | null;
  primaryLanguage?: { name: string } | null;
}

interface Manifest {
  fetchedAt: string;
  total: number;
  entries: Array<{
    idx: number;
    repo: string;
    path: string;
    stars: number;
    description: string | null;
    language: string | null;
    url: string;
    file: string;
    size: number;
  }>;
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
}

function search(limit: number): SearchResult[] {
  const out = sh(`gh search code "filename:CLAUDE.md" --limit ${limit} --json repository,path,url`);
  return JSON.parse(out);
}

function fetchRepoMeta(nameWithOwner: string): RepoMetadata | null {
  try {
    const out = sh(`gh api repos/${nameWithOwner} --jq '{stargazerCount: .stargazers_count, description, primaryLanguage: {name: .language}}'`);
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function fetchRawContent(nameWithOwner: string, path: string): string | null {
  try {
    // URL-encode path (spaces, slashes in subdirs, etc.)
    const encoded = encodeURIComponent(path);
    // gh api returns base64 content in .content field for files
    const out = sh(`gh api "repos/${nameWithOwner}/contents/${encoded}" --jq .content`);
    const base64 = out.trim().replace(/\n/g, '');
    if (!base64) return null;
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch (e) {
    return null;
  }
}

async function main() {
  const TARGET = 50;
  const FETCH_LIMIT = 150;
  const OUT_DIR = join(import.meta.dirname ?? __dirname, 'data', 'raw');
  const MANIFEST = join(import.meta.dirname ?? __dirname, 'data', 'manifest.json');
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Searching GitHub for CLAUDE.md (up to ${FETCH_LIMIT})...`);
  const results = search(FETCH_LIMIT);
  console.log(`Got ${results.length} raw results.`);

  // Dedupe by repo — first path wins (usually root CLAUDE.md).
  const byRepo = new Map<string, SearchResult>();
  for (const r of results) {
    // Prefer path that is exactly 'CLAUDE.md' over subdirs
    const existing = byRepo.get(r.repository.nameWithOwner);
    if (!existing) {
      byRepo.set(r.repository.nameWithOwner, r);
    } else {
      const existingScore = existing.path === 'CLAUDE.md' ? 2 : existing.path.toLowerCase() === 'claude.md' ? 1 : 0;
      const newScore = r.path === 'CLAUDE.md' ? 2 : r.path.toLowerCase() === 'claude.md' ? 1 : 0;
      if (newScore > existingScore) byRepo.set(r.repository.nameWithOwner, r);
    }
  }

  // Filter out obvious junk: forks, private (shouldn't appear anyway).
  const candidates = Array.from(byRepo.values())
    .filter(r => !r.repository.isFork && !r.repository.isPrivate);

  console.log(`${candidates.length} unique non-fork repos.`);

  // Fetch stars for each, then sort: stars DESC to prefer active repos, but
  // keep a mix — we don't want only mega-repos.
  const withMeta: Array<{ r: SearchResult; meta: RepoMetadata }> = [];
  for (const r of candidates) {
    const meta = fetchRepoMeta(r.repository.nameWithOwner);
    if (!meta) continue;
    withMeta.push({ r, meta });
  }
  console.log(`Metadata for ${withMeta.length} repos.`);

  // Sort by stars descending so we hit well-known repos first, but then we'll
  // also include mid + low tier to get distribution.
  withMeta.sort((a, b) => b.meta.stargazerCount - a.meta.stargazerCount);

  // Bucketed sampling: 15 high (>=100 stars), 15 medium (10-99), 20 low (<10).
  const high = withMeta.filter(x => x.meta.stargazerCount >= 100);
  const medium = withMeta.filter(x => x.meta.stargazerCount >= 10 && x.meta.stargazerCount < 100);
  const low = withMeta.filter(x => x.meta.stargazerCount < 10);

  console.log(`Available: ${high.length} high | ${medium.length} medium | ${low.length} low stars`);

  const picked = [
    ...high.slice(0, 15),
    ...medium.slice(0, 15),
    ...low.slice(0, 20),
  ];

  // Top up to 50 if some buckets are short
  for (const src of [high, medium, low]) {
    if (picked.length >= TARGET) break;
    for (const x of src) {
      if (picked.length >= TARGET) break;
      if (!picked.includes(x)) picked.push(x);
    }
  }

  const target = picked.slice(0, TARGET);
  console.log(`Selected ${target.length} for download.`);

  const manifest: Manifest = { fetchedAt: new Date().toISOString(), total: 0, entries: [] };

  let idx = 0;
  for (const { r, meta } of target) {
    idx += 1;
    const content = fetchRawContent(r.repository.nameWithOwner, r.path);
    if (!content) {
      console.log(`  [${idx}] SKIP ${r.repository.nameWithOwner} (fetch failed)`);
      continue;
    }
    const safeName = r.repository.nameWithOwner.replace(/\//g, '__');
    const file = `${String(idx).padStart(3, '0')}_${safeName}.md`;
    writeFileSync(join(OUT_DIR, file), content, 'utf-8');
    manifest.entries.push({
      idx,
      repo: r.repository.nameWithOwner,
      path: r.path,
      stars: meta.stargazerCount,
      description: meta.description,
      language: meta.primaryLanguage?.name ?? null,
      url: r.url,
      file,
      size: content.length,
    });
    console.log(`  [${idx}] ${r.repository.nameWithOwner} (${meta.stargazerCount}*, ${content.length}b)`);
  }
  manifest.total = manifest.entries.length;
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\nDone. ${manifest.total} files saved; manifest at data/manifest.json`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
