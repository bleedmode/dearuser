// score-corpus.ts (v2) — run Dear User's collaboration scorer + lint checks
// against every file in the v2 corpus. Mirrors v1's methodology so results
// are comparable.
//
// Substrate (memory / hooks / skills / MCP servers / scheduled tasks) is
// mocked empty — we want to isolate the CLAUDE.md signal. Categories that
// depend on substrate (memoryHealth, systemMaturity, qualityStandards) are
// systematically penalized; the CLAUDE.md-only subscore re-weights the 4
// signal-pure categories (roleClarity, communication, autonomyBalance,
// coverage) to 1.0.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Engine imports — .js suffix required for ESM under NodeNext.
import { parse } from '../../../mcp/src/engine/parser.js';
import { score } from '../../../mcp/src/engine/scorer.js';
import { lintClaudeMd } from '../../../mcp/src/engine/lint-checks.js';
import type { ScanResult, FileInfo, LintFinding } from '../../../mcp/src/types.js';

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

interface ScoreRow {
  idx: number;
  repo: string;
  stars: number;
  language: string | null;
  size: number;
  sizeBucket: string;
  starsBucket: string;
  collabScore: number;
  categories: {
    roleClarity: number;
    communication: number;
    autonomyBalance: number;
    qualityStandards: number;
    memoryHealth: number;
    systemMaturity: number;
    coverage: number;
  };
  signalSensitiveScore: number;
  rules: { total: number; doRules: number; askRules: number; suggestRules: number; prohibitions: number };
  sections: string[];
  lint: {
    total: number;
    critical: number;
    recommended: number;
    nice: number;
    byCheck: Record<string, number>;
  };
  intentionalAutonomy: boolean;
  isRedirect: boolean;
  isEmpty: boolean;
}

