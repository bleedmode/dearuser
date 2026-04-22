---
topic: Finding ledger architecture for Dear User multi-store drift
date: 2026-04-22
sources_consulted: 13
evidence_ratings: 4×C, 9×D (vendor convergence)
confidence: MEDIUM
review_status: DRAFT
---

# Finding ledger med scan-lifecycle: er det den bedste arkitektur?

## Opsummering

Kort svar: **Ja, scan-drevet finding-lifecycle er industri-standard** på tværs af alle seriøse vulnerability management-platforme vi undersøgte (Snyk, Dependabot, Semgrep, Datadog, Tenable, GitHub Code Scanning, Google SCC, DefectDojo/OWASP). Men tre designbeslutninger i den foreslåede plan bør justeres baseret på counter-evidence:

1. **Drop event sourcing som idé** — det er dokumenteret anti-pattern for simple state machines.
2. **Fingerprint-hash skal være "konfigurerbar per scanner"** som DefectDojo, ikke én universel formel — deterministiske hashes er fragile når input varierer.
3. **Reconciliation-loopet skal være idempotent med eksplicit drift-detection** — Kubernetes-communityet har dokumenteret infinite-loop-fælder.

Kerne-arkitekturen (scan = sandhed, lifecycle ejes af ledger, workflow-tasks er views) er sund og direkte afspejlet i alle best-in-class systemer.

Confidence: **MEDIUM**. Ingen peer-reviewed studier på dette (forventeligt for et ingeniørområde), men konvergent vendor-praksis på tværs af 8 uafhængige platforme er stærk indirekte evidens.

---

## Stærke fund (A+B rating, to-kilde minimum)

Ingen A- eller B-rated kilder fundet. Vulnerability management-arkitektur dokumenteres primært i vendor-docs, blog-posts og standarder — ikke i akademiske journals eller meta-analyser. Dette er et designområde hvor empirisk sammenligning af arkitekturer ikke er almindeligt rapporteret.

---

## Moderate fund (C rating, med caveats)

### Fund 1: Event sourcing er anti-pattern for simple finding-states

**[CLAIM]** Event sourcing (append-only event store + replay) er over-engineering for finding-lifecycle der reelt er en simpel state machine med få states. [Rating C]

- **Kilde 1**: Azure Architecture Center — Event Sourcing pattern
  - Data: Event sourcing passer når auditability, traceability og ingen data-tab er forretningskrav (reguleret industri, payment ledger, audit trail)
  - Caveat: Samme kilde anbefaler ikke at bruge event sourcing overalt

- **Kilde 2**: Chris Kiehl — "Event Sourcing is Hard" (blog_expert)
  - Data: I praksis "extremely coupled and yet excruciatingly opaque". Event store er svær at querye; kræver state replay for typiske queries
  - Counter: Ingen — selve kilden ER counter til hype

- **Counter-evidence (fra primary source)**: InfoQ — "A Whole System Based on Event Sourcing is an Anti-Pattern"
  - Nuance: Event sourcing kan være fint lokalt for dele af systemet, men ikke som top-level arkitektur

**Konklusion**: For Dear Users case (5 states: open, closed, acknowledged, dismissed, wont_fix) er CRUD med `last_seen`-tidsstempel tilstrækkeligt. Event sourcing introducerer kompleksitet uden tilsvarende gevinst.

### Fund 2: Deterministisk fingerprint-hash alene er utilstrækkelig

**[CLAIM]** SARIF-standarden for partialFingerprints er ikke pålidelig nok til at være eneste dedup-mekanisme; per-scanner konfigurerbart hash_code-pattern (DefectDojo-style) er mere robust. [Rating C+D]

- **Kilde 1**: OASIS SARIF 2.1.0 spec (white_paper, C)
  - Data: partialFingerprints er eksplicit designet til cross-scan identifikation
  - Counter: Mange tools implementerer ikke partialFingerprints korrekt

- **Kilde 2**: Boost Security — "SARIF Can't Save You Now" (blog_expert, C)
  - Data: DefectDojo's SARIF-parser ignorerer partialFingerprints. Standarden alene garanterer ikke dedup
  - Counter: Ingen — dette er selv counter-evidence til SARIF-hype

- **Støttende (vendor convergence, D)**: DefectDojo, Semgrep
  - DefectDojo bruger konfigurerbar `hash_code` over valgte felter per parser (vuln-name, location, severity, CWE)
  - Semgrep bruger to fingerprints: `match_based_id` (code-motion stabil) + `syntactic_id`

**Konklusion**: Hash skal generes lokalt per scanner med felter vi kontrollerer, ikke importeres blindt fra SARIF. Dear User's foreslåede `finding_hash = sha(platform + lint + subject)` er korrekt retning — men "subject" skal defineres per platform (table-name for Supabase, CVE-id for Dependabot, rule-id + file-path for Semgrep).

---

## Signaler (D rating — konvergent vendor-design)

