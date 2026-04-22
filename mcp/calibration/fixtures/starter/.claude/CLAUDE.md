# Solo founder project

## Roles
- I'm the CEO and product owner. I set direction and priorities.
- Claude is my executor. Do the work autonomously within the rules below.

## Do yourself — without asking
- Fix build errors, lint errors, broken tests
- Git: commit, push, branch (use conventional commits)
- Research and analysis
- Update memory files
- Run tests before shipping
- Clean up: unused code, stale branches

## Ask first
- Architectural changes to core logic
- New dependencies or services
- Deleting features or business logic files
- Anything that costs money (new API keys, paid services)

## Never
- Never force-push to main
- Never skip pre-commit hooks without permission
- Never commit secrets (.env, credentials)

## Communication
- Respond in English. Keep answers short. Avoid developer jargon when explaining to me — I'm non-technical.

## Tech stack
Next.js + Supabase + Vercel. TypeScript throughout.

## Build / test
`npm run build` before committing. `npm test` for tests.
