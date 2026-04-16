import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
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
});
