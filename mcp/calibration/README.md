# Dear User calibration harness

End-to-end validation of the three Dear User scorers (collab, health, security) against synthetic `~/.claude/` setups. Complements unit tests in `src/engine/*.test.ts` — those validate scorer internals with mocked inputs; this runs the full scan → parse → score pipeline against real filesystem fixtures.

## Why

Three pre-launch validation tasks in the PVS inbox all share the same shape: "does our scorer give the right number on realistic inputs?"

- Collab scorer — calibration study: verify R1 sub-score + R3 meaningful-balance bonus
- Health scorer — validation against real Claude Code setups
- Security scorer — pre-launch comparison to Snyk/Semgrep/CodeQL

Rather than three separate harnesses, one fixture bank covers all three.

## Run

```bash
node calibration/build.mjs    # bundle run-single.ts → dist/run-single.js
node calibration/run.mjs      # spawn run-single.js per fixture with HOME=fixture-dir
```

Exit code 0 = all bands green, non-zero = one or more fixtures outside expected bands.

Options:
- `--json` — emit full JSON instead of the human summary
- `--fixture <name>` — run a single fixture only

## Fixtures

Each fixture is a directory containing a `.claude/` subdir that emulates a user's home `~/.claude/` setup. The harness spawns `run-single.js` with `HOME` overridden, so the scanner's `homedir()` calls resolve to the fixture.

| Fixture | What it emulates | Primary scorer tested |
|---------|-----------------|-----------------------|
| `empty` | Fresh install — minimal CLAUDE.md, no substrate | collab R1 path |
| `starter` | Well-written CLAUDE.md (do/ask/prohibit + intentional autonomy), empty substrate — the actual "6pt bug" scenario | collab R1 + R3 |
| `mature` | Full setup (hooks, skills, scheduled-task, commands, 3 memory files) | convergence check |
| `messy` | Leaked secrets, unsafe rm -rf hook, force-push rule conflict, overlapping orphan skills, phantom MCP caller, stale scheduled task, expected-but-missing job, substrate_mismatch memory file | all 8 health detectors + secrets + injection + rule-conflict |

## Ground truth

`expected.json` defines bands (`min`, `max`) per fixture per dimension. Bands are deliberately wide (~15pt) — we're validating direction, not pixel-perfect matching. The `observed_baseline_2026_04_22` field on each fixture records the first successful run.

## Known gaps (for next iteration)

- **No Snyk/Semgrep/CodeQL comparison.** Parked for follow-up: requires installing those scanners, scoping the comparison (Dear User scans agent config; those scan source code — different surfaces), and documenting overlap/gap matrix.
- **Middle-substrate fixtures missing.** Only zero-substrate and full-substrate tested — the "partial substrate" case where score inflection might happen isn't covered.
