# Dear User (@poisedhq/dearuser-mcp)

## Hvad er det
Open source MCP server der hjælper mennesker og AI-agenter med at forstå hinanden bedre. Analyserer samarbejdet, identificerer problemer, leverer konkret kode/config — ikke råd.

## Navn
- **Dear User** = produktnavn (brand)
- **Dear User Collab** = collaboration-analyse (mcp__dearuser__collab)
- **Dear User Health** = system-sundhed (mcp__dearuser__health)
- **Dear User Wrapped** = viral feature / shareable stats (mcp__dearuser__wrapped)
- npm pakke: `@poisedhq/dearuser-mcp`
- GitHub: `bleedmode/dearuser` (monorepo med mcp/ + web/)
- Web: `dearuser.ai`

## Arkitektur: 3 videnskilder + lokal SQLite

```
Kilde A (ekstern viden) → Hvad vi anbefaler
   Research DB (pvs_research_sources) + industri-tracking
   
Kilde B (brugerens filer) → Diagnose
   Scanner: CLAUDE.md, memory, hooks, skills, sessions, history
   
Kilde C (feedback loop) → Virkede det?
   ~/.dearuser/dearuser.db (SQLite) → recommendations, score_history, agent_runs
   
Kilde D (dashboard) → Visualisering
   Hono server på localhost:7700 → read-only fra SQLite
```

## Database (SQLite via better-sqlite3)
- Fil: `~/.dearuser/dearuser.db` — auto-oprettes ved første tool-kald
- WAL mode for concurrent reads (dashboard læser mens MCP skriver)
- Auto-migration: `mcp/migrations/*.sql` køres ved DB-åbning
- 4 tabeller: du_migrations, du_agent_runs, du_recommendations, du_score_history
- KUN data Dear User's egne tools producerer — ingen tasks, research, projects (det er et separat produkt)
- Dashboard åbner DB med readonly: true
- JSON-fil migration: eksisterende recommendations.json importeres automatisk

## MCP Tools (11 stk)
- `collab` — collaboration-analyse: scan + diagnose + anbefalinger + session-mønstre + feedback loop → skriver du_agent_runs + du_score_history + du_recommendations (legacy: analyze)
- `health` — system-sundhed: orphan jobs, overlap, missing closure, substrate mismatch → skriver du_agent_runs (legacy: audit, system_health)
- `security` — secret scanning, prompt-injection surfaces, CLAUDE.md↔artefakt rule conflicts → skriver du_agent_runs
- `onboard` — 7-step konversationel setup wizard for nye brugere
- `wrapped` — shareable stats (text eller JSON)
- `history` — vis eksisterende rapporter (summary, trend, regression) uden at køre ny scan
- `implement_recommendation` — udfør en pending recommendation (claude_md_append, settings_merge, manual)
- `dismiss_recommendation` — markér en recommendation som irrelevant/afvist (kaldes internt fra recommendation-flowet når brugeren vælger "Skip" — ingen `/dearuser-*` skill, by design)
- `share_report` — upload anonymiseret WRAPPED-rapport til dearuser.ai og returnér offentlig URL (kun wrapped; collab/health/security-deling er slået fra pre-launch)
- `feedback` — send kort note til Dear User's founder-inbox (write-only, eneste udgående data-kanal)
- `help` — capabilities menu

## Tech stack
- TypeScript + @modelcontextprotocol/sdk + Zod + better-sqlite3
- Stdio transport, kører lokalt
- Build: esbuild
- Ingen cloud, ingen API keys, data forlader aldrig maskinen

## 5 Personas
- Vibe Coder (kan ikke kode, stærk produkt)
- Senior Developer (koder godt, agent til speed)
- Indie Hacker (solo, ship hurtigt)
- Venture Studio (multi-projekt, automation)
- Team Lead (koordination, standarder)

## Research-kvalitetssystem (intern proces, ikke shipped)
- 3-fase process: Collect → Rate+Counter → Analyze
- Evidence ratings A-F med objektive kriterier
- Counter-evidence obligatorisk for A+B kilder
- Research data lever udenfor Dear User repo'et — kun vores egne produktbeslutninger baseret på research commiteres her

## Current state (april 2026)
- MCP server med 11 tools + lokal SQLite database + Hono dashboard + 8 skills shipped via npm (share_report er wrapped-only; dearuser-share skill fjernet fra repo 2026-04-24)
- health har 9 detectors (orphan, overlap, closure, substrate, mcp_refs, backup, stale_schedule, expected_jobs, reconciliation_gap)
- 26 kvalitetskontrollerede kilder i research DB (quality score 31%)
- Wrapped prototype live på dearuser.ai
- Dashboard live på localhost:7700 med score history, run log, recommendations
- Publiceret til npm som `@poisedhq/dearuser-mcp` (v1.0.17 live, granular publish-token via 1Password "npm publish token poisedhq")
- 0 brugere, 0 validering af betalingsvillighed

## Open questions
- Revenue model: gratis + pro $9/md er et gæt — uvalideret
- Prompt quality hook: reference eksisterer (severity1) men vores version ikke bygget

## Vigtige beslutninger taget
- Open source engine, paid tier for monitoring/coaching/team
- SQLite som default database — zero config, ingen cloud-krav
- Dashboard og database er gratis (stickiness). Research pattern og advanced analytics er pro
- Ét globalt DB (`~/.dearuser/dearuser.db`) — ikke per-projekt
- Dashboard er separat process (Hono), MCP er stdio
- better-sqlite3 (native addon) externalized i esbuild
- 3-fase research process (Collect → Rate → Analyze) med kvalitetskontrol
- Agent→agent: struktureret JSON output med presentation instructions
- Feedback loop: gem anbefalinger, tjek implementering, track score (nu i SQLite)
- Session-analyse: billig metadata + history parsing, ikke fuld JSONL parse
- Industri-tracking: scheduled task, ikke real-time
- Git-strategi: .db i .gitignore, migrations + config i git

## Regler for dette projekt
- ALDRIG præsentér research uden evidence rating og caveat
- ALDRIG merg to kilder til én claim
- To-kilde minimum for "findings"
- Default til usikkerhed: "antyder" ikke "viser"
- Rapport max 100 linjer — kortere er bedre
- Opdatér denne CLAUDE.md når beslutninger ændres
