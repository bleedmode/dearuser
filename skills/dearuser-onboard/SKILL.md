---
name: dearuser:onboard
description: Guided 7-step setup for new Claude Code users. Powered by Dear User.
allowed-tools: "mcp__dearuser__onboard, Bash"
---

# Dear User — Onboard

Run the guided onboarding flow using the Dear User MCP server.

## What to do

1. Try calling `mcp__dearuser__onboard` with no arguments to start.
2. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs onboard 2>/dev/null
   ```
   For subsequent steps:
   ```
   node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs onboard '{"step":"<nextStep>","answer":"<user answer>","state":"<state>"}' 2>/dev/null
   ```
3. Output the returned text EXACTLY as your response — do NOT summarize, rephrase, or wrap it.
4. Collect the user's answer.
5. Call again with `step` (from previous response's nextStep), `answer` (user's reply), and `state` (from previous response, passed back verbatim).
6. Repeat until the response contains `done: true`, then show the final plan.

## Rules

- The `state` parameter is opaque. Pass it back unchanged — never parse or modify it.
- Each step's output is pre-formatted. Show it exactly as returned, then wait for the user's answer.
- Do NOT ask your own questions — the tool provides the questions.
