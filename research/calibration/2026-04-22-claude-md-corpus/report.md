# Scoring Calibration Study — 50 Public CLAUDE.md Files

**Date:** 2026-04-22
**Corpus:** 50 public GitHub repositories with a CLAUDE.md file, fetched via `gh search code "filename:CLAUDE.md"`. Sampled across three star buckets: 13 high (>=100 stars, 15 slots), 7 medium (10-99 stars, 15 slots), 30+ low (<10 stars, 20 slots). See `data/manifest.json` for full list.
**Method:** Every file scored with the collaboration scorer (`mcp/src/engine/scorer.ts`) and all 51 lint checks (`mcp/src/engine/lint-checks.ts`). Substrate — memory files, hooks, skills, scheduled tasks, MCP servers — mocked as empty, so this study isolates the **CLAUDE.md signal only**.

---

## TL;DR (dansk)

- **Score-fordelingen er kalibreret korrekt — men skalaen virker asymmetrisk.** Ingen offentlig CLAUDE.md vi scannede scorer over 32. Median 19. Det er ikke en bug — det er virkeligheden: de fleste CLAUDE.md filer i open source er projekt-docs for mennesker, ikke agent-kontrakter. Ingen af dem definerer roller (`roleClarity` median = 0), ingen har intentional autonomy, 98% har ingen `north_star`. Vores scorer siger korrekt: "du har meget at hente".
- **Systematisk undervurdering når substrate ikke kan læses.** Collab-scoren blandes med 3 kategorier (memoryHealth/systemMaturity/qualityStandards) der afhænger af hooks/memory/skills — hvis Dear User ikke kan scanne dem (corpus, CI, sandbox, ingen `~/.claude/`), straffer de scoren. Ren-CLAUDE.md subscoren er +6 point højere i median. **Anbefaling:** rapport bør vise "CLAUDE.md sub-score" separat, og kun vise global collab-score når hele substraten rent faktisk er scannet.
- **To lint-checks overfire på tværs af corpus og bør justeres:** `dead_command_ref` (39 hits) tjekker filsystem-eksistens og kan aldrig virke for eksterne repos — ikke en bug for lokal brug, men gør calibration-test støjende. `empty_section` (77 hits) fanger standard `## Project Overview` + table of contents-mønstre der ikke er fejl. Sænk `empty_section` severity til noise og suppress for korte sections (<5 linjer).

---

## English detail

### 1. Distribution

#### Full collaboration score (weighted 7-category aggregate)

| | |
|-|-|
| Range | 7-32 |
| Mean | 19 |
| Median | 19 |
| p10 / p25 / p75 / p90 | 7 / 16 / 24 / 26 |

ASCII histogram (bucket width 10):

```
  0-9 | ########                          8
 10-19| #################               17
 20-29| ########################        24
 30-39| #                                1
 40-49| 0
 50-59| 0
 60-69| 0
 70-79| 0
 80-89| 0
 90-100 0
```

#### CLAUDE.md-only sub-score (renormalized 4 pure categories)

| | |
|-|-|
| Range | 11-42 |
| Mean | 25 |
| Median | 24 |
| p10 / p25 / p75 / p90 | 11 / 18 / 31 / 36 |

Same histogram:

```
  0-9 | 0
 10-19| #############                   13
 20-29| ######################          22
 30-39| ############                    12
 40-49| ###                              3
 50-59| 0
```

**Calibration verdict:** the shape is unimodal, roughly bell-centered, no clustering at 0 or 100. That's healthy for a scoring system — everyone has room to grow, no one is "perfect", and the floor isn't arbitrary. **But:** the ceiling of 42 on CLAUDE.md-only, and 32 on the blended score, is too compressed for a production product UI to feel fair. See recommendations below.

---

### 2. Category breakdown — where the corpus loses points

| Category | Mean | Median | Max | Notes |
|---|---|---|---|---|
| roleClarity | 6 | 0 | 40 | Corpus is very weak here — only 1/50 files has a recognized "roles" section. Real, not noise. |
| communication | 23 | 20 | 100 | Widest spread, best discrimination. |
| autonomyBalance | 36 | 35 | 55 | Compressed distribution — investigate. |
| qualityStandards | 29 | 33 | 67 | Partially depends on `hooksCount` (mocked to 0) -> systematic under-scoring. |
| memoryHealth | 2 | 0 | 25 | Depends entirely on memory files (mocked empty). N/A on this corpus. |
| systemMaturity | 5 | 5 | 5 | Depends on artifact counts (mocked 0). N/A on this corpus. |
| coverage | 32 | 40 | 70 | Canonical-section count. Signal is strong. |

