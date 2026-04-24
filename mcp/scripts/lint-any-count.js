#!/usr/bin/env node
// Regression guard: fail if `any`-count in src/ grows above the ceiling.
// Ceiling trends DOWN over time — update when count shrinks, never when it grows.
import { execSync } from 'node:child_process';

const CEILING = 129;

const out = execSync(
  "grep -rE ': any\\b|<any>|as any\\b' src/ --include='*.ts' | wc -l",
  { encoding: 'utf8' }
).trim();
const count = parseInt(out, 10);

if (Number.isNaN(count)) {
  console.error('lint:any — could not read count');
  process.exit(2);
}

if (count > CEILING) {
  console.error(`lint:any — FAIL: ${count} uses of \`any\` (ceiling ${CEILING}).`);
  console.error('Reduce before merging, or lower the ceiling if this is the new baseline.');
  process.exit(1);
}

console.log(`lint:any — ok (${count}/${CEILING})`);
