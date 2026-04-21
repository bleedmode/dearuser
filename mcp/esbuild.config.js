import { build } from 'esbuild';

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
