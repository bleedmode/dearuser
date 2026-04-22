# Superseded

This 50-file calibration study has been superseded by the v2 study with 2,895 files:

**See: [`../2026-04-22-claude-md-corpus-v2/`](../2026-04-22-claude-md-corpus-v2/report.md)**

Kept here for historical reference. Scoring methodology is unchanged; v2 uses the same `mcp/src/engine/scorer.ts` and `mcp/src/engine/lint-checks.ts` with a 57× larger corpus (stratified across 13 size buckets to defeat GitHub's 1,000-per-query search cap).

The v1 calibration verdicts (median 19, ceiling ~32 collab / 42 pure) turned out to be close to correct for the median but under-estimated the ceiling — v2 finds real CLAUDE.md files up to 60 collab / 78 pure. Median is within 1 point between studies.

`wrapped-moments.ts` reads v2 scores by default, falling back to v1 only if v2 data is missing.
