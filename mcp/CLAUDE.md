# Dear User (dearuser-mcp)

## Hvad er det
Open source MCP server der hjælper mennesker og AI-agenter med at forstå hinanden bedre. Analyserer samarbejdet, identificerer problemer, leverer konkret kode/config — ikke råd.

## Navn
- **Dear User** = produktnavn (brand)
- **Dear User Analyze** = diagnose-værktøj (mcp__dearuser__analyze)
- **Dear User Wrapped** = viral feature / shareable stats (mcp__dearuser__wrapped)
- npm pakke: `dearuser-mcp`
- GitHub: `bleedmode/dearuser` (monorepo med mcp/ + web/)
- Web: `dearuser.ai`

## Arkitektur: 3 videnskilder

```
Kilde A (ekstern viden) → Hvad vi anbefaler
   Research DB (pvs_research_sources) + industri-tracking
   
Kilde B (brugerens filer) → Diagnose
   Scanner: CLAUDE.md, memory, hooks, skills, sessions, history
   
Kilde C (feedback loop) → Virkede det?
   ~/.dearuser/recommendations.json → tjek ved næste analyze
```

## MCP Tools (2 stk)
- `analyze` — scan + diagnose + anbefalinger + session-mønstre + feedback loop
- `wrapped` — shareable stats (text eller JSON)

## Tech stack
- TypeScript + @modelcontextprotocol/sdk + Zod
- Stdio transport, kører lokalt
- Ingen cloud, ingen API keys, data forlader aldrig maskinen

## 5 Personas
- Vibe Coder (kan ikke kode, stærk produkt)
- Senior Developer (koder godt, agent til speed)
- Indie Hacker (solo, ship hurtigt)
- Venture Studio (multi-projekt, automation)
- Team Lead (koordination, standarder)

## Research-kvalitetssystem
- `/research` skill med 3 faser: Collect → Rate+Counter → Analyze
- `pvs source add/rate/list/verify/stats` CLI
- Evidence ratings A-F med objektive kriterier
- Counter-evidence obligatorisk for A+B kilder
- Research UI i PVS dashboard

## Sondring: meta-research vs bruger-research
- **Meta-research** (vores produkt): problemtaksonomi, MCP landskab, industri-tracking → lever i PVS
- **Bruger-research** (toolet udfører): scanning, diagnose, anbefalinger, feedback → lever i MCP server + ~/.dearuser/

## Current state (april 2026)
- MCP server v2 bygget og testet (session-analyse, feedback loop, agent→agent instruktioner)
- 26 kvalitetskontrollerede kilder i research DB (quality score 31%)
- Wrapped prototype live på poised.dk/dearuser
- PVS projekt oprettet med tasks
- Ikke publiceret til npm endnu
- 0 brugere, 0 validering af betalingsvillighed

## Open questions
- Revenue model: gratis + pro $9/md er et gæt — uvalideret
- Onboarding-flow: designet (OpenClaw-inspireret samtale) men ikke bygget
- Prompt quality hook: reference eksisterer (severity1) men vores version ikke bygget
- Domæne: agentwrapped.com eller dearuser.ai?

## Vigtige beslutninger taget
- Open source engine, paid tier for monitoring/coaching/team
- 3-fase research process (Collect → Rate → Analyze) med kvalitetskontrol
- Agent→agent: struktureret JSON output med presentation instructions
- Feedback loop: gem anbefalinger, tjek implementering, track score
- Session-analyse: billig metadata + history parsing, ikke fuld JSONL parse
- Industri-tracking: scheduled task, ikke real-time

## Regler for dette projekt
- ALDRIG præsentér research uden evidence rating og caveat
- ALDRIG merg to kilder til én claim
- To-kilde minimum for "findings"
- Default til usikkerhed: "antyder" ikke "viser"
- Rapport max 100 linjer — kortere er bedre
- Opdatér denne CLAUDE.md når beslutninger ændres
