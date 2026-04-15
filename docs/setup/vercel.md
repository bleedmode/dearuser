# Vercel setup

Dear User audits your Vercel **environment variables** — specifically, it flags any production env var stored as `plain` instead of `encrypted`. Plain env vars are visible in the dashboard to anyone with project access, which defeats the point of having "secrets" in the first place.

## What you'll see

- Plain-text env vars in production (should be encrypted)
- Per-project coverage of your Vercel deployments

## Step 1 — Get an access token

Go to [vercel.com/account/tokens](https://vercel.com/account/tokens) and click **Create Token**.

- **Name:** `dearuser-local`
- **Scope:** your personal account *or* the team Dear User should cover
- **Expiration:** pick what you're comfortable with (180 days is reasonable)

Copy the token once — you won't see it again.

## Step 2 — Tell Dear User about it

Pick one:

**Option A — environment variable**:
```bash
export VERCEL_TOKEN="xxxxx"
```

**Option B — config file**:
```json
{
  "tokens": {
    "vercel": "xxxxx"
  }
}
```
Save as `~/.dearuser/config.json`, then `chmod 600 ~/.dearuser/config.json`.

## Step 3 — Make sure projects are discoverable

Dear User finds Vercel projects by looking for `.vercel/project.json` — the file `vercel link` or `vercel deploy` creates. If your project has been deployed from this machine, this file exists.

For projects you deploy from CI but never locally, run `vercel link` inside the project folder once to create the file. Or add those projects via `searchRoots` pointing to wherever you keep them.

## Step 4 — Verify

```
✅ vercel   projects=N  ok
```

If `skipped — no token`, the token didn't register — confirm env var or config. If `projects=0`, no `.vercel/project.json` was found in your search roots.

## About the "plain env var" finding

Vercel has three env var types:
- **Encrypted** — value is hidden in the dashboard, revealed only at build/runtime. **Use this for secrets.**
- **Plain** — value visible to anyone with project access. Fine for public config like `NEXT_PUBLIC_APP_NAME`. **Never use for secrets.**
- **System** — Vercel-provided (`VERCEL_URL`, `VERCEL_ENV`) — not flagged.

Dear User flags plain env vars in **production** because that's where accidentally-plain secrets do damage. If you know it's public config, the finding is safe to ignore.

## Permissions

The token scope you picked at creation time determines which projects Dear User can see. If a project is missing from the scan, check it's in the right team scope.

## What Dear User doesn't do

- Never writes to your Vercel account
- Never triggers deployments
- Never reads env var *values* — only their `type` metadata
- Results stay on your machine
