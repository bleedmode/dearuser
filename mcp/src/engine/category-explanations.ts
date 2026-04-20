// category-explanations.ts — plain-Danish explanations for the 7 scoring
// categories in the collaboration analysis. Shown inline in the letter
// report (not tooltips) so users understand what they're looking at
// without having to hover or click.
//
// Research basis: NN/G + Smashing dashboard UX (2025) — "data without
// explanation" is the #1 dashboard mistake. Tooltips hide the info from
// mobile users and those who don't know an info-icon is interactive.
// Pattern: name + one plain-language line + expandable detail.
//
// Tone: brev-agtig. Write like Dear User is describing what she found
// in a letter, not like an enterprise KPI definition.

export interface CategoryExplanation {
  /** Danish category label used as the headline */
  label: string;
  /** One plain-Danish sentence shown directly under the label — always visible */
  summary: string;
  /** What pulls the score up vs down — shown in the expand-on-click drawer */
  whatMatters: string;
  /** Score-range verdicts so the user learns what their number actually means */
  verdict: (score: number) => string;
}

function verdicts(high: string, medium: string, low: string): (s: number) => string {
  return (s: number) => s >= 85 ? high : s >= 65 ? medium : low;
}

export const CATEGORY_EXPLANATIONS: Record<string, CategoryExplanation> = {
  roleClarity: {
    label: 'Klar rollefordeling',
    summary: 'Hvor tydeligt det er for din assistent hvem der gør hvad.',
    whatMatters:
      'Scoren stiger når din CLAUDE.md klart definerer dig og din assistent — jeres roller, ' +
      'hvem der beslutter hvad, og hvornår assistenten må handle selv. Den falder hvis rollerne ' +
      'står i gråzoner, eller hvis du mangler en "Roles"-sektion helt.',
    verdict: verdicts(
      'Jeg ved præcist hvem der gør hvad — ingen gåetten.',
      'Mest tydeligt, men der er et par gråzoner jeg kan komme i tvivl om.',
      'Rollerne er utydelige. Jeg ender med enten at tage for meget på mig eller spørge dig for ofte.',
    ),
  },

  communication: {
    label: 'Kommunikation',
    summary: 'Om jeg svarer i dit sprog, din længde og din tone.',
    whatMatters:
      'Scoren stiger når du har sat præferencer for sprog (fx "svar altid på dansk"), ' +
      'længde ("kort og klart"), og tone ("ingen jargon"). Den falder hvis jeg skal gætte hver gang.',
    verdict: verdicts(
      'Jeg rammer din tone og dit sprog konsekvent.',
      'Jeg rammer det oftest, men glipper en gang imellem.',
      'Jeg gætter på hvordan du vil have svar — og rammer forbi en god del af tiden.',
    ),
  },

  autonomyBalance: {
    label: 'Autonomi-balance',
    summary: 'Forholdet mellem hvad jeg må gøre selv og hvad jeg skal spørge om.',
    whatMatters:
      'Scoren stiger når der er en sund blanding af "gør selv", "spørg først" og "foreslå kun". ' +
      'Den falder hvis næsten alt er det samme — fx 90% "gør selv" betyder jeg ofte overrasker dig, ' +
      'mens 90% "spørg først" betyder jeg er langsom og irriterende.',
    verdict: verdicts(
      'God balance — jeg handler selv hvor det giver mening og spørger når det tæller.',
      'Nogenlunde balance, men hælder lidt for meget mod ét yderpunkt.',
      'Ubalanceret — jeg enten overrasker dig eller spørger om alt.',
    ),
  },

  qualityStandards: {
    label: 'Kvalitetstjek',
    summary: 'Om du har automatiske tjek der fanger fejl mens jeg arbejder.',
    whatMatters:
      'Scoren stiger når du har hooks der kører builds, tests eller sikkerhedstjek automatisk — ' +
      'og klare regler om hvordan kvalitet vurderes. Den falder hvis jeg kan lave destruktive ting ' +
      'uden at blive stoppet (fx force-push eller sletninger).',
    verdict: verdicts(
      'Du har beskyttelse mod de værste fejl — fejl fanges mens jeg arbejder.',
      'Nogle tjek er på plads, men der er huller — især omkring destruktive kommandoer.',
      'Stort set ingen automatiske tjek. Fejl findes først når de rammer dig.',
    ),
  },

  memoryHealth: {
    label: 'Memory-sundhed',
    summary: 'Hvor godt jeg husker dig fra sidste gang vi talte.',
    whatMatters:
      'Scoren stiger når du har mange memory-filer og dem med frontmatter (name, type, description) ' +
      'så de loades rigtigt. Den falder hvis du har få memories, eller hvis mange af dem mangler ' +
      'frontmatter og derfor bliver usynlige for mig.',
    verdict: verdicts(
      'Jeg har stærk hukommelse — dine rettelser bliver husket mellem sessioner.',
      'OK hukommelse, men nogle memories er rodet eller mangler frontmatter.',
      'Tynd hukommelse — jeg glemmer nemt hvad du har fortalt mig før.',
    ),
  },

  systemMaturity: {
    label: 'Systemets modenhed',
    summary: 'Om du har bygget skills, hooks og kommandoer der gør mig mere effektiv.',
    whatMatters:
      'Scoren stiger med antal skills (/learn, /ship, /standup osv.), hooks (automatiseringer) og ' +
      'custom kommandoer. Den falder hvis du kun bruger "ren chat" uden at have bygget værktøjer ' +
      'til gentagne opgaver.',
    verdict: verdicts(
      'Dit setup er modent — du har automatiseret de ting der tæller.',
      'Middel modent — du har nogle værktøjer, men der er plads til flere.',
      'Tidlig fase — næsten alt foregår som ren chat uden automationer.',
    ),
  },

  coverage: {
    label: 'Dækning',
    summary: 'Om de vigtige emner er dækket i dine instruktioner — eller om der er blinde pletter.',
    whatMatters:
      'Scoren stiger når din CLAUDE.md dækker roller, autonomi, kommunikation, kvalitet OG ' +
      'projektarkitektur. Den falder hvis store emner mangler helt — særligt hvis jeg aldrig ' +
      'har fået at vide hvordan dit projekt er struktureret.',
    verdict: verdicts(
      'De vigtige emner er dækket — jeg har et rundt billede af din setup.',
      'Meste af det vigtige er der, men et par blinde pletter er der.',
      'Store huller — der er områder hvor jeg arbejder i blinde.',
    ),
  },

  // -------- Security categories --------

  secretSafety: {
    label: 'Beskyttelse af hemmeligheder',
    summary: 'Om der ligger adgangskoder, API-nøgler eller tokens i åben tekst nogen steder.',
    whatMatters:
      'Scoren stiger når dine CLAUDE.md, memory, skills og settings er fri for credentials i klartekst. ' +
      'Den falder for hver nøgle jeg finder — særligt kritisk hvis den nogensinde har været committet til git.',
    verdict: verdicts(
      'Ingen læk — credentials ligger hvor de skal (1Password, miljø-variable, .env ignoreret).',
      'Jeg fandt noget der ligner en nøgle eller to — tag et kig og rotér dem hvis de har været delte.',
      'Klare hemmeligheder i åben tekst. Rotér dem NU før det er for sent.',
    ),
  },

  injectionResistance: {
    label: 'Modstand mod injection',
    summary: 'Om dine hooks og skills kan snydes af manipuleret input.',
    whatMatters:
      'Scoren stiger når dine hooks/skills ikke blindt bygger shell-kommandoer af bruger-input. ' +
      'Den falder hvis jeg finder mønstre som `bash -c "$VAR"` uden escape, eller skills der evaluerer ' +
      'tekst direkte — klassiske prompt-injection-overflader.',
    verdict: verdicts(
      'Jeg ser ingen åbne døre — input bliver håndteret sikkert.',
      'Et par mønstre der kunne misbruges — ikke kriser, men værd at stramme op.',
      'Alvorlige åbninger — en ondsindet tekst kan få mig til at køre noget jeg ikke burde.',
    ),
  },

  ruleIntegrity: {
    label: 'Regel-integritet',
    summary: 'Om dine CLAUDE.md-regler og din faktiske opsætning faktisk siger det samme.',
    whatMatters:
      'Scoren stiger når dine regler og dine hooks/skills er enige. Den falder hvis CLAUDE.md siger ' +
      'ét ("spørg altid før du deployer") men en hook gør noget andet ("deploy automatisk") — det er ' +
      'den farligste form for drift, fordi du og jeg tror vi er enige mens virkeligheden er en anden.',
    verdict: verdicts(
      'Reglerne og opsætningen matcher — ingen skjulte uoverensstemmelser.',
      'Et par steder hvor reglerne og hooks/skills ikke helt rimer. Kig dem igennem.',
      'Flere direkte konflikter — reglerne lyver om hvad der faktisk sker.',
    ),
  },

  dependencySafety: {
    label: 'Pakke-sikkerhed',
    summary: 'Om dine dependencies har kendte sårbarheder.',
    whatMatters:
      'Scoren stiger når dine package.json-filer er fri for kendte CVEs. Den falder for hver ' +
      'sårbarhed npm-advisoren kender til i de pakker du bruger — prioriteret efter hvor alvorlig ' +
      'sårbarheden er.',
    verdict: verdicts(
      'Ingen kendte sårbarheder i de pakker du bruger.',
      'Et par pakker med kendte problemer — opdatér dem når du får tid.',
      'Flere alvorlige sårbarheder i aktive dependencies. Opdatér før næste deploy.',
    ),
  },

  platformCompliance: {
    label: 'Platform-compliance',
    summary: 'Hvad eksterne rådgivere (Supabase, GitHub, npm, Vercel) siger om dit setup.',
    whatMatters:
      'Scoren stiger når Supabase RLS er aktiv, GitHub Dependabot er grøn, npm audit er ren, og ' +
      'Vercel ikke flagger noget. Den falder for hver finding de eksterne advisor-API\'er returnerer.',
    verdict: verdicts(
      'Alle eksterne rådgivere melder klart.',
      'Nogle advarsler fra mindst én platform — værd at kigge igennem.',
      'Kritiske fund på eksterne platforme. Fix dem før de bliver til incidents.',
    ),
  },

  // -------- System-sundhed categories --------

  jobIntegrity: {
    label: 'Job-integritet',
    summary: 'Om dine scheduled tasks faktisk kører, og om deres output bliver brugt.',
    whatMatters:
      'Scoren stiger når dine scheduled tasks (1) kører på deres planlagte tidspunkter og (2) har ' +
      'en dokumenteret modtager af deres output. Den falder hvis jobs stopper stille, eller hvis et ' +
      'job producerer data ingen læser.',
    verdict: verdicts(
      'Alle jobs kører som de skal, og deres output bliver brugt.',
      'Et par jobs er ikke kørt for nyligt, eller deres output bruges ikke — undersøg hvad der sker.',
      'Flere jobs er tavse eller orphaned. Du risikerer at miste data uden at opdage det.',
    ),
  },

  artifactOverlap: {
    label: 'Overlap mellem værktøjer',
    summary: 'Om du har næsten-dubletter af skills, hooks eller scheduled tasks der gør det samme.',
    whatMatters:
      'Scoren stiger når hvert værktøj har et unikt formål. Den falder hvis flere skills/tasks ' +
      'dækker samme jord — det skaber drift (de to versioner får forskellige regler over tid) og ' +
      'gør det uklart for mig hvilken der skal kaldes.',
    verdict: verdicts(
      'Ingen dubletter — hver skill og task har sit eget område.',
      'Et par værktøjer overlapper. Merge dem eller vælg én.',
      'Flere næsten-dubletter. Jeg risikerer at kalde den forkerte.',
    ),
  },

  dataClosure: {
    label: 'Data-lukning',
    summary: 'Om alt det der bliver produceret også bliver læst nogen steder.',
    whatMatters:
      'Scoren stiger når hvert produces-output har en matching consumes et andet sted. Den falder ' +
      'hvis hooks skriver filer ingen læser, eller skills genererer data der aldrig bruges — klassiske ' +
      'hængende data-flows.',
    verdict: verdicts(
      'Alt det du producerer har en aftager.',
      'Et par hængende outputs. Ikke kritisk, men oprydning af dem forhindrer rod.',
      'Flere data-flows uden modtager. Du skriver til tomme rum.',
    ),
  },

  configHealth: {
    label: 'Config-sundhed',
    summary: 'Om dine skills faktisk kan kalde de MCP tools de henviser til.',
    whatMatters:
      'Scoren stiger når alle `mcp__xxx__yyy` referencer i dine skills peger på MCP servere der ' +
      'faktisk er registreret. Den falder hvis skills kalder tools fra en server der ikke er ' +
      'installeret — de fejler stiltiende hver gang.',
    verdict: verdicts(
      'Alle MCP-referencer resolvér korrekt.',
      'Et par skills peger på tools der ikke findes. Registrér serveren eller fjern kaldene.',
      'Flere MCP-referencer peger på ikke-registrerede servere. Skills fejler tavst hver gang.',
    ),
  },

  substrateHealth: {
    label: 'Substrat-sundhed',
    summary: 'Om dine memory-filer har de rigtige headers, og om ~/.claude/ er backet op.',
    whatMatters:
      'Scoren stiger når memory-filer har frontmatter (så jeg loader dem rigtigt) og hele din ' +
      'agent-opsætning i ~/.claude/ er i version control. Den falder hvis memories ligger rodet ' +
      'eller hvis din Mac kunne lynnedbrændes med alt dit agent-arbejde tabt.',
    verdict: verdicts(
      'Memories er velstrukturerede, og din opsætning er backet op.',
      'Et par memories mangler frontmatter eller backup er ikke fuldstændig.',
      'Dele af din opsætning er sårbar — tabt ved næste disk-problem.',
    ),
  },
};