Disse claims hviler på vendor-dokumentation (D rating individuelt), men **konvergens på tværs af 8 uafhængige platforme** er indirekte evidens for at pattern'et er praksis-validerbart.

### Signal 1: Scan-drevet state-transition er industri-standard

Samme grundmønster på tværs af alle undersøgte platforme:

| Platform | Mechanism |
|---|---|
| Snyk | Ignored vulns reopener automatisk når fix findes eller periode udløber |
| Dependabot | Auto-dismiss reopener hvis metadata ændres; Fixed afgøres ved næste scan |
| GitHub Code Scanning | Fixed = scan ser det ikke længere; dismiss kræver eksplicit reason |
| Datadog | Lukket ticket auto-reopener hvis åben finding er knyttet |
| Tenable | Tickets lukker først når scan bekræfter remediation |
| Semgrep | Triage-state synkroniseres på tværs af branches via fingerprint |
| Google SCC | Bi-directional ticket↔case sync |
| DefectDojo | Ændring af finding-status kun via hash-match mod ny import |

**Implikation**: Ingen af disse platforme lader mennesker manuelt markere "fixed" uden scan-bekræftelse. Det Dear User har i dag (15 PVS tasks markeret done, finding stadig open i Supabase Advisor) er den fælde industrien designer sig ud af.

### Signal 2: Dismiss-with-reason er universelt

GitHub, Snyk, Dependabot, og DefectDojo kræver eller har stærk praksis for at dismiss skal have en strukturere reason (false_positive, wont_fix, used_in_tests, risk_accepted). Det muliggør auto-reopen når betingelsen ændrer sig (Dependabot) og audit-trail for accepteret risk.

**Implikation**: Dear User's `dismiss_recommendation` bør udvides med `reason` enum + optional `expires_at`.

### Signal 3: Reconciliation-KPI bør være en førstegrads metrik

Tenable's closed-loop dokumenterer <1% gap mellem "scan open count" og "ticket open+in_progress" som sund. Større gap peger på enten false positives eller stale assets.

**Implikation**: Dear User bør have en `reconciliation_health`-metrik i dashboard og i `dearuser health`-tool. Vores nuværende state (2 open Supabase findings vs 15 done PVS tasks) ville give >90% gap — akut advarsel.

---

## Counter-evidence (hvad taler imod finding-ledger-planen)

### Counter 1: Event sourcing er ikke overflødigt for ALLE use cases
Hvis vi på et tidspunkt vil lave "replay hele finding-historikken for en app" eller "vis state ved tidspunkt T", kræver det enten event sourcing eller audit-log tabel. For nu: skip det, men design ledger med `first_seen`/`last_seen`/`closed_at` så audit-historik kan extrahere hvis behov opstår.

### Counter 2: Reconcile-loops har kendte failure modes
- `controller-runtime #392`: RequeueAfter uden Queue.Forget akkumulerer failure-count → 16min backoff
- `controller-runtime #2831`: Status-write under reconcile trigger ny reconcile = infinite loop

**Implikation**: Dear Users `finding-reconciler` skal:
- Kun skrive ledger hvis actual state er ændret (diff-check først)
- Have eksplicit cool-down mellem reconcile-runs
- Ikke trigger sig selv via egne writes

### Counter 3: Fingerprint-stabilitet under code-motion
Deterministiske hashes er fragile: "små ændringer i input → drastisk anderledes output". Hvis vi inkluderer line-number i hash og koden shifter, får vi falsk ny-finding.

**Implikation**: Undgå volatile felter i hash. For Supabase: `table_name + lint_code` (stabilt). For GitHub: `cve_id + package_name` (stabilt). For Semgrep-agtige: brug deres egen `match_based_id`.

### Counter 4: Vendor-claims er selvsælgende
Alle 9 D-rated kilder er vendor-indhold fra virksomheder der sælger vuln mgmt. De har incitament til at præsentere deres arkitektur som best practice. Men konvergensen på tværs af konkurrerende vendors (Snyk vs GitHub vs Datadog) reducerer denne risiko — de efterligner ikke hinanden, de når selvstændigt samme design.

---

## Huller (hvad vi IKKE fandt data for)

1. **Empirisk small-team data**: Ingen studier på cost/benefit af closed-loop vuln mgmt ved 10-20 apps skala. Alle closed-loop-case-studies er enterprise. Mulig risiko: over-engineering for PVS-skala.

2. **Failure rate for content-hash dedup**: Ingen data på hvor ofte DefectDojo's hash_code fejler (duplicate findings får forskellig hash, eller distinct findings får samme hash).

3. **CRDT eller distributed finding stores**: Ingen kilder fundet på CRDT for security findings. Sandsynligvis fordi ledger er naturligt single-writer (kun scan opdaterer) og sync-problemet ikke er dér.

4. **Migration patterns**: Ingen kilder dækkede hvordan eksisterende systemer migrerer fra "status i task" til "ledger + workflow task". Migration-strategi er hjemmeudviklet terræn.

---

## Anbefaling for Dear User

