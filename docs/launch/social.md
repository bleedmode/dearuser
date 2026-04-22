# Launch social drafts — Dear User

## Twitter / X

### Launch thread (primary)

**Tweet 1 (hook):**
> Built Dear User — an open-source audit tool for Claude Code setups.
>
> It reads your CLAUDE.md, hooks, skills, memory — and tells you what's contradictory, dangerously permissive, or leaking credentials.
>
> Local-first. Free.
>
> dearuser.ai

**Tweet 2 (feature #1):**
> 🔐 Scans for leaked API keys in 12 categories — OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, Google, Supabase, Vercel, private keys, env secrets, bearer tokens.
>
> Every pattern matches a real token prefix. No false positives on commit hashes.

**Tweet 3 (feature #2):**
> 🧠 Detects semantic conflicts in your CLAUDE.md.
>
> "Always prefer X" + "Never use X in context Y" → flagged.
>
> No LLM. No cloud. Just clever regex + topic overlap + a swiss-cheese quality gate.

**Tweet 4 (feature #3):**
> 📊 Scoring calibrated against 50 public CLAUDE.md files.
>
> Median score is 19/100 — and that's healthy. Public CLAUDE.md files are repo onboarding docs, not agent contracts. Dear User tells you the difference.

**Tweet 5 (share / viral):**
> 🔗 Every report can be turned into a public link: dearuser.ai/r/<token>
>
> Anonymized (paths, emails, secrets stripped). Share your score. Compare setups. Let the HubSpot Grader pattern do what it does best.

**Tweet 6 (privacy close):**
> One promise: your data stays on your machine.
>
> MCP tool: no telemetry.
> Dashboard: no telemetry.
> Website: cookieless analytics.
>
> Only `share_report` and `feedback` send anything — and both are explicit commands you run.

**Tweet 7 (install):**
> Install:
>
> ```
> claude mcp add dearuser -- npx dearuser-mcp
> ```
>
> Feedback? `dearuser feedback "..."` lands in my inbox.
>
> Code: github.com/bleedmode/dearuser

### Single-shot variants (if not a thread)

**A (secrets angle):**
> Leaked an API key in your CLAUDE.md? Dear User catches it across 12 categories (OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, Google, Supabase, Vercel, private keys, env secrets, bearer tokens). Open source, local-first. dearuser.ai

**B (collab angle):**
> Your agent's config is either helping it or quietly confusing it. Dear User audits your CLAUDE.md, hooks, skills, memory — 50+ lint checks, semantic conflict detection, scoring calibrated against 50 public setups. Free. dearuser.ai

**C (share angle):**
> Every Claude Code setup has a hidden score. Dear User computes it and lets you share a public link to your report. HubSpot-Grader for agents. dearuser.ai

## LinkedIn

Medium-length post, slower tone:

> I've been building agent-based tools for six months and the hardest part isn't the model or the tooling — it's keeping CLAUDE.md and your hooks and your skills all pointing the same direction.
>
> So I built Dear User. It reads your entire Claude Code setup and reports what's broken, contradictory, or dangerously permissive. Three tools:
>
> - Collab: lint checks, semantic conflict detection, scoring against a real corpus
> - Security: 12-category credential scanner, prompt-injection surfaces, platform advisor orchestration
> - Health: orphan jobs, overlap, structural drift
>
> Local-first. Open source. Free. The only time anything leaves your machine is when you explicitly run `share_report` or `feedback`.
>
> Install: claude mcp add dearuser -- npx dearuser-mcp
> Repo: github.com/bleedmode/dearuser
> Web: dearuser.ai
>
> If you're a Claude Code user, run it once. Tell me what's wrong with the score. It's the only way it gets better.

## Reddit — /r/ClaudeAI + /r/mcp + /r/LocalLLaMA

Title: **Dear User — open-source audit tool for Claude Code setups (secrets, conflicts, health)**

Body (keep it short — Reddit doesn't reward length):

> I built Dear User because I kept adding rules to my CLAUDE.md and wasn't sure if they were helping.
>
> It's an MCP server that audits your setup and reports:
> - Leaked credentials (12 categories, prefix-matched — no false positives)
> - Semantic conflicts between your rules (no LLM, pure heuristic)
> - Orphan scheduled tasks, skill overlap, structural drift
> - Scoring calibrated against 50 public CLAUDE.md files
>
> Everything stays on your machine. The only network calls are explicit: `share_report` (anonymized public link) and `feedback` (lands in my inbox).
>
> ```
> claude mcp add dearuser -- npx dearuser-mcp
> ```
>
> Repo: https://github.com/bleedmode/dearuser
> Web: https://dearuser.ai
>
> Happy to answer anything.

## Timing

- **HN** first — highest visibility, kicks off the cycle
- **Twitter thread** same day, 2-3 hours after HN post
- **LinkedIn** day 2 (slower crowd)
- **Reddit** day 2-3 after HN peaks (avoid karma-farming flags)

## Don't

- Don't post to /r/programming — automod hostile
- Don't post the same copy to 5 subreddits in an hour — shadow-ban risk
- Don't DM influencers begging for RT — they can smell it
- Don't respond to trolls. Ever.
