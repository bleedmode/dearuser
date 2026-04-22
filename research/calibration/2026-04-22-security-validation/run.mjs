#!/usr/bin/env node
// run.mjs — bundle validate.ts with esbuild (pulling in secret-scanner from
// the mcp source tree) and execute the bundle with node.
//
// Keeps research self-contained: no need to `npm run build` in mcp/ first.

// esbuild lives in mcp/node_modules; import from there.
const { build } = await import('../../../mcp/node_modules/esbuild/lib/main.js');
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '.build');
const outFile = join(outDir, 'validate.mjs');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(here, 'validate.ts')],
  bundle: true,
  outfile: outFile,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'warning',
});

try {
  execFileSync('node', [outFile], {
    stdio: 'inherit',
    env: { ...process.env, FIXTURE_ROOT: here },
  });
} catch (err) {
  process.exit(typeof err.status === 'number' ? err.status : 1);
}
