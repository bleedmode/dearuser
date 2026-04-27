# Dear User

**Your AI agent works for you — but how well do you work together?**

Dear User is an open-source tool that audits your Claude Code setup and tells you exactly what to fix. It scores your collaboration, finds leaked secrets and config conflicts, and checks system health — all locally, nothing uploaded unless you explicitly share your Wrapped card.

> `claude mcp add dearuser -- npx @poisedhq/dearuser-mcp`
>
> Then ask Claude: *"Analyze my collaboration with Claude"*

**Landing:** [dearuser.ai](https://dearuser.ai) · **Feedback:** use the `feedback` tool in Claude, or open an [issue](https://github.com/bleedmode/dearuser/issues)

---

## What it does

Dear User is an **MCP server** (Model Context Protocol — the plugin system Claude Code and Claude Desktop use). Once installed, it shows up as a set of tools your agent can call. No GUI, no sign-up, no cloud account.

Three local reports, one shareable Wrapped card, one feedback channel:

| Tool | What it does | Example prompt |
|------|--------------|----------------|
| `collab` | Full collaboration report — persona, 0-100 score, friction patterns, specific recommendations | *"How good is my Claude setup?"* |
| `security` | Leaked secrets, prompt-injection surfaces, rule conflicts in your agent contract (CLAUDE.md or AGENTS.md) | *"Check my config for leaked API keys"* |
| `health` | Structural coherence — orphan scheduled tasks, overlapping skills, dead hooks | *"Is anything broken in my setup?"* |
| `wrapped` | Spotify-style shareable stats card — scores + counts + persona. Opt-in public URL via `share_report`. | *"Give me my Dear User Wrapped"* |
| `feedback` | Send a note to the Dear User inbox | *"Send feedback: the health report could be shorter"* |

Plus helpers: `onboard` (7-step guided setup), `history` (trend without re-scanning), `help` (menu), `implement_recommendation`, `dismiss_recommendation`, `share_report` (Wrapped-only upload).

## Launch highlights

- **Shareable Wrapped** — run `wrapped`, then `share_report` to get a `dearuser.ai/r/<token>` URL for your stats card. Anonymized before upload (paths collapsed to basenames, emails stripped, secrets redacted). Collab/security/health reports stay local — findings can carry business context that isn't safe to auto-share.
- **12-category secret scanner** — OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, Google, Supabase, Vercel, private keys, generic env secrets, bearer tokens. Scans CLAUDE.md / AGENTS.md, memory files, skills, hooks.
- **AGENTS.md native support** — first-class input alongside CLAUDE.md. Works out of the box for Cursor, Codex, Aider, Cline, Zed and anyone following the [Linux Foundation cross-tool standard](https://github.com/AgentUserInterface/agentsmd). Both files in the same directory? We merge them.
- **Semantic conflict detection** (new) — finds rules that contradict each other even when they don't share keywords. "Commit often" vs. "ask before commit" gets flagged.
- **Score calibrated against reality** — two studies: 988 public Claude Code setups with substrate committed (median 32/100, max 63) and 2,895 standalone CLAUDE.md files (median 18, max 60). The substrate corpus is the apples-to-apples benchmark for live scores. See [`research/calibration/`](research/calibration/2026-04-24-substrate-corpus/) for both studies.

## Install

One command per client. Full guide: [`docs/install.md`](docs/install.md).

**Claude Code (CLI)**

```bash
claude mcp add dearuser -- npx @poisedhq/dearuser-mcp
```

**Claude Desktop** — add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "dearuser": {
      "command": "npx",
      "args": ["@poisedhq/dearuser-mcp"]
    }
  }
}
```

**Cursor, Windsurf, Cline, Zed** — see [`docs/install.md`](docs/install.md).

Optional: install the slash commands (see [Commands](#commands) for the full list) so you can type `/dearuser-collab` instead of asking in prose:

```bash
npx -p @poisedhq/dearuser-mcp dearuser-install-skills
```

## Your first 5 minutes

After installing, restart your client and try these in order:

1. **Baseline scan:**
   ```
   Run Dear User collab on this project
   ```
   You'll get a persona (Vibe Coder / Senior Developer / Indie Hacker / Venture Studio / Team Lead), a 0-100 score across 7 categories, and 3-10 concrete recommendations.

2. **Security sweep:**
   ```
   Run Dear User security
   ```
   Checks your agent contract (CLAUDE.md or AGENTS.md), memory, skills and hooks for leaked tokens, injection surfaces and rule conflicts.

3. **Share the result (optional):**
   ```
   Share my collab report
   ```
   Returns a `dearuser.ai/r/<token>` link. Anonymized before upload. You choose whether to paste it anywhere.

Example output from `collab`:

```
Persona: Indie Hacker (87% confidence)
Score:   73 / 100

Top friction:
  • Quality Standards — no test-before-commit rule in CLAUDE.md
  • Memory Health    — 2 memory files haven't been touched in 90+ days
  • Communication    — no language preference stated (English vs Danish mixing)

Recommendations (3 shown, 5 total):
  1. Add a "Session start protocol" block to CLAUDE.md  (apply with: implement_recommendation)
  2. Rotate the OpenAI key leaked in ~/.claude/memory/api-notes.md
  3. Merge overlapping skills: deploy-check and ship-check share 80% of their rules
