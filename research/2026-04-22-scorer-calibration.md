# Scorer calibration harness — baseline + findings

Date: 2026-04-22
Author: Claude (for Jarl)
Scope: End-to-end validation of the three Dear User scorers (collab, health, security) against synthetic `~/.claude/` setups.
Related PVS tasks: `e254608b` (collab 6pt bug), `3cd990c1` (health validation), `8d949415` (security validation).

## Motivation

Three pre-launch validation tasks in the PVS inbox all share the same shape: "does our scorer give the right number on realistic inputs?" One harness covers all three.

## What I built

`mcp/calibration/` — fixture bank + harness:

- Four fixtures (`empty`, `starter`, `mature`, `messy`) representing canonical `~/.claude/` setups
- `run-single.ts` — runs scan → parse → score pipeline against the fixture pointed to by `$HOME`
- `run.mjs` — spawns `run-single.js` per fixture with `HOME` overridden; compares observed scores to expected bands; exits non-zero if any fixture drifts
- `expected.json` — ground truth bands + observed baselines captured 2026-04-22

## Observed baselines (2026-04-22)

| Fixture | collab.blended | collab.subScore | health | security | substrateEmpty | intentionalAutonomy |
|---------|----------------|-----------------|--------|----------|----------------|---------------------|
| empty   | 12             | 20              | 100    | 100      | true           | false               |
| starter | 53             | 76              | 100    | 100      | true           | true                |
| mature  | 81             | 82              | 96     | 100      | false          | true                |
| messy   | 22             | 15              | 96     | 67       | false          | false               |

## Finding 1 — The "6pt bug" is actually a ~23pt substrate penalty

Task `e254608b` describes a ~6pt depression when substrate is empty. The `starter` fixture (well-written CLAUDE.md with intentional autonomy + three-tier rules, zero substrate) shows **blended=53 vs subScore=76 — a 23pt gap**.

R1's `claudeMdSubScore` was introduced to surface the non-substrate sub-score alongside the blended number so empty-substrate users see a non-penalised reading. The harness confirms:

- R1 path fires correctly (substrateEmpty=true, subScore returned)
- R3 meaningful-balance bonus fires (autonomyBalance=90 on starter vs 30 baseline)
- The gap is larger than the original "6pt" claim once a CLAUDE.md is actually well-written

**Open question for Jarl**: is a 23pt substrate penalty honest (substrate matters for real collaboration) or harsh (demoralises first-time users)? Current stance: honest, provided the UI shows the sub-score when substrateEmpty=true. **Action**: verify dashboard renders both numbers; file a task if it doesn't.

## Finding 2 — Security aggregate is softer than intuition

The `messy` fixture plants 3 critical secrets + 2 critical injection surfaces + 1 critical rule conflict. Observed security score: **67**. Intuition said "<60".

Breakdown: `secretSafety` goes to 0 (3 criticals × 30pt penalty = 90 → clamped). But `injectionResistance`, `ruleIntegrity`, `dependencySafety`, and `platformCompliance` all remain 40-100, so the weighted average rescues the score.

**Decision point**: is 67 "bad enough" to signal risk to a user? Options:
- Accept 67 — the breakdown makes it clear where the damage is
- Lower the floor — add a rule that any critical in `secretSafety` caps `securityScore` at e.g. 50
- Reweight — `secretSafety` currently 0.30; bumping to 0.40 would push 67 → ~60

I'd leave as-is pre-launch and revisit after user feedback. Flag it in the task close-out.

## Finding 3 — Health fixture coverage is narrow

`messy` only triggers 3 of 8 possible audit-detector types: `overlap`, `missing_closure`, `unbacked_up_substrate`. Health score stays at 96 despite obvious problems.

Not triggered: `orphan_job`, `substrate_mismatch`, `unregistered_mcp_tool`, `stale_schedule`, `expected_job_missing`. These require specific fixture shapes (scheduled-task registered in `scheduler.tasks.json`, memory file with DB-like schema, MCP reference to unregistered server, etc.).

**Action**: expand `messy` fixture in a follow-up session to cover all 8 detector types before declaring health scorer validated.

## Finding 4 — Snyk/Semgrep/CodeQL comparison is out-of-scope for this harness

Task `8d949415` asks for Snyk/Semgrep/CodeQL comparison. These tools scan **source code** (npm deps, TypeScript patterns, dataflow). Dear User scans **agent config** (CLAUDE.md, hooks, skills, memory). The surfaces are orthogonal.

Valid comparison pattern:
1. Run all four against the same repo
2. Snyk → dependency CVEs; Semgrep → source-code patterns; CodeQL → dataflow; Dear User → agent-config rule/secret/injection detectors
3. Document non-overlap (expected) + overlap (if any)
4. Establish: Dear User is NOT a source-code scanner; we're a different surface

Requires: Snyk account, Semgrep install, CodeQL in GitHub Actions. **Parked — needs separate session with infrastructure setup.**

## What this does / doesn't close

### Closes

- `e254608b` (collab 6pt bug) — scorer behaviour is confirmed correct; the "bug" is a feature (substrate matters). Mitigation (R1 sub-score) is in place and verified. Remaining work: verify UI surfaces sub-score when `substrateEmpty=true`.

### Partially closes

- `3cd990c1` (health validation) — harness + 3-of-8 detector coverage. Needs fixture expansion to close.

### Parks

- `8d949415` (security Snyk/Semgrep/CodeQL) — harness verifies our own detectors fire; external-tool comparison is a separate workstream.

## Next iteration

1. Verify dashboard shows `claudeMdSubScore` when `substrateEmpty=true` — if not, file UI bug.
2. Expand `messy` fixture: add `orphan_job`, `substrate_mismatch`, `unregistered_mcp_tool`, `stale_schedule`, `expected_job_missing` cases.
3. Stand up Snyk/Semgrep/CodeQL scans against Dear User's own source; document scope matrix.
4. Consider: should `securityScore` have a critical-caps-at-N floor? (Finding 2.)
