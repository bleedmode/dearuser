// category-explanations.ts — bilingual (DA/EN) explanations for the scoring
// categories shown in the letter report (not tooltips) so users understand
// what they're looking at without having to hover or click.
//
// Research basis: NN/G + Smashing dashboard UX (2025) — "data without
// explanation" is the #1 dashboard mistake. Tooltips hide the info from
// mobile users and those who don't know an info-icon is interactive.
// Pattern: name + one plain-language line + expandable detail.
//
// Tone: brev-agtig. Write like Dear User is describing what she found
// in a letter, not like an enterprise KPI definition.

export interface LocalizedString {
  da: string;
  en: string;
}

export interface CategoryExplanation {
  /** Category label used as the headline */
  label: LocalizedString;
  /** One plain-language sentence shown directly under the label — always visible */
  summary: LocalizedString;
  /** What pulls the score up vs down — shown in the expand-on-click drawer */
  whatMatters: LocalizedString;
  /** Score-range verdicts so the user learns what their number actually means */
  verdict: (score: number) => LocalizedString;
}

function verdicts(
  high: LocalizedString,
  medium: LocalizedString,
  low: LocalizedString,
): (s: number) => LocalizedString {
  return (s: number) => s >= 85 ? high : s >= 65 ? medium : low;
}

