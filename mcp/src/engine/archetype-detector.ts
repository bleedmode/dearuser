// Archetype Detector — classifies a user's *setup shape* (orthogonal to persona).
//
// Persona = who the user is (vibe coder / senior dev / ...).
// Archetype = what their setup looks like (rule-heavy solo / automation orchard / ...).
//
// Deterministic, rule-based classifier — no LLM (Dear User is local-only).
// Evaluated as an ordered list of matchers; first match wins. That keeps the
// classification stable even when multiple archetypes would match, and makes
// tie-breaking explicit: the order encodes priority.
//
// Ordering rationale (top -> bottom):
//   1. "Fresh install" — too little data to classify anything else, wins first
//      so we don't falsely label a near-empty setup as e.g. "trust-and-go".
//   2. "Automation orchard" — the most distinctive shape once substrate exists;
//      schedules + hooks are rare and they dominate the feel of the setup.
//   3. "Polyglot stack" — many MCP servers across many stacks is a specific
//      shape we want to catch before generic rule-density classifications.
//   4. "Guardrail-first" vs "Trust-and-go" — these are diametric; we check
//      the extreme shapes before the more generic "Rule-heavy solo".
//   5. "Rule-heavy solo" — captures the common "big CLAUDE.md, one person"
//      pattern that isn't already a more specific archetype.
//   6. "Balanced" — fallback. Nothing about the setup is extreme.

import type { ArchetypeId, ArchetypeResult, AnalysisReport, ParseResult, ScanResult } from '../types.js';

interface ArchetypeDefinition {
  id: ArchetypeId;
  /** Short English identity label. */
  nameEn: string;
  /** Short Danish identity label. */
  nameDa: string;
  /** One sentence, letter-tone, Danish — feels like identity, not diagnosis. */
  description: string;
  /** 2-3 things this archetype tends to get right. */
  strengths: string[];
  /** 2-3 common failure modes. */
  watchouts: string[];
}

