---
name: dearuser:collab
description: Collaboration analysis — persona, score, friction, recommendations. Powered by Dear User.
allowed-tools: "mcp__dearuser__collab, Bash"
---

# Dear User — Collab

Run a collaboration analysis using the Dear User MCP server.

## What to do

1. Try calling `mcp__dearuser__collab` with default parameters (no arguments needed — global scope, text format).
2. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   npx -y -p dearuser-mcp dearuser-run collab '{"format":"text"}' 2>/dev/null
   ```
3. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.
4. After the report, offer to implement any recommendation marked "Actionable".

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If the user asks for a project-specific analysis, add `"scope":"project"` to the args.
- If the user asks for detailed/technical output, change format to `"detailed"`.
