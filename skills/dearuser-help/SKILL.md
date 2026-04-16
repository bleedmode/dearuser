---
name: dearuser:help
description: Show Dear User's capabilities and available tools.
allowed-tools: "mcp__dearuser__help"
---

# Dear User — Help

Show what Dear User can do using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__help` with no arguments.
2. Output the returned text EXACTLY as your response — do NOT summarize, re-wrap, or add commentary.

## Rules

- The output is pre-formatted markdown. Show it verbatim.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
