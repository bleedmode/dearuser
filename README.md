# Agent Wrapped MCP

MCP server that analyzes human-agent collaboration and helps improve it.

## What it does

- **`analyze`** — Scans your CLAUDE.md, memory files, hooks, skills, sessions, and history. Produces a collaboration report with persona detection, scoring, friction analysis, and concrete recommendations.
- **`onboard`** — Conversational onboarding that scans what exists, identifies gaps, and guides a mutual getting-to-know-you conversation between human and agent.
- **`wrapped`** — Shareable "Spotify Wrapped"-style stats about your collaboration.

## What it can help with

1. Scope creep — agent changes things it wasn't asked to
2. Communication mismatch — wrong language, too technical, wrong tone
3. Bad prompts — vague instructions that lead to wrong results
4. Missing security rules — hardcoded keys, no input validation
5. Missing tooling — identifies which MCP servers solve your specific problems
6. Over-engineering — dev server for a favicon change
7. Missing visibility — agent doesn't update your task tracker
8. Wrong language — responds in English to a Danish user
9. Destructive commands — blocks rm -rf, force push, terraform destroy
10. Setup gaps — no hooks, no memory, no skills

## What it cannot help with

- Rate limits / token drain (platform pricing)
- Model quality degradation (Anthropic/OpenAI changes)
- Vendor lock-in (structural market problem)
- Skill atrophy (education problem)
- Fix loops (fundamental AI limitation)

## Install

```bash
claude mcp add agent-wrapped -- npx agent-wrapped-mcp
```

## Usage

In Claude Code, ask your agent:

```
Run agent-wrapped analyze
```

Or for onboarding:

```
Run agent-wrapped onboard
```

## How it works

Three knowledge sources:
- **External knowledge** — research database with evidence ratings
- **Your files** — CLAUDE.md, memory, hooks, skills, sessions, history
- **Feedback loop** — tracks whether recommendations were implemented and their effect

All data stays local. Nothing leaves your machine.

## License

MIT