/**
 * Overall score verdict — one short sentence that frames the number.
 * Keeps the hero-tal from feeling like a standalone KPI without context.
 */
export function overallVerdict(score: number): string {
  if (score >= 90) return 'Stærkt samarbejde — der er kun få punkter at pudse.';
  if (score >= 75) return 'Solidt samarbejde. Nogle ting at stramme op, ingen kriser.';
  if (score >= 60) return 'OK udgangspunkt. Der er 1-2 ting du bør tage fat på først.';
  return 'Der er nogle grundlæggende ting vi bør have på plads. Tag dem i rækkefølge.';
}

/** Security-domain verdict — same tone as overallVerdict, scoped to security. */
export function securityVerdict(score: number): string {
  if (score >= 90) return 'Solid sikkerheds-hygiejne — de åbenlyse fælder er lukket.';
  if (score >= 75) return 'Overordnet sundt, men et par ting at stramme op på.';
  if (score >= 60) return 'Der er nogle huller. Ikke alarmerende, men bør fikses.';
  return 'Flere alvorlige fund. Start med de kritiske før noget andet.';
}

/** System-sundhed verdict — focused on coherence of the agent stack. */
export function systemHealthVerdict(score: number): string {
  if (score >= 90) return 'Setup\'et hænger sammen — værktøjer passer sammen og data flyder.';
  if (score >= 75) return 'Stort set sammenhængende, men et par steder der har taget afsted.';
  if (score >= 60) return 'Flere steder hvor dele af setup\'et ikke længere snakker ordentligt sammen.';
  return 'Dit setup er ved at falde fra hinanden. Ryd op før du bygger mere.';
}

export function explanationFor(key: string): CategoryExplanation | undefined {
  return CATEGORY_EXPLANATIONS[key];
}
