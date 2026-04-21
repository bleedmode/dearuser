---
name: dearuser:collab
description: Collaboration analysis — persona, score, friction, recommendations. Powered by Dear User.
allowed-tools: "mcp__dearuser__collab"
---

# Dear User — Collab

Run a collaboration analysis using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__collab` with default parameters (no arguments needed — global scope, text format).
2. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.
3. After the report, offer to implement any recommendation marked "Actionable".

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
- If the user asks for a project-specific analysis, pass `scope: "project"` and `projectRoot` as the current working directory.
- If the user asks for detailed/technical output, pass `format: "detailed"`.
