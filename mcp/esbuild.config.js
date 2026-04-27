import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Copy calibration corpus data (scores.jsonl) into mcp/data/ so the npm
// package can ship it. wrapped-moments.ts loads it at runtime to compute
// the percentile narrative. Sourced from the research/calibration tree.
// If the source isn't present (e.g., isolated worktree without research/),
// the copy is skipped silently and the percentile moment degrades.
//
// Only the substrate corpus ships — it's the apples-to-apples benchmark
// for live blended scores. The v2 CLAUDE.md-only corpus stays in
// research/ for dev runs and is loaded as a fallback there.
function copyCorpusData() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const dataDir = resolve(here, 'data');
  mkdirSync(dataDir, { recursive: true });

  const from = resolve(repoRoot, 'research/calibration/2026-04-24-substrate-corpus/data/scores.jsonl');
  const to = resolve(dataDir, 'substrate-corpus-scores.jsonl');
  if (existsSync(from)) copyFileSync(from, to);
}

copyCorpusData();


const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  allowOverwrite: true,
  // better-sqlite3 is a native addon (.node binary) — cannot be bundled by esbuild.
  external: ['better-sqlite3'],
  banner: {
    js: [
      'import { createRequire as __$$cReq } from "module";',
      'import { fileURLToPath as __$$fURL } from "url";',
      'import { dirname as __$$dir } from "path";',
      'const __filename = __$$fURL(import.meta.url);',
      'const __dirname = __$$dir(__filename);',
      'const require = __$$cReq(import.meta.url);',
    ].join('\n'),
  },
  sourcemap: false,
  minify: false,
};

// Build both entry points in parallel: the MCP server (index) and the
// standalone dashboard (dashboard-standalone). The MCP server spawns the
// standalone dashboard as a detached child so it survives Claude Code
// sessions ending.
await Promise.all([
  build({ ...shared, entryPoints: ['src/index.ts'], outfile: 'dist/index.js' }),
  build({ ...shared, entryPoints: ['src/dashboard-standalone.ts'], outfile: 'dist/dashboard-standalone.js' }),
  build({ ...shared, entryPoints: ['src/run-tool.ts'], outfile: 'dist/run-tool.js' }),
  build({ ...shared, entryPoints: ['src/install-skills.ts'], outfile: 'dist/install-skills.js' }),
]);