```

## Commands

Eight slash commands ship with Dear User. Ask your agent by name, or type the slash command if you installed them with `dearuser-install-skills`.

| Command | What it does |
|---|---|
| `/dearuser-collab` | Collaboration analysis — persona, 0-100 score across 7 categories, prioritized recommendations. |
| `/dearuser-health` | System health — orphan jobs, overlap, stale schedules, missing MCP registrations, reconciliation gaps. |
| `/dearuser-security` | Secret scan, prompt-injection surfaces, and rule conflicts in your agent contract. |
| `/dearuser-wrapped` | Shareable collaboration stats in a Spotify-Wrapped style card. |
| `/dearuser-onboard` | Conversational 7-step setup for first-time users. |
| `/dearuser-history` | Show your last reports, score trend over time, or what changed since the last run — no re-scan. |
| `/dearuser-feedback` | Send a short note (bug, request, reaction) to the Dear User founders. |
| `/dearuser-help` | Show what Dear User can do and list every tool. |

Three in-chat actions the agent can call for you: `share_report` (upload a Wrapped card to `dearuser.ai/r/<token>`), `implement_recommendation` (apply a pending recommendation), `dismiss_recommendation` (mark one irrelevant).

## Privacy

Dear User is local-first. Your scans stay on your machine:

- Your agent contract (CLAUDE.md or AGENTS.md), memory, skills, hooks and session metadata are read but **never uploaded**
- Results are stored in `~/.dearuser/dearuser.db` (SQLite, WAL mode)
- The optional localhost dashboard reads from that DB — nothing is transmitted
- Dear User reads session **metadata only** (counts, lengths) — never your actual conversation content
- No API keys required, no sign-up, no telemetry

The **only** exceptions are things you explicitly trigger:

- **`share_report` (Wrapped only)** — your Wrapped card is anonymized (paths collapsed, emails stripped, anything matching our secret patterns redacted) and uploaded to `dearuser.ai` so you can share a URL. Your local DB is not modified. You can set an `expires_at` to auto-expire the link. Collab/security/health reports are NOT shareable — findings can carry business context (project names, client names, architecture notes) we don't think should live on a public URL.
- **`feedback`** — when you call the feedback tool, your message goes to our Supabase inbox. That's the whole point of the tool. We don't attach your scans or files — only the text you write.

No other tool transmits anything. If `share_report` isn't configured with `DEARUSER_SUPABASE_URL` + `DEARUSER_SUPABASE_SERVICE_KEY`, it errors out cleanly and the rest of Dear User keeps working.

Full privacy details: [`docs/privacy.md`](docs/privacy.md).

## How it works

```
Your files (CLAUDE.md or AGENTS.md, memory, hooks, skills, sessions)
        │
    Scanner ──► Parser ──► Engines (scoring, secrets, conflicts, health)
        │
 Persona detection → Scoring → Gap analysis → Recommendations
        │
    Feedback loop (tracks which recommendations you implemented)
        │
    ~/.dearuser/dearuser.db  ←  dashboard reads from here
```

- **5 personas** detected from your setup — each gets tailored recommendations
- **7 scoring categories**: Role Clarity, Communication, Autonomy Balance, Quality Standards, Memory Health, System Maturity, Coverage
- **Feedback loop**: Dear User remembers what it recommended. Next run, it checks which ones you implemented and shows the score delta.

## Who it's for

- **"Vibe coders"** — you prompt Claude and ship product, but you're never quite sure if your setup is actually working. Dear User tells you.
- **Senior developers** — you want a fast audit for leaked secrets, config drift and rule conflicts without wiring up a custom lint pipeline.
- **Indie hackers / solo founders** — you've accumulated hooks, skills and memory across projects. Dear User surfaces what's orphaned or contradicting itself.
- **Team leads** — you want a local audit of your team's shared agent setup. Collab, security and health reports stay on your machine; only your personal Wrapped card can be shared publicly.

## Repository layout

- [`mcp/`](mcp/) — `@poisedhq/dearuser-mcp` npm package (the MCP server). See [`mcp/README.md`](mcp/README.md) for development notes.
- [`web/`](web/) — `dearuser.ai` landing + share-report pages (Astro).
- [`docs/`](docs/) — install guide, privacy doc, per-platform setup (Supabase/GitHub/Vercel for the optional `security` platform advisors).
- [`research/`](research/) — calibration data + architecture notes we're willing to share.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Bug reports and small fixes welcome via GitHub issues and PRs.

## Links

- [dearuser.ai](https://dearuser.ai) — landing page
- [Feedback inbox](https://dearuser.ai/feedback) — or use the `feedback` MCP tool from inside Claude
- [GitHub issues](https://github.com/bleedmode/dearuser/issues) — bugs, feature requests
- [Install guide](docs/install.md) · [Privacy](docs/privacy.md) · [Setup for platform advisors](docs/setup/README.md)

## License

Dear User is MIT-licensed. See [`LICENSE`](LICENSE).

**Open-core commitment:** everything in this repo is MIT and stays MIT. If we ever build team or hosted features (agency dashboards, cross-project trend lines, vertical-specific benchmarks), they'll live in separate repos with their own license — never by pulling pieces out of this one.
