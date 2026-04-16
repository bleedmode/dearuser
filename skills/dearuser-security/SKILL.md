---
name: dearuser:security
description: Security audit — leaked secrets, injection surfaces, rule conflicts. Powered by Dear User.
allowed-tools: "mcp__dearuser__security"
---

# Dear User — Security

Run a security audit using the Dear User MCP server.

## What to do

1. Call `mcp__dearuser__security` with default parameters (no arguments needed — global scope).
2. Output the ENTIRE returned report as your response text — do NOT summarize, shorten, or add commentary.

## Rules

- The report is pre-formatted markdown. Show it exactly as returned.
- If the tool is not available, tell the user to check that the Dear User MCP server is running (`claude mcp list`).
- If secrets are found, emphasize that the user should rotate them immediately.
