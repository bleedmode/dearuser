# Show HN draft — Dear User

## Title (Show HN requires format `Show HN: <title> — <tagline>`)

Candidates, ordered by gut feel:

1. **Show HN: Dear User – audit your Claude Code setup (CLAUDE.md, hooks, skills)**
2. **Show HN: Dear User – find leaked API keys in your AI agent config**
3. **Show HN: Dear User – a local-first audit tool for Claude Code users**

Pick #1 as the primary. It explains what it is in plain terms and lands the "audit" framing that matches the product.

## Body (paste into the "text" box)

---

Hi HN,

I built Dear User after spending months staring at a 500-line CLAUDE.md file, wondering whether it was helping my agent or quietly confusing it.

It's an open-source MCP server that reads your Claude Code setup — CLAUDE.md, memory, hooks, skills, scheduled tasks — and tells you what's broken, contradictory, or dangerously permissive. Three main tools:

- **`collab`** scores how well your agent instructions actually work. It runs 50+ lint checks, detects semantic conflicts between rules, and benchmarks your setup against a corpus of 2,895 public CLAUDE.md files.
- **`security`** scans for leaked credentials (12 categories: OpenAI, Anthropic, GitHub, AWS, Stripe, Slack, Google, Supabase, Vercel, private keys, env secrets, bearer tokens), prompt-injection surfaces in your hooks, and conflicts between CLAUDE.md rules and actual artefact behaviour. It also orchestrates platform advisors (Supabase RLS, npm audit, Vercel, GitHub Dependabot) if you give it tokens.
- **`health`** finds orphan scheduled tasks, overlapping skills, missing closure loops, and other structural drift across your setup.

Everything runs locally. SQLite at `~/.dearuser/dearuser.db`. No cloud required, no API keys to us. The only time anything leaves your machine is if you explicitly run `share_report` to generate a public `dearuser.ai/r/<token>` link or `feedback` to send me a message.

Install:
```
claude mcp add dearuser -- npx dearuser-mcp
```

Then ask your agent: "run a Dear User audit".

The interesting engineering bits I'd love feedback on:
- Finding-ledger pattern with stable `finding_hash` — scans converge instead of duplicating.
- Swiss-cheese quality gates on the semantic conflict detector (no LLM, no cloud — regex polarity + topic overlap + anchor gate).
- Scoring calibrated against 2,895 public CLAUDE.md files; median score is 18/100 and that's actually healthy — the public corpus is dominated by repo onboarding docs, not agent contracts.

What I'm NOT doing: session replay, autocapture, or any surveillance of how you use the product. Website analytics are cookieless. There's no tracking in the MCP tool or the dashboard. That's the whole point.

Source: https://github.com/bleedmode/dearuser
Web: https://dearuser.ai

Feedback via `dearuser feedback "..."` from your terminal lands directly in my inbox.

---

## Notes before posting

- Post on a **Tuesday or Wednesday morning US Pacific time** — best HN window.
- First hour is everything. Reply to every comment within 5 minutes.
- Don't say "please upvote". Don't say "please share". Don't apologize for anything.
- Titles starting with "Show HN:" auto-enter the Show HN queue. Don't add emojis.
- Don't post if you have <2 hours to sit at the keyboard responding. A stale thread dies.

## Things likely to come up — prepare short answers

**Q: Why not use a pre-built linter?**
The existing tools (agnix, AgentLinter) do structural/syntactic checks. Dear User adds semantic conflict detection, platform advisor orchestration, scoring calibrated against a real corpus, and a shareable report layer. Different value prop.

**Q: How does the secrets scanner avoid false positives?**
Every pattern matches a recognised token prefix. I don't flag arbitrary 32-char hex strings or base64-looking blobs — too many commit hashes and nonces. False positives would erode trust faster than the feature earns it.

**Q: Why "Dear User"?**
It's a letter from the agent to the human, not a dashboard of metrics about the human.

**Q: Is this just another surveillance tool dressed up as productivity?**
No. MCP tool and dashboard have zero telemetry. Website analytics are cookieless. Source is open so you can verify.

**Q: What's the business model?**
Free and open. Eventual paid tier for monitoring/coaching/team features. Not today — today is "does this solve a real problem for real users".