**Section-presence across corpus (of 50 files, canonical sections; counts >50 because some files have multiple matches):**
```
commands      : 87
workflow      : 78
architecture  : 59
quality       : 30
tech_stack    : 23
communication : 19
learnings     : 11
north_star    :  2
roles         :  1
autonomy      :  0
```

This is the real story: **public CLAUDE.md files are repo-onboarding docs, not human<->agent contracts.** They tell an agent the build commands and the directory layout. They almost never tell it who's driving, what tone to use, or what to do without asking. Our coverage check correctly flags this.

---

### 3. Outliers

#### Lowest 5 (collab)
| Repo | Collab | Pure | Size | Stars | Why |
|---|---|---|---|---|---|
| gobii-ai/gobii-platform | 7 | 11 | 65B | 409 | Single line: "Please read and strictly follow the rules defined in ./AGENTS.md". Redirect file — content is elsewhere. |
| ACComputing/UniversalJailbreakDB20XX | 7 | 11 | 1017B | 144 | Adversarial content (jailbreak DB), not a real config. |
| orangishcat/page-proxy | 7 | 11 | 32B | 4 | AGENTS.md redirect. |
| AgoraIO-Conversational-AI/agent-samples | 7 | 11 | 172B | 4 | Trivial stub. |
| Hisn00w/LangChain-Chinese | 7 | 11 | 145B | 1 | Trivial stub. |

