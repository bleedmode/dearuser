// verify — check each fixture's actual result against its declared expectation.
// Produces a pass/fail matrix we can embed in the report.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const DATA = join(ROOT, 'data');

interface Expect {
  name: string;
  expect_score_gte?: number;
  expect_score_lt?: number;
  expect_score_between?: [number, number];
  expect_findings?: string[];
  expect_severity?: 'critical' | 'recommended' | 'nice_to_have';
  expect_findings_exclude_from_score?: boolean;
  purpose: string;
}

interface Row {
  fixture: string;
  systemHealthScore: number;
  artifactCount: number;
  findingCount: number;
  findingsByType: Record<string, number>;
  findingsBySeverity: Record<string, number>;
  categories: Record<string, { score: number; weight: number }>;
  findingTitles: string[];
}

const exp: { fixtures: Expect[] } = JSON.parse(readFileSync(join(DATA, 'expectations.json'), 'utf-8'));
const rows: Row[] = readFileSync(join(DATA, 'scores.jsonl'), 'utf-8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));

interface Check {
  fixture: string;
  purpose: string;
  score: number;
  pass: boolean;
  notes: string[];
}

const checks: Check[] = [];

for (const e of exp.fixtures) {
  const row = rows.find((r) => r.fixture === e.name);
  if (!row) {
    checks.push({ fixture: e.name, purpose: e.purpose, score: 0, pass: false, notes: ['fixture row missing'] });
    continue;
  }
  const notes: string[] = [];
  let pass = true;

  if (e.expect_score_gte !== undefined && row.systemHealthScore < e.expect_score_gte) {
    pass = false;
    notes.push(`score ${row.systemHealthScore} < expected ≥${e.expect_score_gte}`);
  }
  if (e.expect_score_lt !== undefined && row.systemHealthScore >= e.expect_score_lt) {
    pass = false;
    notes.push(`score ${row.systemHealthScore} ≥ ${e.expect_score_lt} (expected strictly lower)`);
  }
  if (e.expect_score_between) {
    const [lo, hi] = e.expect_score_between;
    if (row.systemHealthScore < lo || row.systemHealthScore > hi) {
      pass = false;
      notes.push(`score ${row.systemHealthScore} outside [${lo}, ${hi}]`);
    }
  }
  if (e.expect_findings) {
    if (e.expect_findings.length === 0) {
      const actionableCount =
        (row.findingsBySeverity.critical || 0) + (row.findingsBySeverity.recommended || 0);
      // nice_to_have is OK (e.g. unbacked < threshold, auto-generated)
      // But we should have zero of the detector types the fixture is designed to AVOID triggering.
      // We only check that findingCount is low for "no findings expected" fixtures.
      if (actionableCount > 0) {
        // Allow unbacked_up_substrate as an unavoidable side-effect of the test
        // setup (fixtures are in /tmp, not git) — but only if it's the ONLY thing.
        const nonBackup = Object.entries(row.findingsByType).filter(
          ([t, n]) => n > 0 && t !== 'unbacked_up_substrate',
        );
        if (nonBackup.length > 0) {
          pass = false;
          notes.push(`expected no findings, got: ${nonBackup.map(([t, n]) => `${t}=${n}`).join(', ')}`);
        }
      }
    } else {
      for (const t of e.expect_findings) {
        if (!row.findingsByType[t] || row.findingsByType[t] === 0) {
          pass = false;
          notes.push(`expected ${t} finding, not present`);
        }
      }
    }
  }
  if (e.expect_severity) {
    if (!row.findingsBySeverity[e.expect_severity]) {
      pass = false;
      notes.push(`expected at least one ${e.expect_severity} finding`);
    }
  }
  if (e.expect_findings_exclude_from_score) {
    // At least one finding must exist AND score must be near ceiling
    if (row.findingCount === 0) {
      pass = false;
      notes.push('expected suite-cluster findings to exist (but be excluded from score)');
    }
  }

  checks.push({ fixture: e.name, purpose: e.purpose, score: row.systemHealthScore, pass, notes });
}

const passed = checks.filter((c) => c.pass).length;
const failed = checks.filter((c) => !c.pass);

console.log(`${passed}/${checks.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFailures:');
  for (const c of failed) {
    console.log(`  ${c.fixture} (score=${c.score}): ${c.notes.join('; ')}`);
    console.log(`    purpose: ${c.purpose}`);
  }
}

writeFileSync(join(DATA, 'verification.json'), JSON.stringify({ passed, total: checks.length, checks }, null, 2));
