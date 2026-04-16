---
name: dearuser:audit
description: System coherence check — orphan jobs, overlap, dead hooks, structural issues. Powered by Dear User.
allowed-tools: "mcp__dearuser__audit"
---

# Dear User — Audit

Run a structural coherence audit using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__audit` with default parameters (no arguments needed — global scope, all findings).
2. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
- If the user asks about a specific finding type, pass `focus` with the relevant value (orphan, overlap, closure, substrate, mcp_refs, backup).
