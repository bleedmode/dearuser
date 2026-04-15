# Dear User — Setup Guides

Dear User's `security` tool orchestrates scans across multiple platforms. Each one has its own auth step. You only need to set up the platforms you actually use — everything else skips gracefully.

## Quick reference

| Platform | Auth | Setup guide |
|----------|------|-------------|
| Supabase | Access token | [supabase.md](./supabase.md) |
| GitHub | `gh` CLI | [github.md](./github.md) |
| npm | None (offline) | Just works |
| Vercel | Access token | [vercel.md](./vercel.md) |

## Where to put credentials

Dear User looks for tokens in this order (first found wins):

1. **Environment variables** — best for CI, servers, or one-off runs
2. **`~/.dearuser/config.json`** — best for permanent local setup
3. **1Password CLI** — internal Poised Venture Studio convention

If nothing is configured for a platform, that platform's scan is skipped with an actionable message telling you exactly what to set. Dear User never fails the whole scan because one platform lacks auth.

## The config file

Optional. Created automatically by the `onboard` tool, or write it by hand:

```json
{
  "searchRoots": ["~/code", "~/projects"],
  "tokens": {
    "supabase": "sbp_xxxxx",
    "vercel": "xxxxx"
  },
  "disabledAdvisors": ["vercel"]
}
```

- **`searchRoots`** — folders Dear User scans for projects. Defaults try `~/clawd`, `~/code`, `~/projects`, `~/work`, `~/src` and fall back to `$HOME`.
- **`tokens`** — platform credentials. Leave out what you don't need.
- **`disabledAdvisors`** — skip specific platforms (values: `supabase`, `github`, `npm`, `vercel`).

Keep the file readable only by you: `chmod 600 ~/.dearuser/config.json`.

## Troubleshooting

**"No X projects found"** — Dear User didn't find a file signature for that platform inside your search roots. Add the right folder to `searchRoots`, or confirm the project is checked out.

**"X projects detected but no token"** — auth isn't configured. See the relevant platform guide.

**Scan is slow** — `npm audit` can take several seconds per project. Use `disabledAdvisors: ["npm"]` if you already run audits in CI.
