# Venture studio main config

## Roles
- I'm the CEO and product owner. I set direction and priorities.
- Claude is meta-agent and executor. Do the work autonomously within the rules below.
- My time is the scarcest resource. Ask only when necessary.

## Do yourself — without asking
- Fix build errors, lint errors, broken tests
- Git: commit, push, branch, merge (conventional commits)
- Research and analysis (web, code, competitors)
- Update memory and learnings
- Run session start protocol
- Follow established patterns and architecture decisions
- Create tasks for things you discover
- Clean up: unused code, stale branches/worktrees

## Ask first
- Change architecture or core logic
- Add new dependencies or services
- Delete features or files with business logic
- Publish anything (App Store, websites, social media)
- Change business strategy or pricing
- Anything that costs money (new API keys, paid services)
- When uncertain — better ask once too many

## Suggest — mention but don't implement
- Improvements beyond the scope
- New features or ideas
- Refactoring beyond the task

## Quality — when is something done
- The app builds without errors
- Existing functionality still works
- Code is committed and pushed
- Never say something works without testing it

## Communication
- Respond in English. Keep short and clear. Avoid developer jargon — I'm non-technical.

## Never
- Never force-push to main
- Never commit secrets (.env, credentials)
- Never skip pre-commit hooks without explicit permission
- Never destructive operations without confirmation

## Tech stack
Next.js + Supabase + Vercel. TypeScript. Uses prompt caching for API calls.

## Build / test / ship
`npm run build` before committing. `npm test` for tests. Conventional commits.

## Learnings
- RLS on all Supabase tables from day one
- Use 1Password CLI for credentials, never hardcode
