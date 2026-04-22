#!/usr/bin/env node
// build.mjs — bundle calibration/run-single.ts into calibration/dist/run-single.js
// so it can be spawned cleanly by the harness with a fixture HOME.
//
// Kept out of the main esbuild.config.js because calibration is internal tooling,
// not a shipped artifact. Invoke via: node calibration/build.mjs

import { build } from 'esbuild';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  allowOverwrite: true,
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
  entryPoints: [resolve(__dirname, 'run-single.ts')],
  outfile: resolve(__dirname, 'dist/run-single.js'),
});

console.log('built calibration/dist/run-single.js');
