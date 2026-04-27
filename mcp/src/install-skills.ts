#!/usr/bin/env node
// One-shot skill installer — copies bundled skills into ~/.claude/skills/ so
// Claude Code picks them up as slash commands. Idempotent: overwrites existing
// dearuser-* skills with the shipped version (they're versioned with the
// package). Never touches skills outside the dearuser-* namespace.
//
// Usage: dearuser-install-skills
// Or:    npx -p @poisedhq/dearuser-mcp dearuser-install-skills
//
// Shipped as a separate bin rather than npm postinstall because:
// (a) postinstall running in CI / dependency scans is surprising,
// (b) users who only want the MCP server shouldn't have ~/.claude/ written to
//     without opt-in.

import { cpSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// esbuild banner defines __dirname for this ESM bundle. Skills ship inside the
// package at <pkg>/skills/. When built, dist/ sits next to skills/, so look
// one level up.
const skillsSrc = join(__dirname, '..', 'skills');
const skillsDest = join(homedir(), '.claude', 'skills');

if (!existsSync(skillsSrc)) {
  console.error(`Skills not found at ${skillsSrc}. This is a packaging bug — please report it at https://github.com/bleedmode/dearuser/issues`);
  process.exit(1);
}

mkdirSync(skillsDest, { recursive: true });

const skills = readdirSync(skillsSrc, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith('dearuser-'))
  .map(e => e.name);

for (const skill of skills) {
  const from = join(skillsSrc, skill);
  const to = join(skillsDest, skill);
  cpSync(from, to, { recursive: true, force: true });
  console.log(`✓ installed: ${skill}`);
}

console.log(`\n${skills.length} Dear User skills installed to ${skillsDest}`);
console.log(`Restart Claude Code to see them as slash commands (e.g. /dearuser-collab).`);
