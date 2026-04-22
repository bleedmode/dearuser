#!/usr/bin/env node
// run.mjs — execute run-single.mjs against each fixture (HOME overridden)
// and compare observed scores to expected bands from expected.json.
//
// Usage:
//   node calibration/run.mjs                  # run all fixtures, table + diffs
//   node calibration/run.mjs --json           # emit full JSON
//   node calibration/run.mjs --fixture empty  # one fixture only

import { spawnSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');
const expected = JSON.parse(readFileSync(join(__dirname, 'expected.json'), 'utf-8'));

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const fixtureFilter = (() => {
  const i = args.indexOf('--fixture');
  return i >= 0 ? args[i + 1] : null;
})();

function listFixtures() {
  return readdirSync(fixturesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(n => !fixtureFilter || n === fixtureFilter);
}

function runFixture(name) {
  const home = join(fixturesDir, name);
  if (!existsSync(join(home, '.claude'))) {
    return { error: `no .claude/ under ${home}` };
  }
  const runSingle = join(__dirname, 'dist', 'run-single.js');
  if (!existsSync(runSingle)) {
    return { error: `missing ${runSingle} — run: node calibration/build.mjs` };
  }
  const res = spawnSync('node', [runSingle], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    return { error: res.stderr || res.stdout };
  }
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    return { error: `parse fail: ${e.message}\n${res.stdout.slice(0, 500)}` };
  }
}

function checkBand(value, band) {
  if (band === undefined) return 'n/a';
  if (typeof band === 'boolean') return value === band ? 'ok' : `FAIL (want ${band}, got ${value})`;
  if (typeof band === 'object' && band.min !== undefined) {
    if (value >= band.min && value <= band.max) return 'ok';
    return `FAIL (want ${band.min}-${band.max}, got ${value})`;
  }
  return 'n/a';
}

function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const fixtures = listFixtures();
const results = [];

for (const name of fixtures) {
  const observed = runFixture(name);
  const spec = expected.fixtures[name];
  const report = { fixture: name };

  if (observed.error) {
    report.error = observed.error;
    results.push(report);
    continue;
  }

  report.observed = observed;

  if (spec) {
    const bands = spec.expect || {};
    report.checks = {};
    for (const [path, band] of Object.entries(bands)) {
      if (path.startsWith('_')) continue;
      const value = dig(observed, path);
      report.checks[path] = { value, band, status: checkBand(value, band) };
    }
    if (bands._findings && observed.security && observed.health) {
      const f = bands._findings;
      if (f.secrets) report.checks['_findings.secrets'] = {
        value: observed.security.secrets, band: f.secrets, status: checkBand(observed.security.secrets, f.secrets),
      };
      if (f.injections) report.checks['_findings.injections'] = {
        value: observed.security.injections, band: f.injections, status: checkBand(observed.security.injections, f.injections),
      };
      if (f.conflicts) report.checks['_findings.conflicts'] = {
        value: observed.security.conflicts, band: f.conflicts, status: checkBand(observed.security.conflicts, f.conflicts),
      };
      if (f.overlap) {
        const overlapCount = observed.health.findingsByType?.overlap ?? 0;
        report.checks['_findings.overlap'] = {
          value: overlapCount, band: f.overlap, status: checkBand(overlapCount, f.overlap),
        };
      }
    }
  }
  results.push(report);
}

if (wantJson) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// Human-readable summary
console.log('\n=== Dear User calibration harness ===\n');
let allOk = true;
for (const r of results) {
  console.log(`\n── ${r.fixture} ──`);
  if (r.error) {
    console.log(`  ERROR: ${r.error.slice(0, 400)}`);
    allOk = false;
    continue;
  }
  const o = r.observed;
  console.log(`  scan: hooks=${o.scanSummary.hooksCount} skills=${o.scanSummary.skillsCount} scheduled=${o.scanSummary.scheduledTasksCount} cmds=${o.scanSummary.commandsCount} mcp=${o.scanSummary.mcpServersCount} memory=${o.scanSummary.memoryFilesCount} artifacts=${o.scanSummary.artifactCount}`);
  console.log(`  collab: blended=${o.collab.blended} subScore=${o.collab.claudeMdSubScore} substrateEmpty=${o.collab.substrateEmpty} intentionalAutonomy=${o.collab.intentionalAutonomy}`);
  console.log(`          categories: ${JSON.stringify(o.collab.categories)}`);
  console.log(`  health: score=${o.health.score} findings=${o.health.findingCount} byType=${JSON.stringify(o.health.findingsByType)}`);
  console.log(`  security: score=${o.security.score} secrets=${o.security.secrets} injections=${o.security.injections} conflicts=${o.security.conflicts}`);
  if (r.checks) {
    console.log('  checks:');
    for (const [path, c] of Object.entries(r.checks)) {
      const marker = c.status === 'ok' ? 'ok' : c.status === 'n/a' ? '—' : 'FAIL';
      if (marker === 'FAIL') allOk = false;
      console.log(`    [${marker.padEnd(4)}] ${path}: ${c.value}  (band ${JSON.stringify(c.band)})`);
    }
  }
}

console.log('\n=== Summary ===');
console.log(allOk ? 'All fixtures within expected bands.' : 'One or more fixtures outside expected bands — see FAIL markers above.');
process.exit(allOk ? 0 : 1);
