# Privacy

Dear User is local-first by design. This doc explains what it reads, what it writes, and the exact conditions under which anything leaves your machine.

## Short version

- **Reads:** your Claude Code config files (CLAUDE.md, memory, skills, hooks) and session metadata
- **Writes:** one SQLite file at `~/.dearuser/dearuser.db`
- **Transmits:** nothing, unless you explicitly call `share_report` or `feedback`
- **No sign-up, no API keys, no telemetry**

## What Dear User reads from your machine

The scanner reads these locations (paths may vary by client):

| What | Where | Why |
|------|-------|-----|
| Project instructions | `CLAUDE.md` in project root and subfolders | To score collaboration rules, check for conflicts |
| Global instructions | `~/.claude/CLAUDE.md`, `~/.claude/memory/**` | Same |
| Skills (slash commands) | `~/.claude/skills/**`, project `.claude/skills/**` | Overlap detection, orphan check |
| Hooks | `~/.claude/hooks/**` and settings | Structural health checks |
| Scheduled tasks | `~/.claude/scheduled-tasks/**` | Orphan job detection |
| MCP config | `~/.claude.json`, `~/.claude/mcp.json` | Verify claims in CLAUDE.md against actual config |
| Session metadata | `~/.claude/projects/**/sessions/*.jsonl` — counts, timestamps, prompt lengths | Detect prompt patterns (short, vague, repetitive) |

**Dear User never reads session message content.** It parses `.jsonl` session logs for length and structural signals only — not the words you typed or the words the agent said back.

## What Dear User writes to your machine

One file: `~/.dearuser/dearuser.db` (SQLite, WAL mode).

Four tables:

- `du_agent_runs` — timestamp, tool name, summary (no file contents)
- `du_recommendations` — each recommendation we've surfaced + whether you implemented it
- `du_score_history` — your score over time
- `du_findings` — scan-driven findings with stable hashes for lifecycle tracking

Dear User does **not** modify your CLAUDE.md, memory, skills, hooks, or any other file — unless you explicitly call `implement_recommendation`, which has a preview step and tells you exactly what will change before it does.

## What leaves your machine

Two tools, and only when you call them:

### `share_report`

Uploads an anonymized copy of a report to `dearuser.ai` and returns a URL like `dearuser.ai/r/<token>`.

Before upload, the report is passed through a sanitizer that:

- Collapses absolute filesystem paths to basenames (`/Users/jane/secret-project` → `secret-project`)
- Strips email addresses
- Redacts anything matching our secret-scanner patterns: OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, Google, Supabase, Vercel tokens, private keys, generic env secrets, bearer tokens

You can pass `expires_at` (ISO-8601 timestamp) to auto-expire the link. Without it, the link is permanent until you rotate the token server-side (coming soon: a `revoke_share` tool).

Your local DB is **not** modified by `share_report`. The upload is a one-way copy of the report JSON.

Required environment variables: `DEARUSER_SUPABASE_URL`, `DEARUSER_SUPABASE_SERVICE_KEY`. Without them, the tool errors and nothing uploads — the rest of Dear User keeps working entirely locally.

### `feedback`

Sends a message to our Supabase inbox. That's the whole point of the tool.

What's attached:

- The text you wrote
- Dear User version number
- Nothing else — not your scans, not your files, not your identity

We read the inbox directly in Supabase. There's no automated reply; we use it to fix bugs and prioritize features.

## What Dear User does not do

- **No keychain access** — we scan config files for leaked tokens. We never touch your system password manager, keychain, or credential helper.
- **No network calls during scans** — `collab`, `health`, `security`, `onboard`, `wrapped`, `history` are pure filesystem operations. You can verify with `lsof` or Little Snitch.
- **No conversation content access** — session metadata only (counts, lengths). Not message bodies.
- **No telemetry / analytics** — we don't know you installed it unless you run `feedback` or `share_report`.
- **No background scans** — Dear User runs only when the agent calls a tool.

## Platform advisors (optional)

The `security` tool can optionally orchestrate scans from Supabase, GitHub, npm and Vercel advisors if you supply tokens. Those are direct calls from **your machine** to those platforms' APIs — Dear User just aggregates the results locally. Nothing is routed through `dearuser.ai`.

See [`setup/README.md`](setup/README.md) for what each platform sees if you enable it.

## Reporting a privacy issue

Open an issue on [GitHub](https://github.com/bleedmode/dearuser/issues) or use the `feedback` tool from inside Claude. We take this seriously — Dear User is a tool about trust, and a leak would undo the whole thing.
