---
name: dearuser:wrapped
description: Shareable collaboration stats in Spotify Wrapped style. Powered by Dear User.
allowed-tools: "mcp__dearuser__wrapped"
---

# Dear User — Wrapped

Generate shareable collaboration stats using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__wrapped` with default parameters (no arguments needed — global scope, text format).
2. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted ASCII art. Show it exactly as returned.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
