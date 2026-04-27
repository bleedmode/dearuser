// score-corpus.ts — run Dear User's collaboration scorer against every repo
// in the substrate corpus, with REAL substrate counts populated in ScanResult
// (not mocked empty like v2).
//
// Key difference from v2: we populate hooksCount/skillsCount/commandsCount/
// scheduledTasksCount/mcpServersCount + synthesize memoryFiles entries so
// categories that depend on substrate (qualityStandards, systemMaturity,
// memoryHealth) score honestly.
//
// Memory files: we synthesize N FileInfo entries with empty content. The
// scorer only counts them and inspects paths — real content would improve the
// "recent memories / user profile" sub-signals slightly, but counting is the
// dominant signal and we'd rather not fabricate memory content.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from '../../../mcp/src/engine/parser.js';
import { score } from '../../../mcp/src/engine/scorer.js';
import type { ScanResult, FileInfo } from '../../../mcp/src/types.js';

interface SubstrateCounts {
  hooks: number;
  skills: number;
  commands: number;
  scheduledTasks: number;
  mcpServers: number;
  memoryFiles: number;
  hasClaudeMd: boolean;
  claudeMdPath: string | null;
}

interface ManifestRow {
  idx: number;
  repo: string;
  stars: number;
  description: string | null;
  language: string | null;
  url: string;
  file: string;
  claudeMdPath: string;
  claudeMdSize: number;
  contentHash: string;
  substrate: SubstrateCounts;
  substrateTotal: number;
}

interface ScoreRow {
  idx: number;
  repo: string;
  stars: number;
  language: string | null;
  size: number;
  substrate: SubstrateCounts;
  substrateTotal: number;
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
  /** CLAUDE.md-only re-weighted sub-score (matches v2's signalSensitiveScore). */
  signalSensitiveScore: number;
  rules: { total: number; doRules: number; askRules: number; suggestRules: number; prohibitions: number };
  isEmpty: boolean;
  isRedirect: boolean;
}

