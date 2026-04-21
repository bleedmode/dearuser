---
name: dearuser:health
description: System health — 0-100 score for om dit setup (skills, hooks, scheduled tasks, MCP servers) stadig hænger sammen, eller er ved at drive fra hinanden. Powered by Dear User.
allowed-tools: "mcp__dearuser__health"
---

# Dear User — Health

Run a structural health check using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__health` with default parameters (no arguments needed — global scope, all findings).
2. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
- If the user asks about a specific finding type, pass `focus` with the relevant value (orphan, overlap, closure, substrate, mcp_refs, backup).