export const CATEGORY_EXPLANATIONS: Record<string, CategoryExplanation> = {
  roleClarity: {
    label: { da: 'Klar rollefordeling', en: 'Clear roles' },
    summary: {
      da: 'Hvor tydeligt det er for din assistent hvem der gør hvad.',
      en: 'How clear it is to your assistant who does what.',
    },
    whatMatters: {
      da:
        'Scoren stiger når din CLAUDE.md klart definerer dig og din assistent — jeres roller, ' +
        'hvem der beslutter hvad, og hvornår assistenten må handle selv. Den falder hvis rollerne ' +
        'står i gråzoner, eller hvis du mangler en "Roles"-sektion helt.',
      en:
        'The score rises when your CLAUDE.md clearly defines you and your assistant — your roles, ' +
        'who decides what, and when the assistant can act on its own. It falls if roles sit in ' +
        'grey zones, or if you lack a "Roles" section entirely.',
    },
    verdict: verdicts(
      {
        da: 'Jeg ved præcist hvem der gør hvad — ingen gåetten.',
        en: 'I know exactly who does what — no guessing.',
      },
      {
        da: 'Mest tydeligt, men der er et par gråzoner jeg kan komme i tvivl om.',
        en: 'Mostly clear, but there are a few grey zones where I might hesitate.',
      },
      {
        da: 'Rollerne er utydelige. Jeg ender med enten at tage for meget på mig eller spørge dig for ofte.',
        en: 'Roles are unclear. I end up either taking on too much or asking you too often.',
      },
    ),
  },

  communication: {
    label: { da: 'Kommunikation', en: 'Communication' },
    summary: {
      da: 'Om jeg svarer i dit sprog, din længde og din tone.',
      en: 'Whether I reply in your language, your length and your tone.',
    },
    whatMatters: {
      da:
        'Scoren stiger når du har sat præferencer for sprog (fx "svar altid på dansk"), ' +
        'længde ("kort og klart"), og tone ("ingen jargon"). Den falder hvis jeg skal gætte hver gang.',
      en:
        'The score rises when you have set preferences for language (e.g. "always answer in English"), ' +
        'length ("short and clear"), and tone ("no jargon"). It falls if I have to guess every time.',
    },
    verdict: verdicts(
      {
        da: 'Jeg rammer din tone og dit sprog konsekvent.',
        en: 'I match your tone and language consistently.',
      },
      {
        da: 'Jeg rammer det oftest, men glipper en gang imellem.',
        en: 'I usually hit it, but slip occasionally.',
      },
      {
        da: 'Jeg gætter på hvordan du vil have svar — og rammer forbi en god del af tiden.',
        en: "I'm guessing how you want replies — and missing a fair amount of the time.",
      },
    ),
  },

  autonomyBalance: {
    label: { da: 'Autonomi-balance', en: 'Autonomy balance' },
    summary: {
      da: 'Forholdet mellem hvad jeg må gøre selv og hvad jeg skal spørge om.',
      en: 'The ratio between what I may do on my own and what I must ask about.',
    },
    whatMatters: {
      da:
        'Scoren stiger når der er en sund blanding af "gør selv", "spørg først" og "foreslå kun". ' +
        'Den falder hvis næsten alt er det samme — fx 90% "gør selv" betyder jeg ofte overrasker dig, ' +
        'mens 90% "spørg først" betyder jeg er langsom og irriterende.',
      en:
        'The score rises when there is a healthy mix of "do yourself", "ask first" and "suggest only". ' +
        'It falls if nearly everything is the same — e.g. 90% "do yourself" means I often surprise you, ' +
        'while 90% "ask first" means I am slow and annoying.',
    },
    verdict: verdicts(
      {
        da: 'God balance — jeg handler selv hvor det giver mening og spørger når det tæller.',
        en: 'Good balance — I act on my own where it makes sense and ask when it matters.',
      },
      {
        da: 'Nogenlunde balance, men hælder lidt for meget mod ét yderpunkt.',
        en: 'Roughly balanced, but leans a bit too far toward one end.',
      },
      {
        da: 'Ubalanceret — jeg enten overrasker dig eller spørger om alt.',
        en: 'Unbalanced — I either surprise you or ask about everything.',
      },
    ),
  },

  qualityStandards: {
    label: { da: 'Kvalitetstjek', en: 'Quality checks' },
    summary: {
      da: 'Om du har automatiske tjek der fanger fejl mens jeg arbejder.',
      en: 'Whether you have automatic checks that catch mistakes while I work.',
    },
    whatMatters: {
      da:
        'Scoren stiger når du har hooks der kører builds, tests eller sikkerhedstjek automatisk — ' +
        'og klare regler om hvordan kvalitet vurderes. Den falder hvis jeg kan lave destruktive ting ' +
        'uden at blive stoppet (fx force-push eller sletninger).',
      en:
        'The score rises when you have hooks that run builds, tests or security checks automatically — ' +
        'and clear rules for how quality is judged. It falls if I can do destructive things ' +
        'without being stopped (e.g. force-push or deletions).',
    },
    verdict: verdicts(
      {
        da: 'Du har beskyttelse mod de værste fejl — fejl fanges mens jeg arbejder.',
        en: "You're protected against the worst mistakes — errors get caught while I work.",
      },
      {
        da: 'Nogle tjek er på plads, men der er huller — især omkring destruktive kommandoer.',
        en: "Some checks are in place, but there are gaps — especially around destructive commands.",
      },
      {
        da: 'Stort set ingen automatiske tjek. Fejl findes først når de rammer dig.',
        en: "Almost no automatic checks. Mistakes surface only when they hit you.",
      },
    ),
  },

  memoryHealth: {
    label: { da: 'Memory-sundhed', en: 'Memory health' },
    summary: {
      da: 'Hvor godt jeg husker dig fra sidste gang vi talte.',
      en: 'How well I remember you from the last time we spoke.',
    },
    whatMatters: {
      da:
        'Scoren stiger når du har mange memory-filer og dem med frontmatter (name, type, description) ' +
        'så de loades rigtigt. Den falder hvis du har få memories, eller hvis mange af dem mangler ' +
        'frontmatter og derfor bliver usynlige for mig.',
      en:
        'The score rises when you have many memory files and they have frontmatter (name, type, description) ' +
        'so they load correctly. It falls if you have few memories, or if many of them lack ' +
        'frontmatter and become invisible to me.',
    },
    verdict: verdicts(
      {
        da: 'Jeg har stærk hukommelse — dine rettelser bliver husket mellem sessioner.',
        en: 'I have strong memory — your corrections stick between sessions.',
      },
      {
        da: 'OK hukommelse, men nogle memories er rodet eller mangler frontmatter.',
        en: 'Decent memory, but some memories are messy or missing frontmatter.',
      },
      {
        da: 'Tynd hukommelse — jeg glemmer nemt hvad du har fortalt mig før.',
        en: "Thin memory — I easily forget what you've told me before.",
      },
    ),
  },

  systemMaturity: {
    label: { da: 'Systemets modenhed', en: 'System maturity' },
    summary: {
      da: 'Om du har bygget skills, hooks og kommandoer der gør mig mere effektiv.',
      en: "Whether you've built skills, hooks and commands that make me more effective.",
    },
    whatMatters: {
      da:
        'Scoren stiger med antal skills (/learn, /ship, /standup osv.), hooks (automatiseringer) og ' +
        'custom kommandoer. Den falder hvis du kun bruger "ren chat" uden at have bygget værktøjer ' +
        'til gentagne opgaver.',
      en:
        'The score rises with the number of skills (/learn, /ship, /standup etc.), hooks (automations) and ' +
        'custom commands. It falls if you only use "plain chat" without having built tools ' +
        'for repeated tasks.',
    },
    verdict: verdicts(
      {
        da: 'Dit setup er modent — du har automatiseret de ting der tæller.',
        en: "Your setup is mature — you've automated the things that matter.",
      },
      {
        da: 'Middel modent — du har nogle værktøjer, men der er plads til flere.',
        en: "Middling maturity — you have some tools, but there's room for more.",
      },
      {
        da: 'Tidlig fase — næsten alt foregår som ren chat uden automationer.',
        en: 'Early stage — almost everything is plain chat with no automations.',
      },
    ),
  },

  coverage: {
    label: { da: 'Dækning', en: 'Coverage' },
    summary: {
      da: 'Om de vigtige emner er dækket i dine instruktioner — eller om der er blinde pletter.',
      en: 'Whether the important topics are covered in your instructions — or whether there are blind spots.',
    },
    whatMatters: {
      da:
        'Scoren stiger når din CLAUDE.md dækker roller, autonomi, kommunikation, kvalitet OG ' +
        'projektarkitektur. Den falder hvis store emner mangler helt — særligt hvis jeg aldrig ' +
        'har fået at vide hvordan dit projekt er struktureret.',
      en:
        'The score rises when your CLAUDE.md covers roles, autonomy, communication, quality AND ' +
        'project architecture. It falls if major topics are missing entirely — especially if I have ' +
        'never been told how your project is structured.',
    },
    verdict: verdicts(
      {
        da: 'De vigtige emner er dækket — jeg har et rundt billede af din setup.',
        en: 'The important topics are covered — I have a well-rounded picture of your setup.',
      },
      {
        da: 'Meste af det vigtige er der, men et par blinde pletter er der.',
        en: "Most of what matters is there, but there are a few blind spots.",
      },
      {
        da: 'Store huller — der er områder hvor jeg arbejder i blinde.',
        en: "Major gaps — there are areas where I'm working blind.",
      },
    ),
  },

  // -------- Security categories --------

  secretSafety: {
    label: { da: 'Beskyttelse af hemmeligheder', en: 'Secrets protection' },
    summary: {
      da: 'Om der ligger adgangskoder, API-nøgler eller tokens i åben tekst nogen steder.',
      en: 'Whether passwords, API keys or tokens are lying around in plain text.',
    },
    whatMatters: {
      da:
        'Scoren stiger når dine CLAUDE.md, memory, skills og settings er fri for credentials i klartekst. ' +
        'Den falder for hver nøgle jeg finder — særligt kritisk hvis den nogensinde har været committet til git.',
      en:
        'The score rises when your CLAUDE.md, memory, skills and settings are free of credentials in plain text. ' +
        "It falls for every key I find — especially critical if it's ever been committed to git.",
    },
    verdict: verdicts(
      {
        da: 'Ingen læk — credentials ligger hvor de skal (1Password, miljø-variable, .env ignoreret).',
        en: 'No leaks — credentials live where they should (1Password, environment variables, .env ignored).',
      },
      {
        da: 'Jeg fandt noget der ligner en nøgle eller to — tag et kig og rotér dem hvis de har været delte.',
        en: "I found something that looks like a key or two — take a look and rotate them if they've been shared.",
      },
      {
        da: 'Klare hemmeligheder i åben tekst. Rotér dem NU før det er for sent.',
        en: "Clear secrets in plain text. Rotate them NOW before it's too late.",
      },
    ),
  },

  injectionResistance: {
    label: { da: 'Modstand mod injection', en: 'Injection resistance' },
    summary: {
      da: 'Om dine hooks og skills kan snydes af manipuleret input.',
      en: 'Whether your hooks and skills can be tricked by manipulated input.',
    },
    whatMatters: {
      da:
        'Scoren stiger når dine hooks/skills ikke blindt bygger shell-kommandoer af bruger-input. ' +
        'Den falder hvis jeg finder mønstre som `bash -c "$VAR"` uden escape, eller skills der evaluerer ' +
        'tekst direkte — klassiske prompt-injection-overflader.',
      en:
        'The score rises when your hooks/skills do not blindly build shell commands from user input. ' +
        'It falls if I find patterns like `bash -c "$VAR"` without escaping, or skills that evaluate ' +
        'text directly — classic prompt-injection surfaces.',
    },
    verdict: verdicts(
      {
        da: 'Jeg ser ingen åbne døre — input bliver håndteret sikkert.',
        en: "I see no open doors — input is handled safely.",
      },
      {
        da: 'Et par mønstre der kunne misbruges — ikke kriser, men værd at stramme op.',
        en: 'A few patterns that could be abused — not a crisis, but worth tightening.',
      },
      {
        da: 'Alvorlige åbninger — en ondsindet tekst kan få mig til at køre noget jeg ikke burde.',
        en: "Serious openings — a malicious text could get me to run something I shouldn't.",
      },
    ),
  },

  ruleIntegrity: {
    label: { da: 'Regel-integritet', en: 'Rule integrity' },
    summary: {
      da: 'Om dine CLAUDE.md-regler og din faktiske opsætning faktisk siger det samme.',
      en: 'Whether your CLAUDE.md rules and your actual setup really say the same thing.',
    },
    whatMatters: {
      da:
        'Scoren stiger når dine regler og dine hooks/skills er enige. Den falder hvis CLAUDE.md siger ' +
        'ét ("spørg altid før du deployer") men en hook gør noget andet ("deploy automatisk") — det er ' +
        'den farligste form for drift, fordi du og jeg tror vi er enige mens virkeligheden er en anden.',
      en:
        'The score rises when your rules and your hooks/skills agree. It falls if CLAUDE.md says ' +
        'one thing ("always ask before deploying") but a hook does another ("deploy automatically") — that is ' +
        'the most dangerous kind of drift, because you and I think we agree while reality says otherwise.',
    },
    verdict: verdicts(
      {
        da: 'Reglerne og opsætningen matcher — ingen skjulte uoverensstemmelser.',
        en: 'Rules and setup match — no hidden inconsistencies.',
      },
      {
        da: 'Et par steder hvor reglerne og hooks/skills ikke helt rimer. Kig dem igennem.',
        en: "A few places where rules and hooks/skills don't quite line up. Look them over.",
      },
      {
        da: 'Flere direkte konflikter — reglerne lyver om hvad der faktisk sker.',
        en: 'Several direct conflicts — the rules lie about what actually happens.',
      },
    ),
  },

  dependencySafety: {
    label: { da: 'Pakke-sikkerhed', en: 'Package safety' },
    summary: {
      da: 'Om dine dependencies har kendte sårbarheder.',
      en: 'Whether your dependencies have known vulnerabilities.',
    },
    whatMatters: {
      da:
        'Scoren stiger når dine package.json-filer er fri for kendte CVEs. Den falder for hver ' +
        'sårbarhed npm-advisoren kender til i de pakker du bruger — prioriteret efter hvor alvorlig ' +
        'sårbarheden er.',
      en:
        'The score rises when your package.json files are free of known CVEs. It falls for every ' +
        'vulnerability the npm advisor knows about in the packages you use — prioritised by how serious ' +
        'the vulnerability is.',
    },
    verdict: verdicts(
      {
        da: 'Ingen kendte sårbarheder i de pakker du bruger.',
        en: 'No known vulnerabilities in the packages you use.',
      },
      {
        da: 'Et par pakker med kendte problemer — opdatér dem når du får tid.',
        en: 'A few packages with known issues — update them when you get the time.',
      },
      {
        da: 'Flere alvorlige sårbarheder i aktive dependencies. Opdatér før næste deploy.',
        en: 'Several serious vulnerabilities in active dependencies. Update before the next deploy.',
      },
    ),
  },

  platformCompliance: {
    label: { da: 'Platform-compliance', en: 'Platform compliance' },
    summary: {
      da: 'Hvad eksterne rådgivere (Supabase, GitHub, npm, Vercel) siger om dit setup.',
      en: 'What external advisors (Supabase, GitHub, npm, Vercel) say about your setup.',
    },
    whatMatters: {
      da:
        'Scoren stiger når Supabase RLS er aktiv, GitHub Dependabot er grøn, npm audit er ren, og ' +
        'Vercel ikke flagger noget. Den falder for hver finding de eksterne advisor-API\'er returnerer.',
      en:
        'The score rises when Supabase RLS is on, GitHub Dependabot is green, npm audit is clean, and ' +
        "Vercel isn't flagging anything. It falls for every finding the external advisor APIs return.",
    },
    verdict: verdicts(
      {
        da: 'Alle eksterne rådgivere melder klart.',
        en: 'All external advisors report clean.',
      },
      {
        da: 'Nogle advarsler fra mindst én platform — værd at kigge igennem.',
        en: 'Some warnings from at least one platform — worth reviewing.',
      },
      {
        da: 'Kritiske fund på eksterne platforme. Fix dem før de bliver til incidents.',
        en: 'Critical findings on external platforms. Fix them before they become incidents.',
      },
    ),
  },

  // -------- System-sundhed categories --------

  jobIntegrity: {
    label: { da: 'Job-integritet', en: 'Job integrity' },
    summary: {
      da: 'Om dine scheduled tasks faktisk kører, og om deres output bliver brugt.',
      en: 'Whether your scheduled tasks actually run, and whether their output is used.',
    },
    whatMatters: {
      da:
        'Scoren stiger når dine scheduled tasks (1) kører på deres planlagte tidspunkter og (2) har ' +
        'en dokumenteret modtager af deres output. Den falder hvis jobs stopper stille, eller hvis et ' +
        'job producerer data ingen læser.',
      en:
        'The score rises when your scheduled tasks (1) run at their planned times and (2) have ' +
        'a documented consumer of their output. It falls if jobs stop silently, or if a ' +
        'job produces data nobody reads.',
    },
    verdict: verdicts(
      {
        da: 'Alle jobs kører som de skal, og deres output bliver brugt.',
        en: 'All jobs run as they should, and their output is being used.',
      },
      {
        da: 'Et par jobs er ikke kørt for nyligt, eller deres output bruges ikke — undersøg hvad der sker.',
        en: "A few jobs haven't run recently, or their output isn't used — investigate what's happening.",
      },
      {
        da: 'Flere jobs er tavse eller orphaned. Du risikerer at miste data uden at opdage det.',
        en: 'Several jobs are silent or orphaned. You risk losing data without noticing.',
      },
    ),
  },

  artifactOverlap: {
    label: { da: 'Overlap mellem værktøjer', en: 'Overlap between tools' },
    summary: {
      da: 'Om du har næsten-dubletter af skills, hooks eller scheduled tasks der gør det samme.',
      en: 'Whether you have near-duplicates of skills, hooks or scheduled tasks doing the same thing.',
    },
    whatMatters: {
      da:
        'Scoren stiger når hvert værktøj har et unikt formål. Den falder hvis flere skills/tasks ' +
        'dækker samme jord — det skaber drift (de to versioner får forskellige regler over tid) og ' +
        'gør det uklart for mig hvilken der skal kaldes.',
      en:
        'The score rises when each tool has a unique purpose. It falls if multiple skills/tasks ' +
        'cover the same ground — that creates drift (the two versions get different rules over time) and ' +
        'makes it unclear to me which one to call.',
    },
    verdict: verdicts(
      {
        da: 'Ingen dubletter — hver skill og task har sit eget område.',
        en: 'No duplicates — every skill and task owns its own area.',
      },
      {
        da: 'Et par værktøjer overlapper. Merge dem eller vælg én.',
        en: 'A few tools overlap. Merge them or pick one.',
      },
      {
        da: 'Flere næsten-dubletter. Jeg risikerer at kalde den forkerte.',
        en: 'Several near-duplicates. I risk calling the wrong one.',
      },
    ),
  },

  dataClosure: {
    label: { da: 'Data-lukning', en: 'Data closure' },
    summary: {
      da: 'Om alt det der bliver produceret også bliver læst nogen steder.',
      en: 'Whether everything that gets produced is also read somewhere.',
    },
    whatMatters: {
      da:
        'Scoren stiger når hvert produces-output har en matching consumes et andet sted. Den falder ' +
        'hvis hooks skriver filer ingen læser, eller skills genererer data der aldrig bruges — klassiske ' +
        'hængende data-flows.',
      en:
        'The score rises when every produces-output has a matching consumes somewhere else. It falls ' +
        "if hooks write files nobody reads, or skills generate data that's never used — classic " +
        'dangling data flows.',
    },
    verdict: verdicts(
      {
        da: 'Alt det du producerer har en aftager.',
        en: 'Everything you produce has a consumer.',
      },
      {
        da: 'Et par hængende outputs. Ikke kritisk, men oprydning af dem forhindrer rod.',
        en: 'A few dangling outputs. Not critical, but cleaning them up prevents clutter.',
      },
      {
        da: 'Flere data-flows uden modtager. Du skriver til tomme rum.',
        en: "Several data flows with no receiver. You're writing into empty rooms.",
      },
    ),
  },

  configHealth: {
    label: { da: 'Config-sundhed', en: 'Config health' },
    summary: {
      da: 'Om dine skills faktisk kan kalde de MCP tools de henviser til.',
      en: 'Whether your skills can actually call the MCP tools they reference.',
    },
    whatMatters: {
      da:
        'Scoren stiger når alle `mcp__xxx__yyy` referencer i dine skills peger på MCP servere der ' +
        'faktisk er registreret. Den falder hvis skills kalder tools fra en server der ikke er ' +
        'installeret — de fejler stiltiende hver gang.',
      en:
        'The score rises when every `mcp__xxx__yyy` reference in your skills points to an MCP server ' +
        "that's actually registered. It falls if skills call tools from a server that isn't " +
        'installed — they fail silently every time.',
    },
    verdict: verdicts(
      {
        da: 'Alle MCP-referencer resolvér korrekt.',
        en: 'Every MCP reference resolves correctly.',
      },
      {
        da: 'Et par skills peger på tools der ikke findes. Registrér serveren eller fjern kaldene.',
        en: "A few skills point to tools that don't exist. Register the server or remove the calls.",
      },
      {
        da: 'Flere MCP-referencer peger på ikke-registrerede servere. Skills fejler tavst hver gang.',
        en: 'Several MCP references point to unregistered servers. Skills fail silently every time.',
      },
    ),
  },

  substrateHealth: {
    label: { da: 'Substrat-sundhed', en: 'Substrate health' },
    summary: {
      da: 'Om dine memory-filer har de rigtige headers, og om ~/.claude/ er backet op.',
      en: 'Whether your memory files have the right headers, and whether ~/.claude/ is backed up.',
    },
    whatMatters: {
      da:
        'Scoren stiger når memory-filer har frontmatter (så jeg loader dem rigtigt) og hele din ' +
        'agent-opsætning i ~/.claude/ er i version control. Den falder hvis memories ligger rodet ' +
        'eller hvis din Mac kunne lynnedbrændes med alt dit agent-arbejde tabt.',
      en:
        'The score rises when memory files have frontmatter (so I load them correctly) and your entire ' +
        'agent setup in ~/.claude/ is in version control. It falls if memories are scattered ' +
        'or if your Mac could go up in flames with all your agent work lost.',
    },
    verdict: verdicts(
      {
        da: 'Memories er velstrukturerede, og din opsætning er backet op.',
        en: 'Memories are well-structured, and your setup is backed up.',
      },
      {
        da: 'Et par memories mangler frontmatter eller backup er ikke fuldstændig.',
        en: 'A few memories lack frontmatter or your backup is incomplete.',
      },
      {
        da: 'Dele af din opsætning er sårbar — tabt ved næste disk-problem.',
        en: 'Parts of your setup are vulnerable — lost at the next disk problem.',
      },
    ),
  },
};

