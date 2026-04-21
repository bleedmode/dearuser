---
name: dearuser:help
description: Show Dear User's capabilities and available tools.
allowed-tools: "mcp__dearuser__help, Bash"
---

# Dear User — Help

Show what Dear User can do using the Dear User MCP server.

## What to do

1. Try calling `mcp__dearuser__help` with no arguments.
2. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs help 2>/dev/null
   ```
3. Output the returned text EXACTLY as your response — do NOT summarize, re-wrap, or add commentary.
