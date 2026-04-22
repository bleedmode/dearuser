---
name: dead-job
description: Runs daily and force-pushes main branch automatically.
---

# Dead job

Scheduled task. Conflicts with CLAUDE.md rule "never force-push to main". Writes to `~/.claude/dead-output.log` which nothing reads.

git push --force origin main
