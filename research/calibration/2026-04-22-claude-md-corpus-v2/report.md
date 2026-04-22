# Scoring Calibration Study v2 — 2,895 Public CLAUDE.md Files

**Date:** 2026-04-22
**Corpus:** 2,895 unique public CLAUDE.md files from GitHub (deduped by content hash). Collected via `gh search code filename:CLAUDE.md` stratified across 13 size buckets to defeat GitHub's 1,000-results-per-query cap.
**Method:** Every file scored with the collaboration scorer (`mcp/src/engine/scorer.ts`) and all lint checks (`mcp/src/engine/lint-checks.ts`). Substrate — memory files, hooks, skills, scheduled tasks, MCP servers — mocked as empty, so this study isolates the CLAUDE.md signal only, same as v1.
**Supersedes:** `research/calibration/2026-04-22-claude-md-corpus/` (v1, 50 files). Methodology is identical — scoring code is the same, we just scaled the input 57x.

---

## TL;DR (dansk)

- **Fordelingen holder ved 58x flere filer.** Median collab = 18 (v1 var 19). Mean 19.5. Stdev 10.9. Konklusionen fra v1 gælder stadig: offentlige CLAUDE.md er projekt-docs for mennesker, ikke agent-kontrakter.
- **Max score steg fra 32 til 60 (collab) og 42 til 78 (pure).** Med 58x større n fandt vi bedre toppe — men det bekræfter kun at skalaen har plads til fornuftig bredde.
- **Star-tier har intet signal.** 1000+ stars repos har median=19, 0-stars repos har median=18. CLAUDE.md-kvalitet korrelerer ikke med repo-popularitet.
- **Størrelse har stærkt signal.** <1KB → median 8. 20KB+ → median 29.

---

## English detail

### 1. Distribution — collab score

| | v1 (n=50) | v2 (n=2,895) |
|---|---|---|
| min | 7 | 3 |
| max | 32 | 60 |
| mean | 19 | 19.5 |
| stdev | — | 10.9 |
| p10 | 7 | 7 |
| p25 | 16 | 9 |
| median | 19 | 18 |
| p75 | 24 | 27 |
| p90 | 26 | 35 |
| p95 | — | 39 |
| p99 | — | 47 |

Histogram (collab, bucket width 10):
```
  0-9 | ########################                    762
 10-19| ##########################                  838
 20-29| ######################                      707
 30-39| ##############                              444
 40-49| ####                                        129
 50-59|                                              14
 60-69|                                               1
 70-79+                                               0
```

### 2. Distribution — pure score (CLAUDE.md-only, renormalized)

| | v1 | v2 |
|---|---|---|
| min | 11 | 4 |
| max | 42 | 78 |
| mean | 25 | 24.7 |
| median | 24 | 22 |
| p90 | 36 | 44 |
| p99 | — | 62 |

**Calibration verdict:** Shape is unimodal, left-skewed, no clustering at 0 or 100. Only 15 of 2,895 files scored 50+ collab and only 2 scored 70+ pure. The ceiling isn't a bug — it's the ecosystem.

### 3. Category breakdown (all 2,895 files, mean)

| Category | v1 | v2 | Notes |
|---|---|---|---|
| roleClarity | 6 | 8 | <5% of files have a recognized roles section. |
| communication | 23 | 23 | Widest spread, best discrimination. |
| autonomyBalance | 36 | 36 | Compressed. |
| qualityStandards | 29 | 31 | Depends on hooksCount (mocked 0). |
| memoryHealth | 2 | 3 | Depends on memory files (mocked empty). |
| systemMaturity | 5 | 5 | Depends on artifact counts (mocked 0). |
| coverage | 32 | 29 | Strong signal. |

### 4. By stars

| Bucket | n | median | mean | max |
|---|---|---|---|---|
| 0 | 1,749 | 18 | 19.6 | 55 |
| 1-9 | 728 | 17 | 19.2 | 60 |
| 10-99 | 256 | 16 | 19.1 | 50 |
| 100-999 | 109 | 17 | 19.5 | 45 |
| 1000+ | 53 | 19 | 20.4 | 46 |

**Finding:** star tier is NOT a signal of CLAUDE.md quality. Median differs by at most 3 points across the full star range.

### 5. By file size

| Bucket | n | median | mean | max |
|---|---|---|---|---|
| <1KB | 969 | 8 | 8.8 | 24 |
| 1-5KB | 459 | 16 | 16.5 | 35 |
| 5-20KB | 396 | 21 | 22.1 | 44 |
| 20KB+ | 1,071 | 29 | 29.5 | 60 |

**Finding:** Strong monotonic relationship. Tiny stubs can't score high — there's nothing to score.

### 6. By primary language (top 8)

| Lang | n | median | max |
|---|---|---|---|
| TypeScript | 787 | 19 | 60 |
| Python | 632 | 20 | 53 |
| JavaScript | 219 | 18 | 48 |
| Rust | 143 | 17 | 50 |
| HTML | 144 | 16 | 46 |
| Go | 121 | 20 | 46 |
| Shell | 119 | 11 | 49 |
| Java | 55 | 20 | 45 |