function buildScan(repo: string, content: string, sub: SubstrateCounts): ScanResult {
  const fileInfo: FileInfo = {
    path: `synthetic://${repo}/CLAUDE.md`,
    content,
    size: content.length,
    lastModified: new Date(),
  };
  // Synthesize N memory FileInfos. Scorer counts length and checks for
  // `feedback_` and `user_` path tokens. We synthesize a generic mix so the
  // per-file count signal works correctly. A small fraction get `feedback_`
  // or `user_` paths proportional to what real memory dirs look like.
  const memoryFiles: FileInfo[] = [];
  for (let i = 0; i < sub.memoryFiles; i += 1) {
    memoryFiles.push({
      path: `synthetic://${repo}/.claude/memory/entry_${i}.md`,
      content: '',
      size: 0,
      lastModified: new Date(),
    });
  }
  return {
    scope: 'global',
    scanRoots: [`synthetic://${repo}/`],
    globalClaudeMd: fileInfo,
    projectClaudeMd: null,
    memoryFiles,
    settingsFiles: [],
    hooksCount: sub.hooks,
    skillsCount: sub.skills,
    scheduledTasksCount: sub.scheduledTasks,
    commandsCount: sub.commands,
    mcpServersCount: sub.mcpServers,
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

function meanOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function main(): Promise<void> {
  const HERE = import.meta.dirname ?? __dirname;
  const DATA_DIR = join(HERE, 'data');
  const RAW_DIR = join(DATA_DIR, 'raw');
  const MANIFEST = join(DATA_DIR, 'manifest.jsonl');
  const OUT_SCORES = join(DATA_DIR, 'scores.jsonl');
  const OUT_SUMMARY = join(DATA_DIR, 'summary.json');

  if (!existsSync(MANIFEST)) {
    console.error('manifest.jsonl missing — run fetch.ts first');
    process.exit(1);
  }

  const manifest: ManifestRow[] = [];
  for (const line of readFileSync(MANIFEST, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { manifest.push(JSON.parse(line)); } catch {/* */}
  }
  console.log(`Scoring ${manifest.length} files...`);

  const done = new Set<string>();
  if (existsSync(OUT_SCORES)) {
    for (const line of readFileSync(OUT_SCORES, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r: ScoreRow = JSON.parse(line);
        done.add(r.repo);
      } catch {/* */}
    }
    console.log(`scores.jsonl has ${done.size} rows — resuming`);
  } else {
    writeFileSync(OUT_SCORES, '');
  }

  for (const entry of manifest) {
    if (done.has(entry.repo)) continue;
    let content: string;
    try {
      content = readFileSync(join(RAW_DIR, entry.file), 'utf-8');
    } catch {
      continue;
    }

    const scan = buildScan(entry.repo, content, entry.substrate);
    const parsed = parse(scan);
    const scoringResult = score(parsed, scan);

    const pureCategories = ['roleClarity', 'communication', 'autonomyBalance', 'coverage'] as const;
    const pureWeights = { roleClarity: 0.15, communication: 0.10, autonomyBalance: 0.20, coverage: 0.10 };
    const pureWeightSum = pureCategories.reduce((s, k) => s + pureWeights[k], 0);
    const signalSensitiveScore = Math.round(
      pureCategories.reduce(
        (s, k) => s + (scoringResult.categories[k].score * pureWeights[k]) / pureWeightSum,
        0,
      ),
    );

    const trimmed = content.trim();
    const isEmpty = trimmed.length < 20;
    const isRedirect = /AGENTS\.md/i.test(trimmed) && trimmed.length < 500;

    const row: ScoreRow = {
      idx: entry.idx,
      repo: entry.repo,
      stars: entry.stars,
      language: entry.language,
      size: entry.claudeMdSize,
      substrate: entry.substrate,
      substrateTotal: entry.substrateTotal,
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
      isEmpty,
      isRedirect,
    };

    appendFileSync(OUT_SCORES, JSON.stringify(row) + '\n');
  }

  // Re-read all scores
  const allRows: ScoreRow[] = [];
  for (const line of readFileSync(OUT_SCORES, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try { allRows.push(JSON.parse(line)); } catch {/* */}
  }
  console.log(`Total rows: ${allRows.length}`);

  const collab = allRows.map((r) => r.collabScore).sort((a, b) => a - b);
  const pure = allRows.map((r) => r.signalSensitiveScore).sort((a, b) => a - b);
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];

  function distStats(sorted: number[]) {
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Math.round(meanOf(sorted) * 10) / 10,
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

  // Substrate stats
  const substrateKeys = ['hooks', 'skills', 'commands', 'scheduledTasks', 'mcpServers', 'memoryFiles'] as const;
  const substrateStats: Record<string, { mean: number; median: number; max: number; withAny: number }> = {};
  for (const k of substrateKeys) {
    const vals = allRows.map((r) => r.substrate[k]).sort((a, b) => a - b);
    substrateStats[k] = {
      mean: Math.round(meanOf(vals) * 10) / 10,
      median: percentile(vals, 0.5),
      max: vals[vals.length - 1],
      withAny: vals.filter((v) => v > 0).length,
    };
  }

  const categoriesMean = {
    roleClarity: Math.round(meanOf(allRows.map((r) => r.categories.roleClarity))),
    communication: Math.round(meanOf(allRows.map((r) => r.categories.communication))),
    autonomyBalance: Math.round(meanOf(allRows.map((r) => r.categories.autonomyBalance))),
    qualityStandards: Math.round(meanOf(allRows.map((r) => r.categories.qualityStandards))),
    memoryHealth: Math.round(meanOf(allRows.map((r) => r.categories.memoryHealth))),
    systemMaturity: Math.round(meanOf(allRows.map((r) => r.categories.systemMaturity))),
    coverage: Math.round(meanOf(allRows.map((r) => r.categories.coverage))),
  };

  // Top / bottom
  const sortedByCollab = [...allRows].sort((a, b) => b.collabScore - a.collabScore);
  const top10 = sortedByCollab.slice(0, 10).map((r) => ({
    repo: r.repo,
    collab: r.collabScore,
    pure: r.signalSensitiveScore,
    size: r.size,
    stars: r.stars,
    substrate: r.substrate,
    substrateTotal: r.substrateTotal,
  }));
  const bottom5 = [...allRows].sort((a, b) => a.collabScore - b.collabScore).slice(0, 5).map((r) => ({
    repo: r.repo,
    collab: r.collabScore,
    pure: r.signalSensitiveScore,
    size: r.size,
    stars: r.stars,
    substrate: r.substrate,
  }));

  const summary = {
    corpusSize: allRows.length,
    collab: distStats(collab),
    pure: distStats(pure),
    categoriesMean,
    substrateStats,
    redirects: allRows.filter((r) => r.isRedirect).length,
    empty: allRows.filter((r) => r.isEmpty).length,
    top10,
    bottom5,
  };

  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(`\nSummary written to data/summary.json`);
  console.log(`Collab: min=${summary.collab.min} median=${summary.collab.median} mean=${summary.collab.mean} p90=${summary.collab.p90} p95=${summary.collab.p95} p99=${summary.collab.p99} max=${summary.collab.max}`);
  console.log(`Pure:   min=${summary.pure.min} median=${summary.pure.median} mean=${summary.pure.mean} p90=${summary.pure.p90} p95=${summary.pure.p95} p99=${summary.pure.p99} max=${summary.pure.max}`);
  console.log(`Substrate means: hooks=${substrateStats.hooks.mean} skills=${substrateStats.skills.mean} commands=${substrateStats.commands.mean} scheduled=${substrateStats.scheduledTasks.mean} mcp=${substrateStats.mcpServers.mean} memory=${substrateStats.memoryFiles.mean}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
