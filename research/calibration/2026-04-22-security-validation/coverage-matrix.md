# Secret-scanner coverage matrix — Dear User vs industry tools

**Scope:** secret detection layer only. Prompt-injection and rule-conflict
detectors are domain-specific to Claude-Code agent configs and have no
direct counterpart in Snyk/gitleaks/trufflehog/Semgrep.

**Evidence for competitor columns:** public documentation only, as of
2026-04-22. We did not execute competing tools against our corpus — coverage
is inferred from their published rule lists / detector catalogues.

Sources consulted:
- gitleaks default config (`config/gitleaks.toml`, 160+ rules in `gitleaks.toml`)
- trufflehog detector registry (`pkg/detectors/`, 800+ detectors)
- Snyk Code "hardcoded secret" rule family (documented in docs.snyk.io)
- Semgrep "secrets" ruleset (`p/secrets`, 100+ rules)

## Category-level coverage

Legend: Y = covered by default ruleset, P = partial (covered but with known
limitation), N = not covered, D = covered but disabled in current build.

| Category        | Dear User | gitleaks | trufflehog | Snyk  | Semgrep |
|-----------------|-----------|----------|------------|-------|---------|
| openai_key      | Y         | Y        | Y          | Y     | Y       |
| anthropic_key   | Y         | Y        | Y          | Y     | Y       |
| github_token    | Y         | Y        | Y          | Y     | Y       |
| stripe_key      | Y         | Y        | Y          | Y     | Y       |
| aws_key         | Y (ID)    | Y        | Y          | Y     | Y       |
| slack_token     | Y         | Y        | Y          | Y     | Y       |
| google_api_key  | Y         | Y        | Y          | Y     | Y       |
| supabase_key    | P (JWT)   | P (JWT)  | Y          | P     | P       |
| vercel_token    | D         | Y        | Y          | Y     | P       |
| private_key     | Y         | Y        | Y          | Y     | Y       |
| env_secret      | P         | P        | P          | Y     | Y       |
| bearer_token    | Y         | P        | P          | Y     | Y       |

### Notes on partials

- **aws_key (P for us)**: we detect the *Access Key ID* (AKIA prefix) but
  not the *Secret Access Key* (40-char base64 with no deterministic prefix).
  All competitors detect both — the secret half is harder because it has no
  prefix; gitleaks/trufflehog use entropy + surrounding-context rules.
- **supabase_key (P everywhere)**: the JWT-shape detection picks up Supabase
  anon/service keys, but also Auth0, Firebase custom tokens, and any other
  JWT. Trufflehog has a vendor-specific Supabase detector that queries
  `iss` claim; we don't.
- **env_secret (P for us)**: we flag `FOO_SECRET=...` assignments, but the
  placeholder validator currently inspects the variable name (`match[1]`)
  rather than the value, so `API_KEY=your_key_here` still fires. See
  recommendation R-1 in `report.md`.
- **vercel_token (D)**: pattern is defined in `secret-scanner.ts` but the
  `validate` callback returns `false`, disabling it — a 24-char alnum
  string is too ambiguous (matches MongoDB ObjectIds, build hashes, etc.)
  without contextual anchoring. Competitors either (a) use the Vercel token
  prefix `vfc_` (newer format) — we should too — or (b) rely on entropy
  scoring.

## Categories industry scanners catch that we don't

| Category                | gitleaks | trufflehog | Snyk | Semgrep | Priority for Dear User |
|-------------------------|----------|------------|------|---------|------------------------|
| SendGrid (`SG.`)        | Y        | Y          | Y    | Y       | P1 (email infra common)|
| Mailgun (`key-`)        | Y        | Y          | Y    | Y       | P1                     |
| Twilio (`AC[0-9a-f]{32}`)| Y       | Y          | Y    | Y       | P1                     |
| HuggingFace (`hf_`)     | Y        | Y          | Y    | Y       | P1 (AI tooling)        |
| Cloudflare (`v1.0-...`) | Y        | Y          | Y    | Y       | P1 (PVS standard stack)|
| npm token (`npm_`)      | Y        | Y          | Y    | Y       | P1 (publishing hygiene)|
| PyPI (`pypi-AgE...`)    | Y        | Y          | Y    | Y       | P2                     |
| Azure (multiple)        | Y        | Y          | Y    | Y       | P2                     |
| GCP service account JSON| Y        | Y          | Y    | P       | P2                     |
| Datadog (`DD_API_KEY`)  | Y        | Y          | Y    | Y       | P2                     |
| Discord bot token       | Y        | Y          | Y    | Y       | P3                     |
| Heroku (`[0-9a-f]{8}-`) | P        | Y          | Y    | P       | P3                     |
| DigitalOcean (`dop_v1`) | Y        | Y          | Y    | Y       | P3                     |
| MongoDB connection str  | P        | Y          | P    | P       | P3                     |
| AWS session token       | Y        | Y          | Y    | Y       | P2                     |
| Algolia admin key       | Y        | Y          | Y    | Y       | P3                     |

Priority-assignment rationale (relative to Dear User's target users —
Vibe Coders, Indie Hackers, PVS Venture Studio):
- **P1**: credentials our target audience actually commits into CLAUDE.md /
  `.env` / settings.json on a monthly basis. SendGrid + Resend-era email
  keys, HuggingFace tokens for local model experiments, Cloudflare tokens
  (PVS standard stack), npm publish tokens.
- **P2**: broader enterprise stacks. Matters when Dear User is adopted by
  teams, less common in solo Claude Code sessions.
- **P3**: long tail. Nice to have; low ROI per rule.

## Where we lead

Three detectors where Dear User has unique value vs industry scanners:

1. **`sk-ant-` as first-class category** — several industry scanners still
   lump Anthropic keys under a generic "API key" rule or miss them entirely.
   We treat it as a dedicated category with a distinct `anthropic_key`
   finding type and a negative lookahead in the OpenAI rule to prevent
   double-flagging.
2. **CLAUDE.md-aware scanning surface** — gitleaks/trufflehog scan repo
   files; they have no concept of `~/.claude/` scope or `settings.json`
   MCP-server `env` blocks (where keys are *legitimately* configured but
   should use `${env:VAR}` references, not inline values). Our scanner
   traverses that scope specifically.
3. **OWASP Agentic AI mapping (`ASI-03`)** — we tag every secret finding
   with the Agentic AI Top-10 category (Identity & Privilege Abuse). None
   of the industry secret scanners map to this taxonomy because it's new
   (OWASP 2025) and agent-specific.

## Where we lag (summary)

- ~16 common cloud/SaaS credential shapes uncovered (see table above)
- No entropy fallback for unlabeled high-entropy strings
- No git-history scanning (we read current files only; gitleaks/trufflehog
  walk history)
- `vercel_token` pattern shipped disabled
- `env_secret` placeholder filter inspects wrong capture group
