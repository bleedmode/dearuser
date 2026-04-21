---
name: dearuser:wrapped
description: Shareable collaboration stats in Spotify Wrapped style. Powered by Dear User.
allowed-tools: "mcp__dearuser__wrapped, Bash"
---

# Dear User — Wrapped

Generate shareable collaboration stats using the Dear User MCP server.

## What to do

1. Try calling `mcp__dearuser__wrapped` with default parameters (no arguments needed — global scope, text format).
2. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   npx -y -p dearuser-mcp dearuser-run wrapped 2>/dev/null
   ```
3. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted ASCII art. Show it exactly as returned.
