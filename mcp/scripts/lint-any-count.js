#!/usr/bin/env node
// Regression guard: fail if `any`-count in src/ grows above the ceiling.
// Ceiling trends DOWN over time — update when count shrinks, never when it grows.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CEILING = 129;

// Anchor to the mcp/ package so the script works from any cwd.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(scriptDir, '..');

let out;
try {
  out = execSync(
    "set -o pipefail; grep -rE ': any\\b|<any>|as any\\b' src/ --include='*.ts' | wc -l",
    { encoding: 'utf8', cwd: pkgDir, shell: '/bin/bash' }
  ).trim();
} catch (err) {
  console.error(`lint:any — scan failed: ${err.message}`);
  process.exit(2);
}

const count = parseInt(out, 10);

if (Number.isNaN(count)) {
  console.error('lint:any — could not read count');
  process.exit(2);
}

// Zero would mean the codebase has no `any` — implausible when CEILING is 129.
// Treat it as a scan failure so a silent grep glitch can't report green.
if (count === 0) {
  console.error(`lint:any — scan returned 0, which is implausible (ceiling ${CEILING}). Likely a scan failure.`);
  process.exit(2);
}

if (count > CEILING) {
  console.error(`lint:any — FAIL: ${count} uses of \`any\` (ceiling ${CEILING}).`);
  console.error('Reduce before merging, or lower the ceiling if this is the new baseline.');
  process.exit(1);
}

console.log(`lint:any — ok (${count}/${CEILING})`);
