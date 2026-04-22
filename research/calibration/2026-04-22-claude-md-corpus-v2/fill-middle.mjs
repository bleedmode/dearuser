// fill-middle.mjs — fetch middle-size buckets we missed due to abuse-detection
// during the initial fetch. Uses --limit 100 (1 API call) with 15s spacing
// to stay well under rate limits.

import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, 'data');
const CAND = join(DATA_DIR, 'candidates.jsonl');

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const buckets = [
  '500..999',
  '1000..1499',
  '1500..1999',
  '2000..2999',
  '3000..3999',
  '4000..4999',
  '5000..6999',
  '7000..9999',
  '10000..14999',
  '15000..24999',
  '50000..99999',
  '100000..300000',
];

const seen = new Set();
if (existsSync(CAND)) {
  for (const line of readFileSync(CAND, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).repository.nameWithOwner); } catch {}
  }
}
console.log(`Start: ${seen.size} candidates on disk`);

for (const b of buckets) {
  let newAdded = 0;
  let attempt = 0;
  let done = false;
  while (!done && attempt < 4) {
    try {
      const out = sh(`gh search code --filename CLAUDE.md --size '${b}' --limit 100 --json repository,path,url`);
      const arr = JSON.parse(out);
      for (const r of arr) {
        const k = r.repository.nameWithOwner;
        if (r.repository.isFork || r.repository.isPrivate) continue;
        if (seen.has(k)) continue;
        seen.add(k);
        appendFileSync(CAND, JSON.stringify(r) + '\n');
        newAdded += 1;
      }
      console.log(`  ${b}: got ${arr.length}, added ${newAdded} new (total ${seen.size})`);
      done = true;
    } catch (e) {
      const stderr = (e.stderr ?? '').toString();
      if (/rate limit|HTTP 403/i.test(stderr)) {
        console.log(`  ${b}: rate-limited, waiting 70s (attempt ${attempt + 1})`);
        await sleep(70_000);
        attempt += 1;
      } else {
        console.log(`  ${b}: error: ${stderr.split('\n')[0].slice(0, 120)}`);
        done = true;
      }
    }
  }
  // Rate-safe spacing: 10/min limit → 1 call per 6s + buffer.
  await sleep(8_000);
}
console.log(`Done: ${seen.size} candidates on disk`);
