#!/usr/bin/env node
// Direct tool invocation — bypasses MCP deferred loading.
// Shipped as the `dearuser-run` bin so skills can `npx -y @poisedhq/dearuser-mcp run <tool>`
// without hardcoded paths. Also used as a fallback in skill SKILL.md files
// when mcp__dearuser__* tools haven't loaded yet on turn 1 of a session.
//
// Usage: dearuser-run <tool-name> [json-args]

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { join } from 'path';

// esbuild banner defines __dirname for this ESM bundle.
const toolName = process.argv[2];
const rawArg = process.argv[3];

if (!toolName) {
  console.error('Usage: dearuser-run <tool-name> [json-args|-]');
  console.error('Example: dearuser-run collab \'{"format":"text"}\'');
  console.error('         echo \'{"message":"..."}\' | dearuser-run feedback -');
  process.exit(1);
}

// Pass "-" to read JSON from stdin — avoids shell-quoting pitfalls when
// content contains apostrophes, quotes, or shell metacharacters.
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

let toolArgs: Record<string, unknown> = {};
try {
  let parsed: unknown = {};
  if (rawArg === '-') {
    const stdin = (await readStdin()).trim();
    parsed = stdin ? JSON.parse(stdin) : {};
  } else if (rawArg) {
    parsed = JSON.parse(rawArg);
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    toolArgs = parsed as Record<string, unknown>;
  } else {
    console.error('dearuser-run: JSON args must be an object');
    process.exit(2);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`dearuser-run: failed to parse JSON args — ${msg}`);
  process.exit(2);
}

const client = new Client({ name: 'dearuser-runner', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(__dirname, 'index.js')],
});

await client.connect(transport);
const result = await client.callTool({ name: toolName, arguments: toolArgs });

for (const item of (result.content as Array<{ type: string; text?: string }>)) {
  if (item.type === 'text' && item.text) process.stdout.write(item.text);
}

await client.close();
