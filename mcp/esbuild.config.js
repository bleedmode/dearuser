import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  allowOverwrite: true,
  // Bundle everything — no externals. Faster startup = fewer module resolutions.
  external: [],
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
});
