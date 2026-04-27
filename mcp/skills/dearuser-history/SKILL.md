---
name: dearuser:history
description: History — vis seneste rapporter, score-trend over tid, eller hvad der ændrede sig siden sidste kørsel. Ingen re-scan. Powered by Dear User.
allowed-tools: "mcp__dearuser__history, Bash"
---

# Dear User — History

Hent eksisterende rapporter uden at køre en ny scan. Brug dette når brugeren vil se seneste score, trend over tid, eller hvad der ændrede sig — ikke når de vil have friske data (kør `collab`/`health`/`security` direkte i stedet).

## Hvornår bruges hvad

- **"Vis seneste rapport"** / "hvad sagde nattens scan?" / "show me the latest" → `format: "summary"`
- **"Er scoren blevet bedre?"** / "vis trend" / "hvordan går det over tid" → `format: "trend"`
- **"Hvad ændrede sig?"** / "hvad er nyt?" / "hvad gik galt?" → `format: "regression"`
- Specifik historisk rapport (bruger har et run-ID) → `run_id: "<id>"`

Scope kan snævre ind: `"collab"`, `"health"`, `"security"`, eller `"all"` (default).

## Trin 1: Kør tool

1. Prøv `mcp__dearuser__history` med relevante parametre.
2. **Hvis tool'et ikke er tilgængeligt** (første turn i session — MCP tools loader lazy), brug Bash-fallback:
   ```
   npx -y -p @poisedhq/dearuser-mcp dearuser-run history 2>/dev/null
   ```
   Med parametre (JSON):
   ```
   npx -y -p @poisedhq/dearuser-mcp dearuser-run history '{"format":"trend","scope":"security"}' 2>/dev/null
   ```
3. Output HELE rapporten som dit svar — summér ikke, forkort ikke.

## Trin 2: Fresh-scan CTA

Efter summary/trend: hvis data er >24t gammelt, tilbyd at køre en frisk scan (`collab`/`health`/`security`). Rapporter tager ~30 sek.

Efter regression: hvis der er nye findings, tilbyd at køre `implement_recommendation` på pending recs, eller en frisk scan for at verificere fix.

## Regler

- Rapport-delen: verbatim, ingen commentary.
- Dansk svar hvis brugeren skriver på dansk.
- Brug ikke dette tool til at "spare tid" på en scan brugeren eksplicit bad om — hvis de sagde "kør security", kør security. History er til eksisterende rapporter.
