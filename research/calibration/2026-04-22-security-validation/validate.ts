// validate.ts — run Dear User's secret scanner against planted-fixture corpus.
//
// Usage:
//   cd research/calibration/2026-04-22-security-validation
//   node --experimental-strip-types validate.ts
//
// Or (from repo root), compile+run in one shot via esbuild + node:
//   node scripts/run-validator.mjs
//
// The validator reads every file under ./fixtures/secrets/ and expects the
// scanner to flag at least one SecretFinding whose category matches the
// fixture's filename prefix category (parsed from a `Category:` line inside
// the fixture body — see fixtures/secrets/*.md).
//
// Then it reads ./fixtures/negatives/ and expects ZERO findings per file.
//
// Emits results.json and prints a pass/fail table.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSecrets, type SecretFinding } from '../../../mcp/src/engine/secret-scanner.js';
import type { AuditArtifact, FileInfo } from '../../../mcp/src/types.js';

// Prefer FIXTURE_ROOT env var (set by run.mjs) so that bundled builds in
// .build/ still resolve fixtures from the repo-level research dir.
const BASE = process.env.FIXTURE_ROOT || dirname(fileURLToPath(import.meta.url));
const SECRETS_DIR = join(BASE, 'fixtures', 'secrets');
const NEGATIVES_DIR = join(BASE, 'fixtures', 'negatives');

interface FixtureExpectation {
  file: string;
  path: string;
  expectedCategory: string;       // from `Category:` header; 'NONE' for fixtures we don't detect
  expectedSeverity: 'critical' | 'recommended' | 'NONE';
}

function parseExpectation(path: string, content: string): FixtureExpectation {
  const catMatch = content.match(/^Category:\s*(\S+)/m);
  const sevMatch = content.match(/^Expected:\s*(\S+)/m);
  return {
    file: path.split('/').pop()!,
    path,
    expectedCategory: catMatch ? catMatch[1] : 'UNKNOWN',
    expectedSeverity: (sevMatch ? sevMatch[1] : 'critical') as FixtureExpectation['expectedSeverity'],
  };
}

function loadDir(dir: string): Array<{ path: string; content: string }> {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({
      path: join(dir, f),
      content: readFileSync(join(dir, f), 'utf8'),
    }));
}

function runFixture(content: string, path: string): SecretFinding[] {
  const file: FileInfo = { path, content, size: content.length };
  // Route each fixture through the claudeMdFiles slot (scanner treats
  // artifacts/claudeMd/settings identically — same scanText call).
  return scanSecrets([], [file], []);
}

interface Row {
  kind: 'positive' | 'negative';
  file: string;
  expected: string;
  detected: string[];
  pass: boolean;
  reason?: string;
}

const rows: Row[] = [];

// Positive fixtures: must detect at least one finding of the declared category.
for (const f of loadDir(SECRETS_DIR)) {
  const exp = parseExpectation(f.path, f.content);
  const findings = runFixture(f.content, f.path);
  const detectedCats = findings.map((x) => x.category);
  let pass: boolean;
  let reason: string | undefined;

  if (exp.expectedSeverity === 'NONE') {
    // Disabled-by-default category (e.g. vercel_token). Expect NO findings of that category.
    pass = !detectedCats.includes(exp.expectedCategory as any);
    if (!pass) reason = `expected no ${exp.expectedCategory} finding (disabled), got one`;
  } else {
    pass = detectedCats.includes(exp.expectedCategory as any);
    if (!pass) reason = `expected category=${exp.expectedCategory}, got=[${detectedCats.join(',') || 'none'}]`;
  }

  rows.push({
    kind: 'positive',
    file: exp.file,
    expected: exp.expectedCategory,
    detected: detectedCats,
    pass,
    reason,
  });
}

// Negative fixtures: must produce zero findings (regardless of category).
for (const f of loadDir(NEGATIVES_DIR)) {
  const findings = runFixture(f.content, f.path);
  const detectedCats = findings.map((x) => x.category);
  const pass = findings.length === 0;
  rows.push({
    kind: 'negative',
    file: f.path.split('/').pop()!,
    expected: '(no findings)',
    detected: detectedCats,
    pass,
    reason: pass ? undefined : `expected 0, got ${findings.length}: ${detectedCats.join(',')}`,
  });
}

// Summary
const pos = rows.filter((r) => r.kind === 'positive');
const neg = rows.filter((r) => r.kind === 'negative');
const posPass = pos.filter((r) => r.pass).length;
const negPass = neg.filter((r) => r.pass).length;

console.log('\n=== Secret-scanner validation ===\n');
console.log('POSITIVE fixtures (planted secrets — must detect):');
for (const r of pos) {
  const mark = r.pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.file.padEnd(40)} expected=${r.expected}${r.reason ? ' — ' + r.reason : ''}`);
}
console.log('\nNEGATIVE fixtures (no secrets — must not flag):');
for (const r of neg) {
  const mark = r.pass ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${r.file.padEnd(40)}${r.reason ? ' — ' + r.reason : ''}`);
}

console.log('\n--- summary ---');
console.log(`  positives: ${posPass}/${pos.length}`);
console.log(`  negatives: ${negPass}/${neg.length}`);
console.log(`  total:     ${posPass + negPass}/${rows.length}`);

// Category coverage: which of our 12 declared categories have at least one
// fixture that triggered correctly?
const DECLARED_CATEGORIES = [
  'openai_key', 'anthropic_key', 'github_token', 'stripe_key', 'aws_key',
  'slack_token', 'google_api_key', 'supabase_key', 'vercel_token',
  'private_key', 'env_secret', 'bearer_token',
];
// Coverage = category actually fired a finding. Fixtures with expectedSeverity
// 'NONE' (disabled patterns like vercel_token) intentionally don't fire, so
// they do NOT count as covered.
const hitCategories = new Set(
  pos
    .filter((r) => r.pass && r.detected.includes(r.expected as any))
    .map((r) => r.expected),
);
const covered = DECLARED_CATEGORIES.filter((c) => hitCategories.has(c));
const disabled = DECLARED_CATEGORIES.filter((c) => !hitCategories.has(c));

console.log('\n--- category coverage ---');
console.log(`  fired correctly (${covered.length}/${DECLARED_CATEGORIES.length}): ${covered.join(', ')}`);
console.log(`  not fired (${disabled.length}): ${disabled.join(', ')}`);

writeFileSync(
  join(BASE, 'results.json'),
  JSON.stringify({
    runAt: new Date().toISOString(),
    rows,
    summary: {
      positivesPassed: posPass,
      positivesTotal: pos.length,
      negativesPassed: negPass,
      negativesTotal: neg.length,
      categoriesCovered: covered,
      categoriesNotFired: disabled,
    },
  }, null, 2),
);

if (posPass !== pos.length || negPass !== neg.length) {
  console.log('\nFAIL — see rows above');
  process.exit(1);
}
console.log('\nOK — all fixtures behave as expected');
