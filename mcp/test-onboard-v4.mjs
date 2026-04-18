#!/usr/bin/env node
// Smoke test for v4 onboard flow — greet (Q0) + intro..cadence + plan.
// Verifies Q0 name collection and "Kære Jarl" personalisation.

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({ name: 'onboard-v4-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(__dirname, 'dist', 'index.js')],
  env: { ...process.env, DEARUSER_NO_AUTO_OPEN: '1' },
});

await client.connect(transport);

async function call(args) {
  const result = await client.callTool({ name: 'onboard', arguments: args });
  return result.content.map(c => c.text).join('');
}

function banner(label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`STEP: ${label}`);
  console.log('='.repeat(70));
}

function extractState(text) {
  const m = text.match(/state`: `"([^"]+)"/);
  return m ? m[1] : null;
}

// 1. greet (no answer) — should ask for name
banner('1. greet — welcome + Q0 name');
let out = await call({});
console.log(out);
let state = extractState(out);

// 2. answer Q0 with "Jarl"
banner('2. answer Q0 — "Jarl"');
out = await call({ step: 'greet', answer: 'Jarl', state });
console.log(out);
state = extractState(out);

// 3. answer Q1 work
banner('3. answer Q1 — work');
out = await call({
  step: 'intro',
  answer: 'Jeg driver et venture studio og koordinerer flere projekter samtidig.',
  state,
});
console.log(out);
state = extractState(out);

// 4. answer Q2 pains
banner('4. answer Q2 — pains');
out = await call({
  step: 'work',
  answer: 'Jeg skriver samme status-opdatering manuelt hver mandag.',
  state,
});
console.log(out);
state = extractState(out);

// 5. answer Q3 data
banner('5. answer Q3 — data');
out = await call({
  step: 'data',
  answer: 'Mest i Notion, men mange idéer i min email.',
  state,
});
console.log(out);
state = extractState(out);

// 6. answer Q4 cadence
banner('6. answer Q4 — cadence');
out = await call({
  step: 'cadence',
  answer: 'Hver morgen gerne — det er kun til mig.',
  state,
});
console.log(out);

await client.close();
console.log('\n--- DONE ---');
