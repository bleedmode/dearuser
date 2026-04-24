---
name: dearuser:feedback
description: Send a short note (bug, request, reaction) to the Dear User founders. Powered by Dear User.
allowed-tools: "mcp__dearuser__feedback, Bash"
---

# Dear User — Feedback

Send the user's message to the Dear User founder inbox.

## What to do

1. Take whatever the user said (or the argument text) and pass it verbatim as `message`. Do NOT rewrite, shorten, or summarise.
2. Try calling `mcp__dearuser__feedback` with `{ "message": "<the user's text>" }`.
3. **If the tool is not available** (first turn of session — MCP tools load lazily), use this Bash fallback:
   ```
   npx -y -p dearuser-mcp dearuser-run feedback '{"message":"<escaped user text>"}' 2>/dev/null
   ```
4. Show the returned confirmation to the user exactly as returned — it's already short and friendly.

## Optional parameters

Only include these when the user explicitly provided them:
- `rating` (1–5) — only when the user typed a number
- `context` — `collab` / `security` / `health` / `wrapped` / `general`. Default to the tool they just ran, or `general`.
- `opt_in_followup` + `email` — only when the user explicitly asked for a reply

## Rules

- Write-only. This is the one place Dear User sends data out. Never invoke it without an explicit user message.
- Never infer sentiment to fill in `rating`. Leave it out unless the user said a number.
- If the tool returns an error, show the error text — the message was NOT sent.
