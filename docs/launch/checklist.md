# Launch checklist — Dear User

## Status 2026-04-22

### Shipped and live
- [x] Share-render at `dearuser.ai/r/<token>` with anonymization + OG card
- [x] Feedback channel: MCP tool + dashboard modal + `/feedback` page + Supabase `du_feedback` inbox
- [x] Semantic rule conflict detector (local-only heuristic, no LLM)
- [x] Credential/secrets scanner — 12 categories
- [x] Score calibration: 988 public Claude Code setups with substrate + 2,895 standalone CLAUDE.md files (two studies)
- [x] Landing page revision — share + secrets highlighted, install button with analytics hook
- [x] README, docs/install.md, docs/privacy.md, CONTRIBUTING.md
- [x] Vercel Analytics + PostHog EU (cookieless — `persistence: 'memory'`)
- [x] Privacy notice in site footer
- [x] First-run welcome + permanent footer in all tool outputs
- [x] Own Supabase project `dearuser` (ref `vrjohzzvncfbrzzceuik`) for public layer only

### Blocked on Jarl
- [ ] `npm publish --access public` from `mcp/` — requires `npm login` once (PVS task `775bf3c7`)
- [ ] Save npm token to 1Password Bobby vault so future bumps can be automated
- [ ] Save PostHog project ID + token to 1Password (done: "PostHog Dear User")

### Recommended before posting
- [ ] Run `dearuser collab` + `security` + `health` against `~/.claude/` one last time — check outputs read cleanly with new footer + welcome
- [ ] Load `dearuser.ai` in a fresh browser, confirm PostHog events fire (check PostHog live events feed)
- [ ] Load `dearuser.ai/r/abc123` → confirm friendly 404
- [ ] Submit a test feedback via MCP tool → confirm arrives in Supabase `du_feedback` table
- [ ] Generate a share link via `share_report` → confirm renders + OG card

### Launch day (Fase 4)
- [ ] Post Show HN on a Tuesday/Wednesday US morning (draft in `show-hn.md`)
- [ ] Twitter/X thread 2-3 hours after HN (draft in `social.md`)
- [ ] LinkedIn day 2
- [ ] Reddit day 2-3 (draft in `social.md`)
- [ ] Monitor feedback table in real time first 48h — respond within 1h window during waking hours

### Post-launch Fase 5 (after 100+ installs)
- [ ] Scoring recommendations R1-R6 from calibration study (PVS task `e254608b`)
- [ ] Archetype system (task `8396a072`)
- [ ] Wrapped viral design (task `44d54af3`)
- [ ] Over-specification lint detector (task `5d6dff0f`)
- [ ] Three-layer health contract for `dearuser-security-daily` (task `4f3ab668`)
- [ ] Mobile app analytics when SafeDish / Rock Identifier launch (PostHog iOS/Android SDK — unified stack)
- [ ] Security-score validation vs Snyk/Semgrep (task `8d949415`)
- [ ] Health-score validation vs real Claude Code sessions (task `3cd990c1`)

### Don't do pre-launch
- Consent banner — we're cookieless, doesn't apply
- Session replay — we disabled it, keep it that way
- Upgrade to PostHog Scale — free tier handles far more than we'll see in first month
- Promotional tweets begging for upvotes — HN kills threads that smell of astroturf

## Known gaps worth calling out honestly

- Zero users at launch. First-week feedback will be noisy and shallow — don't over-fit.
- No revenue model. Fine for now. Don't get pulled into pricing debates prematurely.
- No team/collaboration features. `share_report` is the only social surface. That's deliberate: V1 is about the solo developer.
- Dashboard analytics are intentionally absent. If someone asks "how many scans do I run?", answer: "you can see it in your local SQLite, not in a cloud dashboard. On purpose."
