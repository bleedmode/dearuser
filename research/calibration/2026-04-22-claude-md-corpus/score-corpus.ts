// score-corpus.ts — run Dear User's collaboration scorer against each CLAUDE.md.
//
// We isolate the CLAUDE.md signal by feeding a minimal ScanResult that has:
//   - globalClaudeMd populated with the fetched content
//   - everything else (memory, hooks, skills, mcp servers, scheduled tasks)
//     stubbed to empty/zero
//
// This means two scorers won't reflect their full picture:
//   - qualityStandards reads hooks (always 0 → penalty)
//   - memoryHealth reads memory files (always 0 → penalty)
//   - systemMaturity reads all artifacts (always 0 → penalty)
//   - coverage reads only sections from CLAUDE.md (full signal)
//   - roleClarity/communication/autonomyBalance read only from CLAUDE.md (full signal)
//
// For corpus analysis that's the right trade-off: we want to compare CLAUDE.md
// files against each other, not their broader setups. The report notes which
// categories were unfairly penalized.
//
// We also run the lint checks (which are CLAUDE.md-native, no substrate needed).

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Import from the engine — note .js suffix is required for ESM under NodeNext
import { parse } from '../../../mcp/src/engine/parser.js';
import { score } from '../../../mcp/src/engine/scorer.js';
import { lintClaudeMd } from '../../../mcp/src/engine/lint-checks.js';
import type { ScanResult, FileInfo, LintFinding } from '../../../mcp/src/types.js';

interface ScoreRow {
  idx: number;
  repo: string;
  stars: number;
  size: number;
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
  signalSensitiveScore: number; // collab but only counting CLAUDE.md-dependent categories
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

async function main() {
  const hereDir = import.meta.dirname;
  const DATA_DIR = join(hereDir, 'data');
  const RAW_DIR = join(DATA_DIR, 'raw');
  const OUT_JSONL = join(DATA_DIR, 'scores.jsonl');
  const OUT_SUMMARY = join(DATA_DIR, 'summary.json');

  const manifest = JSON.parse(readFileSync(join(DATA_DIR, 'manifest.json'), 'utf-8'));
  console.log(`Scoring ${manifest.entries.length} files...`);

  const rows: ScoreRow[] = [];
  // Truncate jsonl
  writeFileSync(OUT_JSONL, '');

  for (const entry of manifest.entries) {
    const content = readFileSync(join(RAW_DIR, entry.file), 'utf-8');
    const scan = buildMinimalScan(entry.repo, content);
    const parsed = parse(scan);
    const scoringResult = score(parsed, scan);

    const lintResult = lintClaudeMd(scan, parsed);

    const byCheck: Record<string, number> = {};
    for (const f of lintResult.findings as LintFinding[]) {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
    }

    // CLAUDE.md-only subscore: re-weight the 4 categories that depend only on
    // CLAUDE.md content (roleClarity, communication, autonomyBalance,
    // coverage). These weights sum to 0.55 in the full schema; we renormalize
    // to 1.0 so comparison isn't pulled down by the zeroed-out substrate
    // categories.
    const pureCategories = ['roleClarity', 'communication', 'autonomyBalance', 'coverage'] as const;
    const pureWeights = { roleClarity: 0.15, communication: 0.10, autonomyBalance: 0.20, coverage: 0.10 };
    const pureWeightSum = pureCategories.reduce((s, k) => s + pureWeights[k], 0);
    const signalSensitiveScore = Math.round(
      pureCategories.reduce(
        (s, k) => s + (scoringResult.categories[k].score * pureWeights[k]) / pureWeightSum,
        0,
      ),
    );

    const row: ScoreRow = {
      idx: entry.idx,
      repo: entry.repo,
      stars: entry.stars,
      size: entry.size,
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
        doRules: parsed.rules.filter(r => r.type === 'do_autonomously').length,
        askRules: parsed.rules.filter(r => r.type === 'ask_first').length,
        suggestRules: parsed.rules.filter(r => r.type === 'suggest_only').length,
        prohibitions: parsed.rules.filter(r => r.type === 'prohibition').length,
      },
      sections: parsed.sections.map(s => s.id).filter(s => s !== 'other'),
      lint: {
        total: lintResult.summary.totalFindings,
        critical: lintResult.summary.bySeverity.critical,
        recommended: lintResult.summary.bySeverity.recommended,
        nice: lintResult.summary.bySeverity.nice_to_have,
        byCheck,
      },
      intentionalAutonomy: scoringResult.intentionalAutonomy,
    };

    rows.push(row);
    const fs = await import('node:fs');
    fs.appendFileSync(OUT_JSONL, JSON.stringify(row) + '\n');

    console.log(
      `  [${entry.idx}] ${entry.repo.padEnd(50)} collab=${row.collabScore.toString().padStart(3)} ` +
      `pure=${row.signalSensitiveScore.toString().padStart(3)} lint=${row.lint.total}`,
    );
  }