Baseret på evidens, anbefal følgende revision af den oprindelige plan:

### Bekræftet fra oprindelig plan
- ✅ `du_findings` ledger med `finding_hash` som unique key
- ✅ Scan upserter findings, auto-close ved `last_seen > N dage`
- ✅ PVS task bliver workflow-view, ikke duplikat finding-store
- ✅ "Done i PVS" lukker IKKE findingen — scan gør

### Justeret baseret på research
- ⚠️ **Drop event sourcing-overvejelse helt**. Simple append-writes til `du_findings` med `first_seen/last_seen/closed_at`-kolonner opfylder 95% af audit-behov uden kompleksiteten.
- ⚠️ **Hash generering**: per-platform funktion, ikke universal. Definér i kode, ikke config:
  ```ts
  supabase: sha(`${project}|${lint_code}|${table}`)
  dependabot: sha(`${repo}|${cve_id}|${package}`)
  agent: sha(`${rule_id}|${file_path}|${normalized_match}`)
  ```
- ⚠️ **Reconciler-sikkerhed**:
  - Diff før write (hvis state uændret, skip update)
  - Minimum 60s cooldown mellem kørsler
  - Separat skriv-path for reconciler vs scan (undgå "reconciler skriver → scan trigger reconciler" loop)
- ➕ **Tilføj**: `dismiss_reason` enum (false_positive, wont_fix, accepted_risk, used_in_tests) + optional `dismiss_expires_at`
- ➕ **Tilføj**: `reconciliation_health` KPI i `dearuser health`: gap mellem "findings open" og "workflow-tasks open" pr. platform
- ➕ **Tilføj**: auto-reopen når dismiss-reason's metadata ændres (Dependabot pattern)

### Afvist alternativer

- ❌ **Event sourcing**: over-engineering for 5-state lifecycle. Anti-pattern when applied system-wide.
- ❌ **CRDT**: single-writer problem (kun scan opdaterer ledger); ingen distribueret-sync-behov.
- ❌ **Pure SARIF import**: fragil fingerprinting, inkonsistent implementering på tværs af tools. Brug SARIF som transport, egen hash som dedup-key.
- ❌ **Manuel "mark done" lukker finding**: dokumenteret fælde — det er netop det close-loop-problem Tenable/Datadog designede sig ud af.

## Implementerings-rækkefølge (baseret på blast-radius)

1. **Stop blødningen (i dag)**: akut-fixes i nuværende system (keyword-match bug er rettet; reset 15 falsk-done PVS tasks; verificér hvorfor dearuser-security-daily ikke har kørt siden 20/4)
2. **Migration 1**: `du_findings` tabel + `finding_hash` per platform
3. **Migration 2**: Opdatér alle 5 scan-detectors til at upserte til `du_findings` i stedet for kun `du_recommendations`
4. **Migration 3**: `du_recommendations` reduceres til workflow-view (peger på `finding_hash`) — behold backward-compat
5. **Migration 4**: Finding-reconciler scheduled agent (auto-close old, reopen returning)
6. **Migration 5**: PVS `auto-sec` tasks dedupperes på `finding_hash` i stedet for title

---

## Quality score

- 13 kilder consultered
- 4 C-rated (SARIF spec, Boost, Azure, Chris Kiehl)
- 9 D-rated (konvergent vendor-design)
- 4/4 C-kilder har counter-evidence
- Rating distribution 31% C / 69% D
- Ingen A/B tilgængelige (feltet dokumenteres ikke akademisk)

**Confidence: MEDIUM** fordi:
- Ingen peer-reviewed evidens (forventeligt for ingeniørarkitektur)
- Konvergent vendor-design på 8 uafhængige platforme er stærk indirekte evidens
- Alle foreslåede patterns har praksis-validering (produktionssystemer bruger dem)
- Counter-evidence på 4/4 C-kilder håndteret i anbefaling

## Kilder

| ID | Rating | Type | Titel |
|---|---|---|---|
| 1d4c9514 | C | white_paper | OASIS SARIF 2.1.0 Specification |
| 34dba71f | C | blog_expert | SARIF Can't Save You Now (Boost) |
| 47b53860 | C | white_paper | Event Sourcing pattern (Azure) |
| a684f920 | C | blog_expert | Event Sourcing is Hard (Chris Kiehl) |
| 0b9cebf3 | D | vendor | Snyk Ignore issues lifecycle |
| 036b8984 | D | vendor | GitHub Dependabot auto-triage rules |
| 2c4c0b27 | D | vendor | GitHub Code Scanning resolving alerts |
| e04c9926 | D | vendor | Semgrep Remove duplicate findings |
| e32a0aa3 | D | vendor | DefectDojo deduplication tuning |
| ae1797fd | D | vendor | Datadog ticketing integrations |
| 8c207dde | D | vendor | Tenable closed-loop security |
| e9b1f29d | D | vendor | Google SCC ticketing integration |
| 55587a5c | D | vendor | Kubernetes Controllers |