**False-negative check:** None. These files deserve low scores — they have no real agent guidance, except that **2 of the 5 are legitimate AGENTS.md redirects**, which Dear User currently does not recognize (detection exists via `competingFormats.agentsMd` in the scanner, but it's not factored into scoring). See recommendation R2.

#### Highest 5 (collab) / Highest 5 (pure)
| Repo | Collab | Pure | Size | Stars | Notes |
|---|---|---|---|---|---|
| arunperiyal/arunperiyal.github.io | 32 | 36 | 8.8KB | 1 | Well-structured personal site config with commands, workflow, style. |
| omargawdat/Gawdat_Django_Template | 29 | 42 | 9.5KB | 16 | Django template with code style, examples, constraints. |
| henrique-simoes/Istara | 29 | 42 | 8.9KB | 5 | Sophisticated: "Compass doctrine", memory management, planning gates. **This is the exemplar** — highest pure score, real agent contract. |
| davidrd123/bildung-2.0 | 28 | 36 | 167KB | 2 | Huge file, score probably limited by missing roles + north_star. |
| kogriv/bquant | 27 | 38 | 6KB | 1 | Balanced rules + workflow. |

**False-positive check on high-scorers:** all 5 genuinely deserve to be in the top tier. They have actual rule taxonomies, constraints, memory instructions, and planning protocols. `henrique-simoes/Istara` in particular shows the scorer working — it has memory + planning + validation + identity + constraints all covered (cognitive_blueprint 5/6), so it hits the 42 ceiling of pure score.

---

### 4. Lint false-positive / false-negative spot-checks

Total lint findings: **557** (1 critical, 176 recommended, 380 nice-to-have). Mean 11 per file.

**Top checks firing across the corpus:**
| Check | Count | Calibrated? |
|---|---|---|
| empty_section | 77 | Overfires. Catches `## Project Overview` followed by one line of content and any common TOC-style empty heading. Severity `nice_to_have` is right; consider suppressing for `overview`/`getting-started` sections where 1-line content is conventional. |
| section_balance | 71 | Real signal — files that are 100% prohibitions or 100% do-rules. |
| dead_command_ref | 39 | **Noisy on foreign filesystems.** Checks `existsSync(cmd)` — cannot work for corpus / CI / sandbox without the user's actual files. For lived-in use this is valid; for synthetic runs it produces unactionable findings. **No change needed for product**, but document this behavior. |
| negative_only | 38 | Real signal. |
| escape_hatch_missing | 38 | Real signal. |
| missing_rationale | 35 | Real signal. |
| broken_markdown_link | 34 | Real signal. |
| cognitive_blueprint_gap | 32 | Real signal — corpus is genuinely incomplete. |
| missing_update_date | 30 | Real signal. |
| priority_signal_missing | 27 | Real signal. |
| buried_critical_rule | 23 | Real signal. |
| missing_handoff_protocol | 19 | Real signal. |
| naked_conditional | 18 | Real signal. |
| ambiguous_rule | 18 | Real signal. |
| weak_imperative | 16 | Real signal. |

**Random sample of 10 lint lines (manual FP check):** reviewed by reading flagged excerpts in `data/raw/042_arunperiyal__...md`, `018_omargawdat__...md`, `025_henrique-simoes__Istara.md`. None of the sampled 10 were clear false positives — all would be reasonable polish suggestions to a human author. `dead_command_ref` false positives in this corpus are filesystem artifacts, not classification errors.

**Critical finding firing:** only 1 across 50 files — that's healthy. Critical must mean critical.

---

### 5. Recommendations

**Non-blocking for launch; these are calibration tunings.**

**R1. Show a separate "CLAUDE.md sub-score" in the report when substrate is empty or partial.**
The blended collaboration score pulls in memoryHealth (weight 15%), systemMaturity (15%), and hooks-dependent parts of qualityStandards. When any of those are empty, the blended score is deceptively low even for a great CLAUDE.md. We already showed this: median pure sub-score is +6 points higher than median blended. A user who just installed Dear User and hasn't set up memory files yet will see an unfairly low collab score. Suggestion: report header shows collab score, but surface the 4-category pure subscore as a second number when `memoryFiles.length === 0 && hooksCount === 0 && skillsCount === 0`.

**R2. Recognize AGENTS.md redirect files and score them against AGENTS.md content.**
Two of the lowest-5 are legitimate Linux Foundation AGENTS.md redirects (`page-proxy`, `gobii-platform`). The scanner already detects `competingFormats.agentsMd` but doesn't follow the reference. If a CLAUDE.md is <500 bytes and contains a reference to AGENTS.md, read AGENTS.md and score that instead. Users following the cross-tool standard shouldn't be penalized. (See memory: `project_agents_md_standard.md`.)

**R3. Investigate `autonomyBalance` compression.**
Distribution is 30-55 with everyone clustered at 30-40. The base score is 30 (cold start) + 25 (has do and ask rules) + 20 (healthy prohibition ratio) + 5 (concrete rules) = could theoretically reach 80, but something in the corpus consistently hits only ~35. Most likely: the corpus has `prohibitionRatio` outside the 0.15-0.35 band (typically too low or too high), and also rarely hits `hasAllTiers = true` because 0 files have `suggest_only` rules flagged. That's accurate, but the category deserves a wider distribution for a useful signal. Consider: reward "1 ask + 1 prohibition + 3 do-rules" as a starter pattern rather than requiring 3 tiers.

**R4. Lower `empty_section` severity or suppress for convention sections.**
77 occurrences, all `nice_to_have`. Not a scoring problem, but it adds report noise. Suppress when section title matches `/^(overview|introduction|getting started|project overview|table of contents)$/i` and body has >=1 non-whitespace line.

**R5. Document that `dead_command_ref` requires local filesystem access.**
Not a bug — but worth noting in the check's description. A CLAUDE.md author can't avoid this finding on someone else's machine, which isn't the intent.

**R6. Consider a "CLAUDE.md grade" for launch UX.**
Given the median is 19 and the max across 50 production files is 32, a 0-100 score feels punishing even when it's accurate. Alternative: grade A/B/C/D/F mapped to percentiles of this corpus (or a larger one), so a score of 32 lands as "top 2%" instead of "32%". Keep the raw number for power users, show the grade upfront. This is a product decision, not a scoring change.

**R7. No thresholds need to move for launch.**
The scorer is functioning correctly. The low numbers reflect a real gap in the ecosystem — most CLAUDE.md files are repo docs, not agent contracts. Dear User's value proposition ("turn your repo doc into a proper agent contract") is validated by this data, not undermined by it.

---

### 6. Known limitations of this study

- **Substrate is mocked empty.** Categories that depend on the user's `~/.claude/` state (memoryHealth, systemMaturity) are zero by construction. Their means in this study are *not* representative of real Dear User scans on an active setup. We report them only to show that the blended collaboration score is what users see, and it's depressed by ~6 points whenever substrate is missing.
- **Security scorer not run.** Security depends on platform advisors (Supabase/GitHub/npm/Vercel) and local secret scanning. None of those signals exist for synthetic corpus files. Security calibration would need a different methodology (e.g. planted-secret detection rate on test fixtures).
- **System-health scorer not run.** Same reason — needs a real artifact graph.
- **Corpus bias.** `gh search code` ranks by relevance, not representativeness. The real distribution of CLAUDE.md quality might skew even lower (long tail of stub files) or higher (power-user repos not surfaced in top 150).
- **No session-signal adjustment.** The scorer can lower scores when it sees correction patterns in recent sessions; we didn't simulate that. In practice it's a small factor.

---

### 7. Files in this study

- `fetch.ts` / `fetch.mjs` — GitHub corpus collector
- `score-corpus.ts` / `score-corpus.mjs` — runs scorer + linter over each file
- `data/manifest.json` — repo list with stars, description, language, size
- `data/raw/*.md` — the 50 CLAUDE.md files as fetched
- `data/scores.jsonl` — per-file scoring output (1 row per file)
- `data/summary.json` — aggregate statistics