  // Summary
  const collab = rows.map(r => r.collabScore).sort((a, b) => a - b);
  const pure = rows.map(r => r.signalSensitiveScore).sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.floor((arr.length - 1) * p)];
  const histogram = (arr: number[], bins: number[]) => {
    const h: Record<string, number> = {};
    for (let i = 0; i < bins.length - 1; i++) {
      const label = `${bins[i]}-${bins[i + 1] - 1}`;
      h[label] = arr.filter(v => v >= bins[i] && v < bins[i + 1]).length;
    }
    return h;
  };
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];

  const summary = {
    corpusSize: rows.length,
    collab: {
      min: collab[0],
      max: collab[collab.length - 1],
      mean: Math.round(collab.reduce((a, b) => a + b, 0) / collab.length),
      median: pct(collab, 0.5),
      p10: pct(collab, 0.1),
      p25: pct(collab, 0.25),
      p75: pct(collab, 0.75),
      p90: pct(collab, 0.9),
      histogram: histogram(collab, bins),
    },
    pure: {
      min: pure[0],
      max: pure[pure.length - 1],
      mean: Math.round(pure.reduce((a, b) => a + b, 0) / pure.length),
      median: pct(pure, 0.5),
      p10: pct(pure, 0.1),
      p25: pct(pure, 0.25),
      p75: pct(pure, 0.75),
      p90: pct(pure, 0.9),
      histogram: histogram(pure, bins),
    },
    categoriesMean: {
      roleClarity: Math.round(rows.reduce((s, r) => s + r.categories.roleClarity, 0) / rows.length),
      communication: Math.round(rows.reduce((s, r) => s + r.categories.communication, 0) / rows.length),
      autonomyBalance: Math.round(rows.reduce((s, r) => s + r.categories.autonomyBalance, 0) / rows.length),
      qualityStandards: Math.round(rows.reduce((s, r) => s + r.categories.qualityStandards, 0) / rows.length),
      memoryHealth: Math.round(rows.reduce((s, r) => s + r.categories.memoryHealth, 0) / rows.length),
      systemMaturity: Math.round(rows.reduce((s, r) => s + r.categories.systemMaturity, 0) / rows.length),
      coverage: Math.round(rows.reduce((s, r) => s + r.categories.coverage, 0) / rows.length),
    },
    lintTotals: (() => {
      const allChecks: Record<string, number> = {};
      for (const r of rows) {
        for (const [k, v] of Object.entries(r.lint.byCheck)) {
          allChecks[k] = (allChecks[k] || 0) + v;
        }
      }
      return allChecks;
    })(),
    lintBySeverity: {
      critical: rows.reduce((s, r) => s + r.lint.critical, 0),
      recommended: rows.reduce((s, r) => s + r.lint.recommended, 0),
      nice: rows.reduce((s, r) => s + r.lint.nice, 0),
    },
    lintMean: Math.round(rows.reduce((s, r) => s + r.lint.total, 0) / rows.length),
    intentionalAutonomyCount: rows.filter(r => r.intentionalAutonomy).length,
    lowest5: [...rows].sort((a, b) => a.collabScore - b.collabScore).slice(0, 5).map(r => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
    highest5: [...rows].sort((a, b) => b.collabScore - a.collabScore).slice(0, 5).map(r => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
    lowestPure5: [...rows].sort((a, b) => a.signalSensitiveScore - b.signalSensitiveScore).slice(0, 5).map(r => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
    highestPure5: [...rows].sort((a, b) => b.signalSensitiveScore - a.signalSensitiveScore).slice(0, 5).map(r => ({
      idx: r.idx, repo: r.repo, collab: r.collabScore, pure: r.signalSensitiveScore, size: r.size, stars: r.stars,
    })),
  };

  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(`\nSummary: data/summary.json`);
  console.log(`Mean collab: ${summary.collab.mean} (median ${summary.collab.median}, p10 ${summary.collab.p10}, p90 ${summary.collab.p90})`);
  console.log(`Mean pure:   ${summary.pure.mean} (median ${summary.pure.median}, p10 ${summary.pure.p10}, p90 ${summary.pure.p90})`);
  console.log(`Mean lint findings per file: ${summary.lintMean}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
