#!/usr/bin/env node
// Smoke test for v3 onboard flow — exercises the Lovable-friendly step names.
// Runs via run-tool.mjs so we test the actual MCP-served bundle.

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({ name: 'onboard-v3-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(__dirname, 'dist', 'index.js')],
});

await client.connect(transport);

async function call(args) {
  const result = await client.callTool({ name: 'onboard', arguments: args });
  const text = result.content.map(c => c.text).join('');
  return text;
}

function banner(label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`STEP: ${label}`);
  console.log('='.repeat(70));
}

// Extract the state blob from a response so we can pass it to the next call
function extractState(text) {
  const m = text.match(/state`: `"([^"]+)"/);
  return m ? m[1] : null;
}

// 1. intro (no answer yet)
banner('1. intro — show welcome + Q1');
let out = await call({});
console.log(out);
let state = extractState(out);

// 2. answer Q1 (work description — non-coder signal). Still in 'intro'.
banner('2. answer Q1 — non-coder doing venture studio work');
out = await call({
  step: 'intro',
  answer: 'Jeg driver et venture studio. Jeg koder ikke men jeg arbejder meget med at holde styr på flere projekter og tasks samtidig.',
  state,
});
console.log(out);
state = extractState(out);

// 3. answer Q2 (pains) — step='work'
banner('3. answer Q2 — pains');
out = await call({
  step: 'work',
  answer: 'Jeg skriver den samme ugentlige status-opdatering manuelt hver mandag. Jeg glemmer halvdelen af de ideer jeg får under dagen. Jeg har svært ved at se hvilken app jeg skal prioritere næste.',
  state,
});
console.log(out);
state = extractState(out);

// 4. answer Q3 (data location) — step='data'
banner('4. answer Q3 — data lives in Notion + head');
out = await call({
  step: 'data',
  answer: 'Det meste ligger i Notion — en side per projekt. Men mange ideer ryger bare i en notes-app eller i min email.',
  state,
});
console.log(out);
state = extractState(out);

// 5. answer Q4 (cadence + audience) — step='cadence'
banner('5. answer Q4 — daily + team');
out = await call({
  step: 'cadence',
  answer: 'Hver morgen gerne — det er kun til mig selv.',
  state,
});
console.log(out);

await client.close();
console.log('\n--- DONE ---');
