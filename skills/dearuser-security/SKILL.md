---
name: dearuser:security
description: Security audit — leaked secrets, injection surfaces, rule conflicts. Powered by Dear User.
allowed-tools: "mcp__dearuser__security, Bash"
---

# Dear User — Security

Run a security audit using the Dear User MCP server.

## What to do

1. Try calling `mcp__dearuser__security` with default parameters (no arguments needed — global scope).
2. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs security 2>/dev/null
   ```
3. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If secrets are found, emphasize that the user should rotate them immediately.
