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

export function explanationFor(key: string): CategoryExplanation | undefined {
  return CATEGORY_EXPLANATIONS[key];
}
