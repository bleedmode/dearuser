# Dear User

Helps humans and AI agents understand each other better.

## What it does

- **`analyze`** — Scans your CLAUDE.md, memory files, hooks, skills, sessions, and history. Diagnoses collaboration problems, recommends specific tools and config, guides onboarding for gaps.
- **`wrapped`** — Your Agent Wrapped — shareable stats about your collaboration.

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
claude mcp add dearuser -- npx dearuser-mcp
```

## Usage

In Claude Code, ask your agent:

```
Kør dearuser analyze
```

## How it works

Three knowledge sources:
- **External knowledge** — research database with evidence ratings
- **Your files** — CLAUDE.md, memory, hooks, skills, sessions, history
- **Feedback loop** — tracks whether recommendations were implemented and their effect

All data stays local. Nothing leaves your machine.

## License

MIT
