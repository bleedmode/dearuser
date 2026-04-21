---
name: dearuser:health
description: System health — 0-100 score for om dit setup (skills, hooks, scheduled tasks, MCP servers) stadig hænger sammen, eller er ved at drive fra hinanden. Powered by Dear User.
allowed-tools: "mcp__dearuser__health, mcp__pvs__pvs_task_list, mcp__scheduled-tasks__list_scheduled_tasks, Bash"
---

# Dear User — Health

Kør et strukturelt sundhedstjek med Dear User MCP serveren. Giver en 0-100 score plus kategori-breakdown og fund rangeret efter alvorlighed.

## Trin 1: Kør rapport

1. Prøv at kalde `mcp__dearuser__health` med default parametre (ingen argumenter — global scope, alle fund).
2. **Hvis tool'et ikke er tilgængeligt** (første turn i session — MCP tools loader lazy), brug Bash-fallback:
   ```
   node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs health 2>/dev/null
   ```
3. Output HELE rapporten som dit svar — summér ikke, forkort ikke, tilføj ikke kommentarer i rapport-delen.

Hvis brugeren spørger om en specifik finding-type, send `focus` med relevant værdi (orphan, overlap, closure, substrate, mcp_refs, backup, stale_schedule). Bash: `node /Users/karlomacmini/clawd/dearuser/mcp/run-tool.mjs health '{"focus":"orphan"}' 2>/dev/null`

## Trin 2: Agent-triage (efter verbatim-rapport)

Dashboardet er for mennesket. Denne sektion er for dig (agenten). Tilføj efter rapporten en sektion `## 🔧 Agent-triage` med:

### A. Dedup mod PVS
Kald `mcp__pvs__pvs_task_list` med `tag: "auto-system-sundhed"`. For hvert **critical** finding i rapporten:
- Match på title-substring mod åbne tasks (inbox/blocked).
- ✓ **Allerede queued** → vis task-id, ingen ny handling.
- ✗ **Ikke queued** → foreslå ny task med foreslået title og tags.

### B. Mekanisk diagnose
For hvert `stale_schedule` finding:
- Kald `mcp__scheduled-tasks__list_scheduled_tasks`.
- Hvis task ikke findes i scheduler → "orphaned state, ryd op via /Users/karlomacmini/.claude/scheduled-tasks/&lt;name&gt;/".
- Hvis task findes men har samme `cronExpression` som en anden task → "cron-konflikt med &lt;X&gt;, sandsynligvis superseded".
- Hvis task er manual-only og flagged stale → "false positive, task er manuel — overvej dismiss".

For hvert `orphan_job` finding:
- Nævn 3 valg kort (tilføj consumer / dokumentér / notify-on-fail).

### C. Auto-dismiss kendte mønstre
Flag (men udfør ikke automatisk) findings der er design-expected:
- Overlap mellem `dearuser:*` skills → produktsuite, samme vokabular by design.
- Overlap mellem scheduled task og tilhørende skill (fx `standup`/`morning-standup`) → manuel + auto for samme job.

### D. Beslutnings-prompt
Slut med konkret spørgsmål: *"Vil du have mig til at: (a) åbne X PVS tasks for de ikke-queuede kritiske, (b) dismisse Y kendte false positives via `mcp__dearuser__dismiss_recommendation`, (c) rydde op i Z orphaned schedules, eller en kombination?"*

Vent på svar. Auto-act ikke — det er `dearuser-audit-weekly` scheduled task'ens job.

## Regler

- Rapport-delen: verbatim, ingen commentary.
- Agent-triage: skarp og kort, ingen gentagelse af rapport-indhold.
- Dansk svar hvis brugeren skriver på dansk.
- Hvis rapporten siger score ≥90 og 0 criticals: drop agent-triage, sig "✓ intet at eskalere".