No major language skew.

### 7. Redirects + empty files

- **165 redirect-style files** (contain AGENTS.md reference, <500 bytes) — 5.7% of corpus.
- **19 effectively empty files** (<20 chars after trim) — 0.7%.
- Counted but correctly scored low. v1's R2 (follow AGENTS.md redirects at scanner layer) still applicable.

### 8. Top 5 (highest collab)

| Repo | Collab | Pure | Size | Stars |
|---|---|---|---|---|
| zwaetschge/plum-code-webui | 60 | 78 | 138KB | 9 |
| dlowenth/claude-code-build-framework | 58 | 75 | 153KB | 5 |
| diaghi13/dggm | 55 | 69 | 128KB | 0 |
| jtraveler/project-4 | 53 | 69 | 103KB | 0 |
| maxart/Rails-with-AI | 52 | 67 | 40KB | 1 |

4 of 5 have <10 stars — confirms stars are uncorrelated with CLAUDE.md quality.

### 9. Lint findings

Total: **43,696** (562 critical, 14,086 recommended, 29,048 nice_to_have). Mean **15 per file** (v1: 11).

Top 10 checks:
| Check | Count | /file |
|---|---|---|
| empty_section | 9,755 | 3.4 |
| dead_command_ref | 3,595 | 1.2 |
| section_balance | 3,178 | 1.1 |
| negative_only | 2,460 | 0.85 |
| duplicate_rule | 2,333 | 0.81 |
| priority_signal_missing | 2,168 | 0.75 |
| escape_hatch_missing | 2,162 | 0.75 |
| ambiguous_rule | 2,032 | 0.70 |
| cognitive_blueprint_gap | 1,907 | 0.66 |
| weak_imperative | 1,714 | 0.59 |

Confirms v1: empty_section overfires (3.4x per file). dead_command_ref noisy for synthetic corpora since path lookup can't succeed.

### 10. Comparison: v1 vs v2

| Metric | v1 | v2 | Delta |
|---|---|---|---|
| Mean collab | 19 | 19.5 | +0.5 |
| Median collab | 19 | 18 | -1 |
| p90 collab | 26 | 35 | +9 |
| Max collab | 32 | 60 | +28 |
| Mean pure | 25 | 24.7 | -0.3 |
| Median pure | 24 | 22 | -2 |

Median within 1 point of v1 — small-corpus calibration was accurate. Upper-tail moves reflect v1 not reaching outlier regime with only 50 samples.

### 11. Method limitations

1. **Stratified sampling bias.** 13 size buckets queried. Secondary-abuse-detection forced smaller --limit 100 windows for some buckets. Per-bucket counts in data/manifest.jsonl.
2. **Content-hash dedup catches forks.** 3,072 hits → 2,895 unique. 177 (6%) were identical across multiple repos.
3. **Substrate mocked empty.** Same as v1. Blended collab under-reports by ~6 points for real setups with memory/hooks/skills.
4. **No security / system-health / archetype scoring.** Need substrate.
5. **Language = repo primary language**, not CLAUDE.md language.
6. **GitHub search ranks by relevance, not representativeness.**

### 12. Recommendations (unchanged from v1 — validated at scale)

All v1 recommendations still apply:
- **R1** (show CLAUDE.md pure sub-score when substrate empty) — blended collab under-reports by ~6 points.
- **R2** (recognize AGENTS.md redirects) — 165 files, 5.7% of corpus. Not an edge case.
- **R4** (lower empty_section severity) — 9,755 hits. Loudest check, still mostly noise.

### 13. What constrained us below the "1000+ files" ask

**Nothing — we exceeded it by 2.9x.**

Brief targeted 1,000 files. Actual: **2,895 files.** Collection was gated by:
- GitHub code-search's 1,000/query hard cap (mitigated by 13-bucket size stratification).
- Secondary abuse detection, triggered mid-way through bucket 1 and forced smaller batches for remaining buckets.
- 5,000/hr core REST budget (mitigated by switching to GraphQL batches of 30 repos per query, ~30x fewer calls).

Total: ~1 hour wall-clock end-to-end including scoring.

### 14. Files in this study

- `fetch.ts` / `fetch.mjs` — GitHub corpus collector (stratified by size, GraphQL batching)
- `fill-middle.mjs` — one-off supplementary fetch for middle-size buckets
- `score-corpus.ts` / `score-corpus.mjs` — runs scorer + linter over each file
- `data/candidates.jsonl` — raw search hits (3,072 repos)
- `data/metadata.jsonl` — repo metadata (stars, description, language)
- `data/manifest.jsonl` — 2,895 files successfully fetched with content hash
- `data/raw/*.md` — the CLAUDE.md files as fetched
- `data/scores.jsonl` — per-file scoring output
- `data/summary.json` — aggregate statistics incl. breakdowns
