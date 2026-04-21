#!/usr/bin/env node
// Direct tool invocation — bypasses MCP deferred loading.
// Shipped as the `dearuser-run` bin so skills can `npx -y dearuser-mcp run <tool>`
// without hardcoded paths. Also used as a fallback in skill SKILL.md files
// when mcp__dearuser__* tools haven't loaded yet on turn 1 of a session.
//
// Usage: dearuser-run <tool-name> [json-args]

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { join } from 'path';

// esbuild banner defines __dirname for this ESM bundle.
const toolName = process.argv[2];
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {};

if (!toolName) {
  console.error('Usage: dearuser-run <tool-name> [json-args]');
  console.error('Example: dearuser-run collab \'{"format":"text"}\'');
  process.exit(1);
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
