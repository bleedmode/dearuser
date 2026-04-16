#!/usr/bin/env node
// Direct tool invocation — bypasses MCP deferred loading.
// Usage: node run-tool.mjs <tool-name> [json-args]
// Example: node run-tool.mjs analyze '{"format":"text"}'

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolName = process.argv[2];
const toolArgs = process.argv[3] ? JSON.parse(process.argv[3]) : {};

if (!toolName) {
  console.error('Usage: node run-tool.mjs <tool-name> [json-args]');
  process.exit(1);
}

const client = new Client({ name: 'dearuser-runner', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(__dirname, 'dist', 'index.js')],
});

await client.connect(transport);
const result = await client.callTool({ name: toolName, arguments: toolArgs });

for (const item of result.content) {
  if (item.type === 'text') process.stdout.write(item.text);
}

await client.close();
