// validate — point the health scorer at each fixture and capture the result.
//
// We bypass runAudit() (which writes to SQLite) and call the pure pipeline
// directly: scanArtifacts → buildGraph → runDetectors → scoreSystemHealth.
// This lets us vary HOME per run without the ledger getting in the way.
//
// We also re-import the scanner module per fixture to defeat any per-module
// caches (there are none in the scanner — it reads HOME fresh every call —
// but better safe).

import { readdirSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const FIXTURES_DIR = join(ROOT, 'fixtures');
const DATA_DIR = join(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const MCP_SRC = join(ROOT, '..', '..', '..', 'mcp', 'src');

// Import engine modules. They use os.homedir() which honours process.env.HOME.
const { scanArtifacts } = await import(join(MCP_SRC, 'engine', 'audit-scanner.ts'));
const { buildGraph } = await import(join(MCP_SRC, 'engine', 'audit-graph.ts'));
const { runDetectors } = await import(join(MCP_SRC, 'engine', 'audit-detectors.ts'));
const { scoreSystemHealth } = await import(join(MCP_SRC, 'engine', 'system-health-scorer.ts'));

interface Finding {
  id: string;
  type: string;
  severity: 'critical' | 'recommended' | 'nice_to_have';
  title: string;
}

interface CategoryScore {
  score: number;
  weight: number;
  signalsPresent: string[];
  signalsMissing: string[];
}

interface ScoreRow {
  fixture: string;
  systemHealthScore: number;
  artifactCount: number;
  findingCount: number;
  findingsByType: Record<string, number>;
  findingsBySeverity: Record<string, number>;
  categories: Record<string, { score: number; weight: number }>;
  findingTitles: string[];
}

function scoreFixture(home: string): ScoreRow {
  // Override HOME so os.homedir() returns our fixture root.
  process.env.HOME = home;
  // USERPROFILE for Windows-compat (harmless on darwin)
  process.env.USERPROFILE = home;

  const artifacts = scanArtifacts();
  const graph = buildGraph(artifacts);
  const findings = runDetectors(graph, { focus: 'all' }) as Finding[];

  // Match the real runAudit: detect suite clusters and exclude them from the
  // scored set. We inline the logic here rather than import, since runAudit
  // hits the DB.
  const overlap = findings.filter((f) => f.type === 'overlap');
  const scorable: Finding[] = [];
  const suitePrefixFindings = new Set<string>();
  if (overlap.length > 0) {
    // Union-find on affected artifacts
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      let r = parent.get(x)!;
      while (r !== parent.get(r)!) r = parent.get(r)!;
      let c = x;
      while (c !== r) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const f of overlap as any[]) {
      const ids = f.affectedArtifacts as string[];
      for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
    }
    // Connect findings that share artifacts
    const artifactToFinding = new Map<string, Finding[]>();
    for (const f of overlap as any[]) {
      for (const id of f.affectedArtifacts as string[]) {
        const list = artifactToFinding.get(id) || [];
        list.push(f);
        artifactToFinding.set(id, list);
      }
    }
    for (const fs of artifactToFinding.values()) {
      if (fs.length < 2) continue;
      const allIds = fs.flatMap((f: any) => f.affectedArtifacts);
      for (let i = 1; i < allIds.length; i++) union(allIds[0], allIds[i]);
    }
    // Cluster by root
    const clusters = new Map<string, { findings: Finding[]; artifactIds: Set<string> }>();
    for (const f of overlap as any[]) {
      const root = find(f.affectedArtifacts[0]);
      let c = clusters.get(root);
      if (!c) {
        c = { findings: [], artifactIds: new Set() };
        clusters.set(root, c);
      }
      c.findings.push(f);
      for (const id of f.affectedArtifacts) c.artifactIds.add(id);
    }
    // Detect suite prefix
    for (const c of clusters.values()) {
      if (c.findings.length < 3) continue;
      const names = Array.from(c.artifactIds).map((id) => {
        const idx = id.indexOf(':');
        return idx >= 0 ? id.slice(idx + 1) : id;
      });
      let prefix: string | null = null;
      for (const sep of ['-', ':', '_']) {
        const prefixes = names
          .map((n) => n.split(sep)[0])
          .filter((p) => p.length >= 3);
        const counts = new Map<string, number>();
        for (const p of prefixes) counts.set(p, (counts.get(p) || 0) + 1);
        for (const [p, ct] of counts) {
          if (ct >= 3 && ct >= names.length * 0.6) {
            prefix = p;
            break;
          }
        }
        if (prefix) break;
      }
      if (prefix) {
        for (const f of c.findings) suitePrefixFindings.add(f.id);
      }
    }
  }
  for (const f of findings) {
    if (!suitePrefixFindings.has(f.id)) scorable.push(f);
  }

  const { categories, systemHealthScore } = scoreSystemHealth(scorable) as {
    categories: Record<string, CategoryScore>;
    systemHealthScore: number;
  };

  const byType: Record<string, number> = {};
  const bySev: Record<string, number> = { critical: 0, recommended: 0, nice_to_have: 0 };
  for (const f of findings) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    bySev[f.severity] = (bySev[f.severity] || 0) + 1;
  }

  return {
    fixture: '',
    systemHealthScore,
    artifactCount: artifacts.length,
    findingCount: findings.length,
    findingsByType: byType,
    findingsBySeverity: bySev,
    categories: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, { score: v.score, weight: v.weight }]),
    ),
    findingTitles: findings.map((f) => `${f.severity}: ${f.type} — ${f.title}`),
  };
}

// ----------------------------------------------------------------------------

const fixtures = readdirSync(FIXTURES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const rows: ScoreRow[] = [];
for (const name of fixtures) {
  const home = join(FIXTURES_DIR, name);
  try {
    const row = scoreFixture(home);
    row.fixture = name;
    rows.push(row);
    console.log(`${name}: score=${row.systemHealthScore}, artifacts=${row.artifactCount}, findings=${row.findingCount}`);
  } catch (e: any) {
    console.error(`${name}: FAILED — ${e?.message || e}`);
  }
}

// Real setup (Jarl's ~/.claude/)
console.log('\n--- Real setup ---');
const realHome = process.env.ORIGINAL_HOME || '/Users/karlomacmini';
try {
  const row = scoreFixture(realHome);
  row.fixture = '__real__';
  rows.push(row);
  console.log(`real: score=${row.systemHealthScore}, artifacts=${row.artifactCount}, findings=${row.findingCount}`);
} catch (e: any) {
  console.error(`real: FAILED — ${e?.message || e}`);
}

// Write JSONL
const jsonlPath = join(DATA_DIR, 'scores.jsonl');
writeFileSync(jsonlPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\nWrote ${rows.length} rows → ${jsonlPath}`);

// Write distribution summary
const synthetic = rows.filter((r) => r.fixture !== '__real__');
const scores = synthetic.map((r) => r.systemHealthScore);
const min = Math.min(...scores);
const max = Math.max(...scores);
const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
const sorted = [...scores].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
const variance = Math.round(
  scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length,
);
const stdev = Math.round(Math.sqrt(variance));

const summary = {
  n: synthetic.length,
  min,
  max,
  range: max - min,
  mean,
  median,
  stdev,
  scores,
  real: rows.find((r) => r.fixture === '__real__')?.systemHealthScore,
};

writeFileSync(join(DATA_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nDistribution: min=${min}, max=${max}, range=${max - min}, mean=${mean}, median=${median}, stdev=${stdev}`);
console.log(`Real setup score: ${summary.real}`);
