# GitHub setup

Dear User uses the `gh` CLI. No separate token config — if `gh` works, Dear User works.

## What you'll see

- **Dependabot alerts** — vulnerable dependencies flagged by GitHub
- **Secret scanning alerts** — real leaked credentials detected by GitHub
- **Dependabot disabled** — repos where security features are off (actionable: enable them)

## Step 1 — Install `gh`

Already installed on most dev machines. Otherwise: [cli.github.com](https://cli.github.com).

```bash
brew install gh   # macOS
```

## Step 2 — Authenticate

```bash
gh auth login
```

Choose **GitHub.com**, your preferred protocol (SSH or HTTPS), and follow the browser flow. One-time setup.

## Step 3 — Verify

```bash
gh auth status
```

Should show `Logged in to github.com`. If it does, Dear User will find all your GitHub repos via `.git/config` and query them.

## Step 4 — Enable Dependabot (optional but recommended)

Dear User flags repos where Dependabot is disabled. For each of yours:

1. Go to the repo on GitHub → Settings → Code security and analysis
2. Enable **Dependabot alerts**
3. (Optional but recommended) Enable **Dependabot security updates** for auto-PRs

Private repos on free plans have limited coverage — paid plans get more.

## Secret scanning

Secret scanning alerts are only available on public repos or with GitHub Advanced Security (paid). If your repos don't have it, Dear User silently skips that sub-check — only Dependabot alerts will show.

## Permissions

The default `gh auth` scope (`repo`) is enough for Dependabot alerts. If you see a `403` about missing `admin:repo_hook`, run:
```bash
gh auth refresh -h github.com -s admin:repo_hook
```

## What Dear User doesn't do

- Never writes to your repos
- Never pushes code or opens PRs
- Only reads alert feeds via the GitHub API
- Alerts stay on your machine — Dear User has no remote component
