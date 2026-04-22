# Viral loop strategy for Dear User

**Date:** 2026-04-22 · **Status:** research note — not implementation

## TL;DR

Dear User has exactly ONE loop that can go viral: the shareable report at `dearuser.ai/r/<token>`. Everything else is private (dashboard, MCP tool) or indirect (feedback inbox). The strategy is to make that ONE link do more work — not to sprinkle share-prompts across the product.

Three levers, ordered by impact/effort:

1. **Make the OG social card feel like Spotify Wrapped.** A score-only card is forgettable. A card with one huge number + a bold comparison ("top 10% for security") travels. High impact, medium effort.
2. **Add a percentile comparison on every share page.** People share when they feel ranked, not judged. HubSpot Grader's core trick. Low effort — we already have the corpus for baselines. High payoff.
3. **Primary CTA on share pages: "Audit your own setup."** Turns views into installs. Pre-copy the install command via `?clip=1`. Low effort.

## What we will NOT do

- ❌ Referral codes / invite-a-friend. We're free. No incentive to offer.
- ❌ "Share to unlock". Dark pattern, conflicts with the product's trust positioning.
- ❌ Auto-tweet from the tool. Destroys the local-only promise in one click.
- ❌ Leaderboards. Gamifies scores, degrades data honesty.
- ❌ Email invites. We don't have emails. Don't start collecting for this.
- ❌ Embeddable "I scored X" badges in GitHub READMEs. Low actual reach; devs filter badges.
- ❌ Modal share prompts inside the dashboard or terminal. Private surfaces stay private.

## What already works and why

Our share URL (`/r/<token>`) replicates the HubSpot Website Grader pattern (2006→2020s, ~40K organic backlinks from 1M+ audits). The pattern:

> free audit → detailed report → shareable URL → recipient audits their own site → cycle repeats

Key insight from HubSpot: they didn't add share buttons. The URL itself was the share surface, because URLs are the atomic unit of the web. People pasted URLs into Slack, Twitter, docs. The OG card made the URL self-advertising without being clicked.

We already have:
- Stable shareable URL per report (done)
- OpenGraph image generator (done — but generic)
- Token-based access with anonymization (done)
- Feedback link in share-page footer (done — acquisition loop seed)

## The three levers, detailed

### Lever 1 — Spotify-Wrapped-style OG card

**Now:** 1200×630 PNG, project name + score. Forgettable.

**Target:**
- **Hero number:** score at 140-180pt, center, impossible to miss
- **One emotional supporting fact:** "Top 10% for security" or "Found 3 leaked keys" — generated at share-time from the report
- **Brand palette:** terracotta + ink + paper (already in tokens). Instantly recognizable across feeds.
- **Footer CTA:** small "Audit yours at dearuser.ai" — present but secondary

Effort: one file (`web/src/pages/r/[token]/opengraph-image.png.ts`). The design iteration is the real work — 3-4 visual variants, A/B informally after launch.

Measure: `share_viewed` PostHog event + Vercel referrer analytics. Watch Twitter/LinkedIn referrer share.

### Lever 2 — Percentile ribbon on share page

**Now:** share page shows the same report owner sees. No context.

**Target:** small ribbon near the score: "Top X% of public Claude Code setups".

Baseline: we have 2,895-file corpus scores from the v2 calibration study. Median 18/100 for public CLAUDE.md files. A user scoring 45/100 is top ~2%. That's shareable; 45/100 alone is not.

Effort: low. Compute percentile at share-creation (pass `score` through a lookup against `scores.jsonl`), store in `du_shared_reports.percentile`, render on page.

### Lever 3 — "Audit your own" CTA on share page

**Now:** small "Audit your own — dearuser.ai" link in footer.

**Target:** primary button mid-page. Click → landing with install command pre-copied via `?clip=1` query param.

Effort: very low. Button + landing param handler. Completes the HubSpot loop by converting passive viewers into active installs.

## After-launch measurement

Via PostHog (cookieless, already set up):

- `share_created` / `share_viewed` → virality coefficient k
- Vercel referrer analytics → which channels seed the loop
- Target month 1: k > 1 healthy, k > 2 excellent, k < 1 means lossy loop — fix levers 2 + 3 hard

## Do not block launch

Ship as-is for Show HN. Iterate the share page after real traffic lands. Lever 2 and Lever 3 are <1 day each and can roll as Week 2 improvements. Lever 1 is a Week 3-4 design investment.