const ARCHETYPES: Record<ArchetypeId, ArchetypeDefinition> = {
  fresh_install: {
    id: 'fresh_install',
    nameEn: 'Fresh install',
    nameDa: 'Blankt lærred',
    description:
      'Du er lige startet. Dit setup er stadig en skitse — ingen forkerte valg endnu, kun plads til at bygge.',
    strengths: [
      'Ingen teknisk gæld at rydde op i — hver beslutning er ny',
      'Nemt at følge best practices fra starten',
    ],
    watchouts: [
      'Agenten kører på default-indstillinger — dine præferencer er usynlige',
      'Uden hooks, memory og regler gentager den samme fejl uge efter uge',
      'Risiko for at samle ting til senere i stedet for at begynde',
    ],
  },
  automation_orchard: {
    id: 'automation_orchard',
    nameEn: 'Automation orchard',
    nameDa: 'Automationsorkester',
    description:
      'Dit setup arbejder for dig. Scheduled tasks, hooks og skills kører i baggrunden og passer opgaverne mens du tænker på noget andet.',
    strengths: [
      'Stærk compound-effekt — små jobs producerer briefing hver morgen',
      'Feedback-loops indbygget i processen, ikke som efterrationalisering',
      'Skalerer bedre end én-agent setups når portefølje vokser',
    ],
    watchouts: [
      'Jobs kan dø stille — uden health-monitor opdager du det efter en uge',
      'Nye brugere får sjældent et setup som dit til at virke uden en guide',
      'Overlap mellem jobs skaber redundante tasks hvis ikke deduppet',
    ],
  },
  polyglot_stack: {
    id: 'polyglot_stack',
    nameEn: 'Polyglot stack',
    nameDa: 'Flersproget stak',
    description:
      'Du jonglerer flere økosystemer. Mange MCP-servere, flere programmeringssprog, ingen enkelt stack der dominerer.',
    strengths: [
      'Bredt værktøjsbælte — du vælger det rigtige per opgave',
      'Ingen lock-in — du kan flytte mellem projekter uden at starte forfra',
    ],
    watchouts: [
      'Context-switching koster — agenten skal genlære stacken hver gang',
      'Versionskonflikter og dependencies multiplicerer på tværs af projekter',
      'Skills der passer perfekt til ét sprog blokerer optimering i et andet',
    ],
  },
  guardrail_first: {
    id: 'guardrail_first',
    nameEn: 'Guardrail-first',
    nameDa: 'Sikkerhed først',
    description:
      'Du leder med forbud. Din CLAUDE.md fortæller først hvad agenten IKKE må — den autonome del kommer efter.',
    strengths: [
      'Lav risiko for destruktive fejl — agenten rammer rødder før den handler',
      'Klart defineret scope — færre overraskelser i PR-reviews',
    ],
    watchouts: [
      'Agenten spørger om ting den trygt kunne løse selv — du bliver flaskehals',
      'Negative-only regler mangler ofte begrundelse — de bliver ignoreret over tid',
      'Mere friktion i onboarding — samarbejdet føles som overvågning',
    ],
  },
  trust_and_go: {
    id: 'trust_and_go',
    nameEn: 'Trust-and-go',
    nameDa: 'Tillid og fart',
    description:
      'Du giver agenten frie tøjler. Mange "gør-selv" regler, få forbud — du tror mere på hastighed end på kontrol.',
    strengths: [
      'Høj velocity — agenten leverer uden at vente på godkendelse',
      'Du bruger ikke tid på mikromanagement — energien går til retning',
    ],
    watchouts: [
      'Ingen stopklods når agenten misforstår scope — rollback bliver dyrt',
      'Sikkerhedsfejl (secrets, destruktive commands) ryger let igennem',
      'Uden feedback-loop glemmer agenten hvad der gik galt sidste gang',
    ],
  },
  rule_heavy_solo: {
    id: 'rule_heavy_solo',
    nameEn: 'Rule-heavy solo',
    nameDa: 'Regel-tung solo',
    description:
      'Din CLAUDE.md gør tænkningen. Du arbejder alene, og alt hvad du har lært lever i én stor instruktionsfil frem for i hooks eller automation.',
    strengths: [
      'Kontekst er altid tilgængelig — agenten starter hver session velinformeret',
      'Nye læringer kan skrives direkte ind — ingen infrastruktur kræves',
    ],
    watchouts: [
      'Regler der ikke håndhæves af hooks bliver "mental-note" og bliver ignoreret',
      'Filen vokser indtil den bliver sit eget problem — duplikater, modsigelser',
      'Alt tacit — ingen anden kan arve dit setup uden dig ved siden af',
    ],
  },
  balanced: {
    id: 'balanced',
    nameEn: 'Balanced',
    nameDa: 'Afbalanceret',
    description:
      'Dit setup har lidt af det hele. Ingen enkelt dimension dominerer — regler, automation og skills står i rimelig proportion.',
    strengths: [
      'Intet ekstremt failure mode — setup er modstandsdygtigt over tid',
      'Nemt at forklare til andre — intet kræver lang indvielse',
    ],
    watchouts: [
      'Risiko for middelmådighed — ingen dimension er særlig stærk',
      'Kan gro i alle retninger samtidig — uden fokus bliver alt halvfærdigt',
    ],
  },
};

const FRESH_INSTALL_THRESHOLD = 20;

interface Signals {
  totalArtifacts: number;
  rulesTotal: number;
  doCount: number;
  askCount: number;
  suggestCount: number;
  neverCount: number;
  hooksCount: number;
  skillsCount: number;
  scheduledTasksCount: number;
  mcpServersCount: number;
  memoryFiles: number;
  projectCount: number;
  stacksDetected: number;
  teamSignal: boolean;
}

/**
 * Heuristic stack detection from installed MCP servers + parsed content.
 * We count this at the "ecosystem" level — TypeScript/JS, Python, Go, Rust,
 * mobile (iOS/Swift + RN/Expo), Ruby, etc. Not exhaustive; just enough to
 * decide "one stack" vs "many".
 */
