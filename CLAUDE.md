# Dear User — project-wide notes

Globale regler i `~/.claude/CLAUDE.md`. MCP-internt i `mcp/CLAUDE.md`. Her ligger learnings der gælder Dear User-produktet på tværs.

## Produkt-scope
Menneske↔agent samarbejdsanalyse. Kører lokalt, ingen data forlader maskinen. Live: dearuser.ai. Lokal DB: `~/.dearuser/dearuser.db` (SQLite, 6 tabeller: du_migrations, du_agent_runs, du_recommendations, du_score_history, du_findings, du_finding_events — auto-oprettes).

**Scope:** Diagnose + feedback loop. IKKE task management, research eller dashboard — det er PVS OS.

## Slash-command ↔ MCP-tool mapping
- `/dearuser-collab` → `mcp__dearuser__collab`
- `/dearuser-health` → `mcp__dearuser__health`
- `/dearuser-security` → `mcp__dearuser__security`
- `/dearuser-wrapped` → `mcp__dearuser__wrapped`
- `/dearuser-onboard` → `mcp__dearuser__onboard`
- `/dearuser-history` → `mcp__dearuser__history`
- `/dearuser-help` → `mcp__dearuser__help`
- `/dearuser-feedback` → `mcp__dearuser__feedback`
- `/dearuser-share` → `mcp__dearuser__share_report`

Dashboard: `http://localhost:7700` — Config: `~/.dearuser/config.json`

## Lessons fra Dear User-udvikling

### Ghost-process bug: kill -9 + verificér fri port før bind
`kill` (SIGTERM) er ikke nok for stdio MCP-processer eller servere med signal-traps. Reload-scripts skal:
1. `kill -9 $(lsof -ti :<port>)` for ALLE processer på alle relevante porte
2. Verificér at ingen port er optaget FØR ny bind
3. Fail loudly hvis kill ikke tog — ikke silent-bind ny proces ved siden af gammel

Symptom: 2+ processer binder samme port med SO_REUSEPORT, den der svarer først server stale bundle. Se `mcp/scripts/reload-dashboard.sh` som skabelon. Lært 2026-04-23.

### Consent-copy skal matche hvad koden faktisk gør
Onboarding lovede "Nothing installs without you saying yes" — men done-siden viste ✓-rows for auto-installeret infrastruktur. Jarl catchede kontradiktionen øjeblikkeligt.

**Regel:** copy der lover en bestemt adfærd ("we don't...", "nothing will...", "you decide...") skal kryds-tjekkes mod faktiske filesystem/DB/API-operationer.

Skelne kategorier klart:
- *Produkt-infrastruktur* (installation af produktets egen kode/config) → auto, det ER produktet
- *Opt-in udvidelser* (eksterne integrationer, scheduled tasks, data-sharing) → altid klik-for-klik

Copy skal være specifik om HVAD der er opt-in ("I won't create scheduled tasks without your click") ikke overordnet ("nothing installs"). Tillid er Dear User's value prop — én overpromise skader mere end ti gode promises. Lært 2026-04-23.

### Event delegation for dynamisk renderede forms
IIFE-script der queryede `#answer` ved parse-tid fejlede silent fordi textarea blev renderet efter script-blokken.

Regel: i forms hvor scripts og DOM-noder er i samme HTML-stream, brug `document.addEventListener('click', ...)` med `.closest()` i stedet for eager `document.querySelector()`. Virker uanset parse-rækkefølge og overlever re-renders.

```js
document.addEventListener('click', function(e) {
  var target = e.target && e.target.closest ? e.target.closest('.my-control') : null;
  if (!target) return;
  // handle
});
```

Undgå også `if (!el) return;` silent bail — det skjuler bugs. Lært 2026-04-23 under onboarding chip-click-bug.

### Launch-claim benchmarks skal holde til Reddit-scrutiny
Hvis produktet gør kvantitative claims ("scores higher than X%"), skal benchmark-korpusset være troværdigt:
- Minimum 500 datapunkter for percentile-claims. Ideelt 1000+.
- Stratified sampling — ellers skjuler du sampling-bias.
- Rapporter non-findings (fx stars-tier viste intet signal) — styrker troværdighed.
- Ved <500: downgrade copy fra "top X%" til "higher than the set we tested".

Lært 2026-04-22: første corpus var 50 CLAUDE.md-filer — Jarl ramte det som "useriøst". Udvidet til 2895.

### Shared HTML-renderer-pattern (cross-framework)
Når samme visuelle output skal renderes af flere framework-stacks (Astro + Hono): ekstrahér en framework-agnostisk TypeScript-funktion der returnerer `{ html: string, css?: string }` som strings. Astro indsætter via `<Fragment set:html={html} />`, Hono/Express indsætter i response-body.

**Rule of thumb:** 2+ overflader med SAMME visuelle output = ÉN renderer. Reference: `web/src/lib/wrapped-slides.ts`.
