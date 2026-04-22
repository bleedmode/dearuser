# Contributing to Dear User

Thanks for considering a contribution. Dear User is small, so keep changes tight and focused.

## Ways to help

- **File an issue** — bugs, false positives in the scanner, unclear recommendations, broken install flows
- **Submit a PR** — small fixes (typos, broken links, lint-check tuning, new client install instructions)
- **Share feedback** — use the `feedback` tool from inside Claude, or open a discussion issue

## Before you open a PR

1. Check existing issues — someone may already be on it
2. For anything larger than a typo fix, open an issue first so we can agree on the approach
3. Keep PRs focused — one change per PR

## Development setup

```bash
git clone https://github.com/bleedmode/dearuser.git
cd dearuser/mcp
npm install
npm run build
npm test
```

Point your local Claude Code at the dev build:

```bash
claude mcp add dearuser-dev -- node /absolute/path/to/dearuser/mcp/dist/index.js
```

## Ground rules

- **Privacy first.** Dear User is local-first. Any change that introduces a network call needs to be explicit, documented, and user-triggered (like `share_report` and `feedback`). No silent telemetry, ever.
- **No scope creep.** Dear User is a diagnostic tool for Claude Code collaboration. Task management, project tracking and dashboards live elsewhere.
- **Match existing patterns.** Tool descriptions follow a 6-part structure (Purpose / Guidelines / Limitations / Params / Length / Examples). Recommendations go through the finding-ledger pipeline.
- **Conventional commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
- **Tests for new detectors.** If you add a lint check or scanner pattern, add at least one unit test.

## License

By contributing, you agree your contribution is licensed under MIT (same as the project).