function countStacks(parsed: ParseResult, scan: ScanResult): number {
  const text = [
    ...parsed.rules.map(r => r.text),
    ...parsed.sections.map(s => s.content),
  ].join(' ').toLowerCase();
  const serverBlob = scan.installedServers.join(' ').toLowerCase();

  const stackPatterns: Array<{ name: string; re: RegExp }> = [
    { name: 'js_ts', re: /\b(typescript|javascript|node\.?js|npm|pnpm|yarn|next\.?js|vite|react|vue|svelte|astro|expo|react.?native)\b/ },
    { name: 'python', re: /\b(python|pip|poetry|django|flask|fastapi|pytest)\b/ },
    { name: 'go', re: /\b(golang|go\.mod|go build|go test)\b/ },
    { name: 'rust', re: /\b(rust|cargo|rustc|clippy)\b/ },
    { name: 'ruby', re: /\b(ruby|rails|gem install|bundler)\b/ },
    { name: 'java_kt', re: /\b(java|kotlin|gradle|maven|spring)\b/ },
    { name: 'swift', re: /\b(swift|swiftui|xcode|xcodebuild|ios)\b/ },
    { name: 'php', re: /\b(php|composer|laravel|symfony)\b/ },
    { name: 'csharp', re: /\b(c#|\.net|dotnet|nuget)\b/ },
  ];

  let count = 0;
  for (const { re } of stackPatterns) {
    if (re.test(text) || re.test(serverBlob)) count++;
  }
  return count;
}

function detectTeamSignal(parsed: ParseResult): boolean {
  const text = parsed.rules.map(r => r.text).join(' ') + ' ' + parsed.sections.map(s => s.content).join(' ');
  // Real team signals — not just the word "team" floating in general prose.
  return /\b(code.?review|pr.?review|shared.?standard|team.?lead|team.?workflow|on.?call|multiple.?humans|team.?member)\b/i.test(text);
}

function extractSignals(parsed: ParseResult, scan: ScanResult): Signals {
  const doCount = parsed.rules.filter(r => r.type === 'do_autonomously').length;
  const askCount = parsed.rules.filter(r => r.type === 'ask_first').length;
  const suggestCount = parsed.rules.filter(r => r.type === 'suggest_only').length;
  const neverCount = parsed.rules.filter(r => r.type === 'prohibition').length;

  const totalArtifacts =
    parsed.rules.length +
    scan.hooksCount +
    scan.skillsCount +
    scan.scheduledTasksCount +
    scan.commandsCount +
    scan.memoryFiles.length;

  return {
    totalArtifacts,
    rulesTotal: parsed.rules.length,
    doCount,
    askCount,
    suggestCount,
    neverCount,
    hooksCount: scan.hooksCount,
    skillsCount: scan.skillsCount,
    scheduledTasksCount: scan.scheduledTasksCount,
    mcpServersCount: scan.mcpServersCount,
    memoryFiles: scan.memoryFiles.length,
    projectCount: parsed.projectCount,
    stacksDetected: countStacks(parsed, scan),
    teamSignal: detectTeamSignal(parsed),
  };
}

type Matcher = {
  id: ArchetypeId;
  matches: (s: Signals) => boolean;
};

// Ordered priority list — first match wins. See file header for rationale.
const MATCHERS: Matcher[] = [
  {
    id: 'fresh_install',
    matches: (s) => s.totalArtifacts < FRESH_INSTALL_THRESHOLD,
  },
  {
    id: 'automation_orchard',
    // Originally required both hooks >= 3 AND scheduled >= 5. Dogfooding the
    // live setup (15 schedules, 1 hook, 168 rules) surfaced that this is too
    // strict: a portfolio operator can lean heavily on schedules+skills with
    // few hooks and still obviously fit the "orchard" shape. Broaden to any of:
    //   - many scheduled tasks paired with some automation (hooks or many skills)
    //   - or heavy hooks+scheduled combo (original intent).
    matches: (s) =>
      (s.scheduledTasksCount >= 5 && (s.hooksCount >= 3 || s.skillsCount >= 8)) ||
      (s.scheduledTasksCount >= 10 && s.skillsCount >= 3),
  },
  {
    id: 'polyglot_stack',
    matches: (s) => s.mcpServersCount >= 5 && s.stacksDetected >= 3,
  },
  {
    id: 'guardrail_first',
    matches: (s) => s.neverCount >= 8 && s.doCount < 5,
  },
  {
    id: 'trust_and_go',
    matches: (s) => s.doCount >= 10 && s.neverCount < 3,
  },
  {
    id: 'rule_heavy_solo',
    matches: (s) => s.rulesTotal >= 15 && !s.teamSignal && s.scheduledTasksCount < 3,
  },
];

/**
 * Classify a setup into one of the named archetypes.
 * Always returns a result — "balanced" is the fallback when nothing matches.
 */
export function detectArchetype(parsed: ParseResult, scan: ScanResult): ArchetypeResult {
  const signals = extractSignals(parsed, scan);

  let matchedId: ArchetypeId = 'balanced';
  const matchedReasons: string[] = [];

  for (const matcher of MATCHERS) {
    if (matcher.matches(signals)) {
      matchedId = matcher.id;
      matchedReasons.push(...reasonsFor(matcher.id, signals));
      break;
    }
  }

  if (matchedId === 'balanced') {
    matchedReasons.push('No dimension is extreme — rules, automation, and substrate are in rough balance.');
  }

  const def = ARCHETYPES[matchedId];
  return {
    id: def.id,
    nameEn: def.nameEn,
    nameDa: def.nameDa,
    description: def.description,
    strengths: def.strengths,
    watchouts: def.watchouts,
    reasons: matchedReasons,
    signals: {
      totalArtifacts: signals.totalArtifacts,
      rulesTotal: signals.rulesTotal,
      doCount: signals.doCount,
      neverCount: signals.neverCount,
      hooksCount: signals.hooksCount,
      scheduledTasksCount: signals.scheduledTasksCount,
      mcpServersCount: signals.mcpServersCount,
      stacksDetected: signals.stacksDetected,
    },
  };
}

function reasonsFor(id: ArchetypeId, s: Signals): string[] {
  switch (id) {
    case 'fresh_install':
      return [`Only ${s.totalArtifacts} artifacts in total — below the ${FRESH_INSTALL_THRESHOLD} threshold for a settled setup.`];
    case 'automation_orchard':
      return [
        `${s.scheduledTasksCount} scheduled tasks, ${s.hooksCount} hook${s.hooksCount === 1 ? '' : 's'}, ${s.skillsCount ?? 0} skill${(s.skillsCount ?? 0) === 1 ? '' : 's'} — automation dominates.`,
      ];
    case 'polyglot_stack':
      return [`${s.mcpServersCount} MCP servers across ${s.stacksDetected} detected stacks.`];
    case 'guardrail_first':
      return [`${s.neverCount} prohibitions vs ${s.doCount} autonomous rules — guardrails outweigh autonomy.`];
    case 'trust_and_go':
      return [`${s.doCount} autonomous rules, only ${s.neverCount} prohibitions — heavy on trust.`];
    case 'rule_heavy_solo':
      return [`${s.rulesTotal} rules, no team signals, light on scheduled automation.`];
    default:
      return [];
  }
}

/**
 * Public helper for consumers (e.g. the Wrapped tool) that only have an
 * AnalysisReport handle, not the raw ParseResult/ScanResult. Returns the
 * archetype field from the report — which analyze.ts populates.
 *
 * Prefer this over reaching into `report.archetype` directly so we can
 * change the field name later without a cross-tool migration.
 */
export function getArchetype(report: AnalysisReport): ArchetypeResult | undefined {
  return report.archetype;
}

// Exposed for tests / dogfood scripts.
export const ARCHETYPE_DEFINITIONS = ARCHETYPES;
