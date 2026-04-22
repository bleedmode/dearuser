import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const HERE = import.meta.dirname ?? __dirname;
const DATA_DIR = join(HERE, "data");
const RAW_DIR = join(DATA_DIR, "raw");
const CANDIDATES_FILE = join(DATA_DIR, "candidates.jsonl");
const METADATA_FILE = join(DATA_DIR, "metadata.jsonl");
const MANIFEST_FILE = join(DATA_DIR, "manifest.jsonl");
const PROGRESS_FILE = join(DATA_DIR, "progress.json");
function sh(cmd) {
  return execSync(cmd, { encoding: "utf-8", maxBuffer: 100 * 1024 * 1024 });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function search(args, limit) {
  const flags = ["--filename", "CLAUDE.md", "--limit", String(limit), "--json", "repository,path,url"];
  if (args.sizeRange) flags.push("--size", args.sizeRange);
  if (args.language) flags.push("--language", args.language);
  const cmd = `gh search code ${flags.map((f) => JSON.stringify(f)).join(" ")}`;
  let attempt = 0;
  while (attempt < 8) {
    let stdout = "";
    let stderr = "";
    let threw = false;
    try {
      stdout = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (e) {
      threw = true;
      const ex = e;
      stdout = (ex.stdout ?? "").toString();
      stderr = (ex.stderr ?? "").toString();
    }
    const combined = stdout + stderr;
    if (/rate limit|HTTP 403/i.test(combined)) {
      const wait = 65e3;
      console.log(`    rate-limited \u2014 waiting ${wait / 1e3}s (attempt ${attempt + 1})...`);
      await sleep(wait);
      attempt += 1;
      continue;
    }
    if (/422|Unprocessable/i.test(combined)) {
      console.log(`    422 skipping: ${JSON.stringify(args)}`);
      return [];
    }
    if (threw || !stdout.trim().startsWith("[")) {
      console.log(`    unexpected error: ${(combined || "(empty)").split("\n")[0].slice(0, 140)}`);
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
async function ghApi(cmd) {
  let attempt = 0;
  while (attempt < 4) {
    try {
      return sh(cmd);
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes("rate limit") || msg.includes("403")) {
        const wait = 3e4 * (attempt + 1);
        console.log(`    rate-limited on api \u2014 waiting ${wait / 1e3}s...`);
        await sleep(wait);
        attempt += 1;
      } else if (msg.includes("404")) {
        return null;
      } else {
        return null;
      }
    }
  }
  return null;
}
async function fetchRepoMeta(nameWithOwner) {
  const out = await ghApi(
    `gh api repos/${nameWithOwner} --jq '{stargazerCount: .stargazers_count, description, primaryLanguage: {name: .language}}' 2>/dev/null`
  );
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}
async function fetchRawContent(nameWithOwner, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const out = await ghApi(
    `gh api "repos/${nameWithOwner}/contents/${encoded}" --jq .content 2>/dev/null`
  );
  if (!out) return null;
  const base64 = out.trim().replace(/\n/g, "");
  if (!base64) return null;
  try {
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}
async function fetchContentsBatch(entries) {
  const out = /* @__PURE__ */ new Map();
  const fields = [];
  for (let j = 0; j < entries.length; j += 1) {
    const [owner, name] = entries[j].repo.split("/");
    const safeOwner = JSON.stringify(owner ?? "");
    const safeName = JSON.stringify(name ?? "");
    const expr = JSON.stringify(`HEAD:${entries[j].path}`);
    fields.push(
      `r${j}: repository(owner: ${safeOwner}, name: ${safeName}) { object(expression: ${expr}) { ... on Blob { text } } }`
    );
  }
  const query = `query { ${fields.join(" ")} }`;
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
function starsBucket(s) {
  if (s === 0) return "0";
  if (s < 10) return "1-9";
  if (s < 100) return "10-99";
  if (s < 1e3) return "100-999";
  return "1000+";
}
function sizeBucket(bytes) {
  if (bytes < 1024) return "<1KB";
  if (bytes < 5 * 1024) return "1-5KB";
  if (bytes < 20 * 1024) return "5-20KB";
  return "20KB+";
}
async function stageSearch() {
  const seenFromDisk = /* @__PURE__ */ new Set();
  if (existsSync(CANDIDATES_FILE)) {
    for (const line of readFileSync(CANDIDATES_FILE, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        seenFromDisk.add(r.repository.nameWithOwner);
      } catch {
      }
    }
    console.log(`candidates.jsonl has ${seenFromDisk.size} entries \u2014 resuming`);
  }
  const queries = [
    { label: "<500B", args: { sizeRange: "<500" }, limit: 1e3 },
    { label: "500-999B", args: { sizeRange: "500..999" }, limit: 1e3 },
    { label: "1000-1499B", args: { sizeRange: "1000..1499" }, limit: 1e3 },
    { label: "1500-1999B", args: { sizeRange: "1500..1999" }, limit: 1e3 },
    { label: "2000-2999B", args: { sizeRange: "2000..2999" }, limit: 1e3 },
    { label: "3000-3999B", args: { sizeRange: "3000..3999" }, limit: 1e3 },
    { label: "4000-4999B", args: { sizeRange: "4000..4999" }, limit: 1e3 },
    { label: "5000-6999B", args: { sizeRange: "5000..6999" }, limit: 1e3 },
    { label: "7000-9999B", args: { sizeRange: "7000..9999" }, limit: 1e3 },
    { label: "10000-14999B", args: { sizeRange: "10000..14999" }, limit: 1e3 },
    { label: "15000-24999B", args: { sizeRange: "15000..24999" }, limit: 1e3 },
    { label: "25000-49999B", args: { sizeRange: "25000..49999" }, limit: 1e3 },
    { label: ">49999B", args: { sizeRange: ">49999" }, limit: 1e3 }
  ];
  const seen = new Set(seenFromDisk);
  const all = Array.from(seenFromDisk, (s) => ({ repository: { nameWithOwner: s, url: "", isFork: false, isPrivate: false }, path: "", url: "" }));
  if (!existsSync(CANDIDATES_FILE)) writeFileSync(CANDIDATES_FILE, "");
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
      appendFileSync(CANDIDATES_FILE, JSON.stringify(r) + "\n");
      newCount += 1;
    }
    console.log(`    got ${results.length} raw, ${newCount} new unique repos (total ${all.length})`);
    if (i < queries.length - 1) await sleep(7e4);
  }
  console.log(`
Stage 1 done \u2014 ${all.length} unique candidate repos.`);
}
async function stageMetadata() {
  const already = /* @__PURE__ */ new Map();
  if (existsSync(METADATA_FILE)) {
    for (const line of readFileSync(METADATA_FILE, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        already.set(o.repo, o.meta ?? null);
      } catch {
      }
    }
    console.log(`metadata.jsonl has ${already.size} entries \u2014 resuming`);
  } else {
    writeFileSync(METADATA_FILE, "");
  }
  const candidates = [];
  for (const line of readFileSync(CANDIDATES_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      candidates.push(JSON.parse(line));
    } catch {
    }
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
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r.repository.nameWithOwner, meta: null, failed: true }) + "\n");
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
          appendFileSync(METADATA_FILE, JSON.stringify({ repo, meta: null, failed: true }) + "\n");
          continue;
        }
        const meta = {
          stargazerCount: node.stargazerCount ?? 0,
          description: node.description ?? null,
          primaryLanguage: node.primaryLanguage ? { name: node.primaryLanguage.name } : null
        };
        appendFileSync(METADATA_FILE, JSON.stringify({ repo, meta }) + "\n");
      }
    } catch (e) {
      console.log(`    graphql parse error: ${e.message.slice(0, 120)}`);
      for (const r of chunk) {
        appendFileSync(METADATA_FILE, JSON.stringify({ repo: r.repository.nameWithOwner, meta: null, failed: true }) + "\n");
      }
    }
    processed += chunk.length;
    if (processed % 200 === 0 || processed >= todo.length) {
      console.log(`    meta ${processed}/${todo.length}...`);
    }
  }
  console.log(`Stage 2 done.`);
}
function buildGraphqlQuery(nameWithOwners) {
  const fields = [];
  for (let j = 0; j < nameWithOwners.length; j += 1) {
    const [owner, name] = nameWithOwners[j].split("/");
    const safeOwner = JSON.stringify(owner ?? "");
    const safeName = JSON.stringify(name ?? "");
    fields.push(
      `r${j}: repository(owner: ${safeOwner}, name: ${safeName}) { stargazerCount description primaryLanguage { name } }`
    );
  }
  return `query { ${fields.join(" ")} }`;
}
async function stageContent() {
  const candidates = /* @__PURE__ */ new Map();
  for (const line of readFileSync(CANDIDATES_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const existing = candidates.get(r.repository.nameWithOwner);
      if (!existing) {
        candidates.set(r.repository.nameWithOwner, r);
      } else {
        const scoreOf = (p) => p === "CLAUDE.md" ? 2 : p.toLowerCase() === "claude.md" ? 1 : 0;
        if (scoreOf(r.path) > scoreOf(existing.path)) candidates.set(r.repository.nameWithOwner, r);
      }
    } catch {
    }
  }
  const metaByRepo = /* @__PURE__ */ new Map();
  for (const line of readFileSync(METADATA_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.meta) metaByRepo.set(o.repo, o.meta);
    } catch {
    }
  }
  const alreadyDownloaded = /* @__PURE__ */ new Set();
  const alreadyHashes = /* @__PURE__ */ new Set();
  if (existsSync(MANIFEST_FILE)) {
    for (const line of readFileSync(MANIFEST_FILE, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        alreadyDownloaded.add(o.repo);
        alreadyHashes.add(o.contentHash);
      } catch {
      }
    }
    console.log(`manifest.jsonl has ${alreadyDownloaded.size} entries \u2014 resuming`);
  } else {
    writeFileSync(MANIFEST_FILE, "");
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
    const entries = chunk.filter((r) => metaByRepo.has(r.repository.nameWithOwner)).map((r) => ({ repo: r.repository.nameWithOwner, path: r.path }));
    const missingMeta = chunk.length - entries.length;
    skipped += missingMeta;
    if (entries.length === 0) continue;
    const results = await fetchContentsBatch(entries);
    for (const e of entries) {
      const content = results.get(e.repo);
      if (!content) {
        skipped += 1;
        continue;
      }
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (alreadyHashes.has(contentHash)) {
        skipped += 1;
        continue;
      }
      alreadyHashes.add(contentHash);
      const meta = metaByRepo.get(e.repo);
      idx += 1;
      const safeName = e.repo.replace(/\//g, "__");
      const file = `${String(idx).padStart(4, "0")}_${safeName}.md`;
      writeFileSync(join(RAW_DIR, file), content, "utf-8");
      const originalR = chunk.find((r) => r.repository.nameWithOwner === e.repo);
      const row = {
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
        starsBucket: starsBucket(meta.stargazerCount)
      };
      appendFileSync(MANIFEST_FILE, JSON.stringify(row) + "\n");
      fetched += 1;
    }
    if (fetched % 100 < 30 && fetched > 0) {
      console.log(`    fetched ${fetched} / ${todo.length} (total idx ${idx}, skipped ${skipped})`);
    }
  }
  console.log(`Stage 3 done \u2014 fetched ${fetched}, skipped ${skipped}, total ${idx}`);
}
async function main() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const stage = process.argv[2] || "all";
  if (stage === "all" || stage === "search") await stageSearch();
  if (stage === "all" || stage === "metadata") await stageMetadata();
  if (stage === "all" || stage === "content") await stageContent();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
