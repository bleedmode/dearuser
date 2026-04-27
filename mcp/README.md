# Dear User

**Your AI agent works for you — but how well do you work together?**

Dear User analyzes your human-agent collaboration and tells you exactly what to fix. It scans your CLAUDE.md, memory, hooks, skills, and sessions to produce a collaboration score, detect your persona, find friction, and recommend specific tools and config changes.

Everything runs locally. Nothing leaves your machine unless you actively choose to share your Wrapped card. No API keys required.

## Without Dear User vs. With Dear User

**Without Dear User**, you're guessing:
- Your CLAUDE.md might have gaps you don't know about
- Your agent might be ignoring rules because they conflict with a hook
- You might have API keys sitting in memory files
- Scheduled tasks might produce output nothing reads
- You correct the same mistakes session after session because no one tracks what works

**With Dear User**, you know:
- Collaboration score: 73/100 — Role Clarity is strong, Quality Standards need work
- Persona: Indie Hacker (87% confidence) — recommendations tailored to your work style
- 2 leaked tokens found in memory files — rotate immediately
- 3 orphan scheduled tasks producing output nothing consumes
- Feedback loop: 4 recommendations implemented since last scan, score up +8 points

## Install

One command. No global installs, no build steps.

<details open>
<summary><strong>Claude Code (CLI)</strong></summary>

```bash
claude mcp add --scope user dearuser -- npx @poisedhq/dearuser-mcp
```

Restart Claude Code afterwards so the tools appear.
</details>

<details>
<summary><strong>Claude Code (VS Code / JetBrains extension)</strong></summary>

Open settings, go to MCP Servers, click "Add Server", and enter:

```json
{
  "dearuser": {
    "command": "npx",
    "args": ["@poisedhq/dearuser-mcp"]
  }
}
```
</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

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
</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `.cursor/mcp.json` in your project root:

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
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

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
</details>

<details>
<summary><strong>Cline (VS Code)</strong></summary>

Open Cline MCP settings and add:

```json
{
  "dearuser": {
    "command": "npx",
    "args": ["@poisedhq/dearuser-mcp"]
  }
}
```
</details>

<details>
<summary><strong>Zed</strong></summary>

Add to Zed `settings.json`:

```json
{
  "context_servers": {
    "dearuser": {
      "command": {
        "path": "npx",
        "args": ["@poisedhq/dearuser-mcp"]
      }
    }
  }
}
```
</details>

## Your first prompt

After installing, ask your agent:

```
Analyze my collaboration with Claude
```

Full report in under 10 seconds: persona, score, friction patterns, and specific recommendations you can apply immediately.

## Tools

| Tool | What it does | Try it |
|------|-------------|--------|
| **collab** | Full collaboration report — persona, score, friction, recommendations | *"How good is my Claude setup?"* |
| **health** | Structural coherence — orphan jobs, overlapping skills, dead hooks | *"Are any of my scheduled tasks broken?"* |
| **security** | Leaked secrets, prompt-injection surfaces, rule conflicts | *"Check my config for leaked API keys"* |
| **onboard** | 7-step guided setup for new users | *"Help me create a CLAUDE.md"* |
| **wrapped** | Shareable Spotify Wrapped-style collaboration stats | *"Give me my Dear User Wrapped"* |
| **history** | Show existing reports (trend, regression) without re-scanning | *"What did last night's scan say?"* |
| **implement_recommendation** | Apply a pending recommendation (CLAUDE.md append, settings merge, or manual) | *"Yes, add that rule"* |
| **dismiss_recommendation** | Mark a recommendation as irrelevant | *"Skip that one"* |
| **share_report** | Upload an anonymized Wrapped card to dearuser.ai and return a public URL (Wrapped only) | *"Share my Wrapped"* |
| **feedback** | Send a short note (bug, request, reaction) to the Dear User founders | *"Tell them this crashed"* |
| **help** | Capabilities menu | *"What can Dear User do?"* |

## Slash commands (skills)

Dear User ships with 8 slash commands. Install them to `~/.claude/skills/` with:

```bash
npx -p @poisedhq/dearuser-mcp dearuser-install-skills
```

Then restart Claude Code. Available commands: `/dearuser-collab`, `/dearuser-health`, `/dearuser-security`, `/dearuser-onboard`, `/dearuser-wrapped`, `/dearuser-history`, `/dearuser-help`, `/dearuser-feedback`.

## How it works

```
Your files (CLAUDE.md, memory, hooks, skills, sessions)
        |
   Scanner --> Parser --> Engines
        |
Persona detection --> Scoring --> Gap analysis --> Recommendations
        |
   Feedback loop (tracks which recommendations you implemented)
```

**5 personas** detected from your setup: Vibe Coder, Senior Developer, Indie Hacker, Venture Studio, Team Lead — each gets tailored recommendations.

**7 scoring categories**: Role Clarity, Communication, Autonomy Balance, Quality Standards, Memory Health, System Maturity, Coverage.

**Feedback loop**: Dear User remembers its recommendations. Next time you run collab, it checks which ones you implemented and shows the score delta.

## Session-start integration

Dear User is most valuable when run at the start of each coding session. Add this to your CLAUDE.md:

```markdown
## Session start protocol
1. Run dearuser collab (scope: project)
2. Review any critical recommendations
3. Check feedback loop for pending items
```

This turns Dear User from a one-time scan into a daily collaboration coach — solving the same problem that makes Context7 sticky (useful every single session, not just once).

## Privacy and trust

- **Local by default** — scans and reports stay on your machine; nothing uploads unless you call `share_report` to publish your Wrapped card
- **No file modification** — read-only, never writes to your config
- **No API keys needed** — zero external dependencies
- **No conversation access** — reads metadata only (session count, prompt lengths), never message content
- **No password/keychain access** — scans config files for leaked tokens, never touches system credentials

Every tool description includes a "What this tool does NOT do" section so you and your agent know exactly what the boundaries are.

## What it can help with

| Problem | How Dear User helps |
|---------|-------------------|
| Scope creep | Detects missing autonomy tiers, recommends specific rules |
| Communication mismatch | Identifies language/tone gaps, suggests CLAUDE.md sections |
| Vague prompts | Counts short/unclear prompts, coaches better patterns |
| Leaked secrets | Scans CLAUDE.md, memory, skills for API keys and tokens |
| Missing tooling | Recommends specific MCP servers for your detected problems |
| Over-engineering | Identifies workflow rules that prevent unnecessary complexity |
| Destructive commands | Flags missing safety hooks for rm, force-push, etc. |
| Setup gaps | Detects missing hooks, memory, skills, scheduled tasks |

## What it cannot help with

- Rate limits / token drain (platform pricing)
- Model quality changes (provider-side)
- Vendor lock-in (structural)
- Fix loops (fundamental AI limitation)

## Development

```bash
cd mcp
npm install
npm run build
npm run dev  # watch mode
```

## License

MIT