function buildMinimalScan(repo: string, claudeMdContent: string): ScanResult {
  const fileInfo: FileInfo = {
    path: `synthetic://${repo}/CLAUDE.md`,
    content: claudeMdContent,
    size: claudeMdContent.length,
    lastModified: new Date(),
  };
  return {
    scope: 'global',
    scanRoots: [`synthetic://${repo}/`],
    globalClaudeMd: fileInfo,
    projectClaudeMd: null,
    memoryFiles: [],
    settingsFiles: [],
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    installedServers: [],
    competingFormats: { cursorrules: false, agentsMd: false, copilotInstructions: false },
    projectsObserved: 0,
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function histogram(sorted: number[], bins: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (let i = 0; i < bins.length - 1; i += 1) {
    const label = `${bins[i]}-${bins[i + 1] - 1}`;
    h[label] = sorted.filter((v) => v >= bins[i] && v < bins[i + 1]).length;
  }
  return h;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

async function main(): Promise<void> {
  const HERE = import.meta.dirname ?? __dirname;
  const DATA_DIR = join(HERE, 'data');
  const RAW_DIR = join(DATA_DIR, 'raw');
  const MANIFEST = join(DATA_DIR, 'manifest.jsonl');
  const OUT_SCORES = join(DATA_DIR, 'scores.jsonl');
  const OUT_SUMMARY = join(DATA_DIR, 'summary.json');

  if (!existsSync(MANIFEST)) {
    console.error(`manifest.jsonl missing — run fetch.mjs first`);
    process.exit(1);
  }

  const manifest: ManifestRow[] = [];
  for (const line of readFileSync(MANIFEST, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      manifest.push(JSON.parse(line));
    } catch {/* skip */}
  }
  console.log(`Scoring ${manifest.length} files...`);

  // Resume support: if OUT_SCORES already has N rows, append beyond them.
  const done = new Set<string>();
  if (existsSync(OUT_SCORES)) {
    for (const line of readFileSync(OUT_SCORES, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r: ScoreRow = JSON.parse(line);
        done.add(r.repo);
      } catch {/* skip */}
    }
    console.log(`scores.jsonl has ${done.size} rows — resuming`);
  } else {
    writeFileSync(OUT_SCORES, '');
  }

  const rows: ScoreRow[] = [];
  for (const entry of manifest) {
    if (done.has(entry.repo)) continue;
    let content: string;
    try {
      content = readFileSync(join(RAW_DIR, entry.file), 'utf-8');
    } catch {
      continue;
    }

    const scan = buildMinimalScan(entry.repo, content);
    const parsed = parse(scan);
    const scoringResult = score(parsed, scan);
    const lintResult = lintClaudeMd(scan, parsed);

    const byCheck: Record<string, number> = {};
    for (const f of lintResult.findings as LintFinding[]) {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
    }

    const pureCategories = ['roleClarity', 'communication', 'autonomyBalance', 'coverage'] as const;
    const pureWeights = { roleClarity: 0.15, communication: 0.10, autonomyBalance: 0.20, coverage: 0.10 };
    const pureWeightSum = pureCategories.reduce((s, k) => s + pureWeights[k], 0);
    const signalSensitiveScore = Math.round(
      pureCategories.reduce(
        (s, k) => s + (scoringResult.categories[k].score * pureWeights[k]) / pureWeightSum,
        0,
      ),
    );

    // Detect redirect / empty
    const trimmed = content.trim();
    const isEmpty = trimmed.length < 20;
    const agentsMdRedirect = /AGENTS\.md/i.test(trimmed) && trimmed.length < 500;

    const row: ScoreRow = {
      idx: entry.idx,
      repo: entry.repo,
      stars: entry.stars,
      language: entry.language,
      size: entry.size,
      sizeBucket: entry.sizeBucket,
      starsBucket: entry.starsBucket,
      collabScore: scoringResult.collaborationScore,
      categories: {
        roleClarity: scoringResult.categories.roleClarity.score,
        communication: scoringResult.categories.communication.score,
        autonomyBalance: scoringResult.categories.autonomyBalance.score,
        qualityStandards: scoringResult.categories.qualityStandards.score,
        memoryHealth: scoringResult.categories.memoryHealth.score,
        systemMaturity: scoringResult.categories.systemMaturity.score,
        coverage: scoringResult.categories.coverage.score,
      },
      signalSensitiveScore,
      rules: {
        total: parsed.rules.length,
        doRules: parsed.rules.filter((r) => r.type === 'do_autonomously').length,
        askRules: parsed.rules.filter((r) => r.type === 'ask_first').length,
        suggestRules: parsed.rules.filter((r) => r.type === 'suggest_only').length,
        prohibitions: parsed.rules.filter((r) => r.type === 'prohibition').length,
      },
      sections: parsed.sections.map((s) => s.id).filter((s) => s !== 'other'),
      lint: {
        total: lintResult.summary.totalFindings,
        critical: lintResult.summary.bySeverity.critical,
        recommended: lintResult.summary.bySeverity.recommended,
        nice: lintResult.summary.bySeverity.nice_to_have,
        byCheck,
      },
      intentionalAutonomy: scoringResult.intentionalAutonomy,
      isRedirect: agentsMdRedirect,
      isEmpty,
    };

    rows.push(row);
    appendFileSync(OUT_SCORES, JSON.stringify(row) + '\n');
    if (rows.length % 100 === 0) {
      console.log(`  scored ${rows.length} files...`);
    }
  }

  // Re-read all scores for summary (including resumed rows)
  const allRows: ScoreRow[] = [];
  for (const line of readFileSync(OUT_SCORES, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      allRows.push(JSON.parse(line));
    } catch {/* skip */}
  }
  console.log(`Total rows in scores.jsonl: ${allRows.length}`);

  // ---------- Summary ----------
  const collab = allRows.map((r) => r.collabScore).sort((a, b) => a - b);
  const pure = allRows.map((r) => r.signalSensitiveScore).sort((a, b) => a - b);
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];

  function distStats(sorted: number[]) {
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10,
      stdev: Math.round(stdev(sorted) * 10) / 10,
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      histogram: histogram(sorted, bins),
    };
  }

  // Breakdowns by stars/size/language
  function breakdown(
    keyFn: (r: ScoreRow) => string,
    metric: (r: ScoreRow) => number,
  ): Record<string, { n: number; min: number; max: number; mean: number; median: number }> {
    const groups = new Map<string, number[]>();
    for (const r of allRows) {
      const k = keyFn(r);
      const arr = groups.get(k) ?? [];
      arr.push(metric(r));
      groups.set(k, arr);
    }
    const out: Record<string, { n: number; min: number; max: number; mean: number; median: number }> = {};
    for (const [k, arr] of groups) {
      arr.sort((a, b) => a - b);
      out[k] = {
        n: arr.length,
        min: arr[0],
        max: arr[arr.length - 1],
        mean: Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10,
        median: percentile(arr, 0.5),
      };
    }
    return out;
  }

  const summary = {
    corpusSize: allRows.length,
    collab: distStats(collab),
    pure: distStats(pure),
    categoriesMean: {
      roleClarity: Math.round(allRows.reduce((s, r) => s + r.categories.roleClarity, 0) / allRows.length),
      communication: Math.round(allRows.reduce((s, r) => s + r.categories.communication, 0) / allRows.length),
      autonomyBalance: Math.round(allRows.reduce((s, r) => s + r.categories.autonomyBalance, 0) / allRows.length),
      qualityStandards: Math.round(allRows.reduce((s, r) => s + r.categories.qualityStandards, 0) / allRows.length),
      memoryHealth: Math.round(allRows.reduce((s, r) => s + r.categories.memoryHealth, 0) / allRows.length),
      systemMaturity: Math.round(allRows.reduce((s, r) => s + r.categories.systemMaturity, 0) / allRows.length),
      coverage: Math.round(allRows.reduce((s, r) => s + r.categories.coverage, 0) / allRows.length),
    },
    lintTotals: (() => {
      const allChecks: Record<string, number> = {};
      for (const r of allRows) {
        for (const [k, v] of Object.entries(r.lint.byCheck)) {
          allChecks[k] = (allChecks[k] || 0) + v;
        }
      }
      return allChecks;
    })(),
    lintBySeverity: {
      critical: allRows.reduce((s, r) => s + r.lint.critical, 0),
      recommended: allRows.reduce((s, r) => s + r.lint.recommended, 0),
      nice: allRows.reduce((s, r) => s + r.lint.nice, 0),
    },
    lintMean: Math.round(allRows.reduce((s, r) => s + r.lint.total, 0) / allRows.length),
    intentionalAutonomyCount: allRows.filter((r) => r.intentionalAutonomy).length,
    redirects: allRows.filter((r) => r.isRedirect).length,
    empty: allRows.filter((r) => r.isEmpty).length,
    byStars: {
      collab: breakdown((r) => r.starsBucket, (r) => r.collabScore),
      pure: breakdown((r) => r.starsBucket, (r) => r.signalSensitiveScore),
    },
    bySize: {
      collab: breakdown((r) => r.sizeBucket, (r) => r.collabScore),
      pure: breakdown((r) => r.sizeBucket, (r) => r.signalSensitiveScore),
    },
    byLanguage: (() => {
      // Only top N languages so summary stays readable
      const counts = new Map<string, number>();
      for (const r of allRows) {
        const k = r.language ?? 'unknown';
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([lang]) => lang);
      const topSet = new Set(top);
      return breakdown(
        (r) => (topSet.has(r.language ?? 'unknown') ? (r.language ?? 'unknown') : 'other'),
        (r) => r.collabScore,
      );
    })(),
    lowest5: [...allRows].sort((a, b) => a.collabScore - b.collabScore).slice(0, 5).map((r) => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
    highest5: [...allRows].sort((a, b) => b.collabScore - a.collabScore).slice(0, 5).map((r) => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
    highestPure5: [...allRows].sort((a, b) => b.signalSensitiveScore - a.signalSensitiveScore).slice(0, 5).map((r) => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
  };

  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(`\nSummary: data/summary.json`);
  console.log(`Collab: mean=${summary.collab.mean} median=${summary.collab.median} p90=${summary.collab.p90} p99=${summary.collab.p99}`);
  console.log(`Pure:   mean=${summary.pure.mean} median=${summary.pure.median} p90=${summary.pure.p90} p99=${summary.pure.p99}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