/**
 * Overall score verdict — one short sentence that frames the number.
 * Keeps the hero-tal from feeling like a standalone KPI without context.
 */
export function overallVerdict(score: number): LocalizedString {
  if (score >= 90) return {
    da: 'Stærkt samarbejde — der er kun få punkter at pudse.',
    en: 'Strong collaboration — only a few things to polish.',
  };
  if (score >= 75) return {
    da: 'Solidt samarbejde. Nogle ting at stramme op, ingen kriser.',
    en: 'Solid collaboration. A few things to tighten, no crises.',
  };
  if (score >= 60) return {
    da: 'OK udgangspunkt. Der er 1-2 ting du bør tage fat på først.',
    en: "Decent starting point. There are 1–2 things you should tackle first.",
  };
  return {
    da: 'Der er nogle grundlæggende ting vi bør have på plads. Tag dem i rækkefølge.',
    en: 'There are some fundamentals we should get in place. Take them in order.',
  };
}

/** Security-domain verdict — same tone as overallVerdict, scoped to security. */
export function securityVerdict(score: number): LocalizedString {
  if (score >= 90) return {
    da: 'Solid sikkerheds-hygiejne — de åbenlyse fælder er lukket.',
    en: 'Solid security hygiene — the obvious traps are closed.',
  };
  if (score >= 75) return {
    da: 'Overordnet sundt, men et par ting at stramme op på.',
    en: 'Broadly healthy, but a few things to tighten up.',
  };
  if (score >= 60) return {
    da: 'Der er nogle huller. Ikke alarmerende, men bør fikses.',
    en: "There are some gaps. Not alarming, but they should be fixed.",
  };
  return {
    da: 'Flere alvorlige fund. Start med de kritiske før noget andet.',
    en: 'Several serious findings. Start with the critical ones before anything else.',
  };
}

/** System-sundhed verdict — focused on coherence of the agent stack. */
export function systemHealthVerdict(score: number): LocalizedString {
  if (score >= 90) return {
    da: 'Setup\'et hænger sammen — værktøjer passer sammen og data flyder.',
    en: 'Your setup holds together — tools fit together and data flows.',
  };
  if (score >= 75) return {
    da: 'Stort set sammenhængende, men et par steder der har taget afsted.',
    en: 'Mostly coherent, but a few places that have drifted.',
  };
  if (score >= 60) return {
    da: 'Flere steder hvor dele af setup\'et ikke længere snakker ordentligt sammen.',
    en: 'Several places where parts of your setup no longer talk to each other properly.',
  };
  return {
    da: 'Dit setup er ved at falde fra hinanden. Ryd op før du bygger mere.',
    en: "Your setup is falling apart. Clean up before you build more.",
  };
}

export function explanationFor(key: string): CategoryExplanation | undefined {
  return CATEGORY_EXPLANATIONS[key];
}
