# Supabase setup

Dear User reads directly from Supabase's **Advisor API** — the same linter that powers the warnings in the Supabase dashboard. We don't re-scan your database; we surface what Supabase itself already knows.

## What you'll see

- Row-level security policies that don't exist on tables that have RLS enabled
- Policies that allow unrestricted access (effectively bypassing RLS)
- Functions with mutable `search_path` (SQL injection surface)
- Anonymous-access policies on sensitive tables

## Step 1 — Get an access token

Go to [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) and click **Generate new token**. Copy it — you won't see it again.

Name suggestion: `dearuser-local` so you know what it's for.

## Step 2 — Tell Dear User about it

Pick one:

**Option A — environment variable** (best for CI):
```bash
export SUPABASE_ACCESS_TOKEN="sbp_xxxxx"
```

**Option B — config file** (best for permanent local setup):
```json
{
  "tokens": {
    "supabase": "sbp_xxxxx"
  }
}
```
Save as `~/.dearuser/config.json` and run `chmod 600 ~/.dearuser/config.json`.

## Step 3 — Make sure your projects are discoverable

Dear User finds Supabase projects by scanning `.env` files for `SUPABASE_URL`. Nothing to configure if your projects have standard `.env` files with that line. If they're somewhere unusual, add that folder to `searchRoots` in the config.

## Step 4 — Verify

Run the security tool. You should see:
```
✅ supabase   projects=N  ok
```

If it says `skipped — no token available`, the token didn't register — confirm the env var or config path is right. If it says `projects=0`, Dear User didn't find any `.env` files with `SUPABASE_URL` in your search roots.

## Permissions

The token needs read access to the Advisor API. The tokens Supabase generates via the dashboard already have the right scope — no extra config needed.

## What Dear User doesn't do

- Never writes to your database
- Never reads row data
- Only calls the read-only Advisor endpoint
- Results stay on your machine — Dear User has no remote component
