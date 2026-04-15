// substrate-advisor — classify a user's data description into the right storage
// substrate. Called from the onboard tool's substrate step, but also usable
// standalone in future tools (e.g. audit's substrate_mismatch detector could
// call this for richer recommendations).
//
// The advisor is deliberately opinionated. Non-technical users need *a* right
// answer, not a menu. When the description is ambiguous, we pick the safest
// default (CLAUDE.md for rules, memory for learnings) and explain why.

export type Substrate =
  | 'claude_md'       // narrative rules/preferences read every session
  | 'memory_file'     // lessons, feedback, context — loaded by /learn skill
  | 'database'        // structured rows — SQLite locally, Supabase remote
  | 'document'        // formatted docs humans also consume (Notion, GDocs)
  | 'jsonl_log'       // append-only time-series (daily events, run results)
  | 'git_file';       // config/code-adjacent, versioned, shared

export interface SubstrateRecommendation {
  primary: Substrate;
  secondary: Substrate | null;  // fallback if primary doesn't fit
  confidence: 'high' | 'medium' | 'low';
  why: string;
  example: string;              // concrete example showing how this maps to their description
  antiPattern: string;           // what NOT to do — the failure mode we're steering around
  stepsToApply: string[];       // 2-3 concrete steps
}

// ============================================================================
// Pattern library — keyword → substrate signals
// ============================================================================

interface Pattern {
  substrate: Substrate;
  keywords: string[];         // English + Danish
  weight: number;
}

const PATTERNS: Pattern[] = [
  // Rules / preferences → CLAUDE.md
  {
    substrate: 'claude_md',
    weight: 3,
    keywords: [
      'rule', 'rules', 'preference', 'preferences', 'instruction', 'instructions',
      'always do', 'never do', 'should do', 'standard', 'convention',
      'regler', 'foretrukne', 'foretrukket', 'standard', 'altid', 'aldrig',
    ],
  },
  // Learnings / feedback → memory
  {
    substrate: 'memory_file',
    weight: 3,
    keywords: [
      'learning', 'learnings', 'lesson', 'lessons', 'feedback', 'correction', 'mistake',
      'remember', 'reminder', 'note to self', 'insight', 'takeaway',
      'læring', 'lektion', 'fejl', 'husk', 'indsigt', 'erfaring',
    ],
  },
  // Structured lists → database
  {
    substrate: 'database',
    weight: 3,
    keywords: [
      'list', 'lists', 'task', 'tasks', 'todo', 'bug', 'bugs', 'issue', 'issues',
      'contact', 'contacts', 'client', 'clients', 'customer', 'inventory',
      'record', 'records', 'entry', 'entries', 'row', 'rows', 'table', 'tables',
      'source', 'sources', 'lead', 'leads', 'candidate', 'candidates',
      'liste', 'opgave', 'opgaver', 'fejl', 'kunde', 'kunder', 'kilde', 'kilder',
      'poster', 'række', 'rækker', 'tabel',
    ],
  },
  // Documents → Notion/Google Docs
  {
    substrate: 'document',
    weight: 3,
    keywords: [
      'doc', 'docs', 'document', 'documents', 'contract', 'contracts', 'proposal',
      'proposals', 'brief', 'briefs', 'report', 'reports', 'article', 'articles',
      'memo', 'memos', 'spec', 'specs', 'specification', 'draft', 'drafts',
      'dokument', 'dokumenter', 'kontrakt', 'forslag', 'rapport', 'artikel', 'notat',
    ],
  },
  // Time-series → JSONL
  {
    substrate: 'jsonl_log',
    weight: 3,
    keywords: [
      'log', 'logs', 'daily', 'standup', 'journal', 'history', 'events',
      'run', 'runs', 'session', 'sessions', 'activity', 'timeline',
      'hver dag', 'dagligt', 'historik', 'begivenhed', 'løbende',
    ],
  },
  // Config → git
  {
    substrate: 'git_file',
    weight: 3,
    keywords: [
      'config', 'configuration', 'settings', 'schema', 'versioned', 'shared',
      'yaml', 'json config', 'dotfile',
      'konfiguration', 'indstillinger', 'delt', 'versioneret',
    ],
  },
];

// Structural signals — patterns that shift the classification regardless of
// keywords. E.g., describing numeric growth ("hundreds of...") tilts toward
// database even if other keywords don't.
interface StructuralSignal {
  pattern: RegExp;
  substrate: Substrate;
  weight: number;
  reason: string;
}

const STRUCTURAL_SIGNALS: StructuralSignal[] = [
  {
    pattern: /\b\d{2,}\+?\s*(items|entries|rows|records|contacts|tasks|customers|bugs)/i,
    substrate: 'database',
    weight: 4,
    reason: 'describes dozens/hundreds of items — too many for a flat file',
  },
  {
    pattern: /\b(filter|query|search|sort|group by|count|aggregate|where)\b/i,
    substrate: 'database',
    weight: 4,
    reason: 'requires querying',
  },
  {
    pattern: /\b(append|over time|every day|every week|daily|weekly)\b/i,
    substrate: 'jsonl_log',
    weight: 2,
    reason: 'accumulates over time',
  },
  {
    pattern: /\b(format|formatted|bold|italic|headings?|bullet|table|layout|template)\b/i,
    substrate: 'document',
    weight: 2,
    reason: 'formatting matters',
  },
  {
    pattern: /\b(share with|shared with|collaborator|team member|client reads)\b/i,
    substrate: 'document',
    weight: 3,
    reason: 'other humans also read this',
  },
  {
    pattern: /\b(session|context|claude should know|agent should remember)\b/i,
    substrate: 'claude_md',
    weight: 2,
    reason: 'agent needs this every session',
  },
];

// ============================================================================
// Classification
// ============================================================================

function scoreSubstrates(description: string): Record<Substrate, number> {
  const text = description.toLowerCase();
  const scores: Record<Substrate, number> = {
    claude_md: 0,
    memory_file: 0,
    database: 0,
    document: 0,
    jsonl_log: 0,
    git_file: 0,
  };

  // Keyword scoring
  for (const pattern of PATTERNS) {
    for (const keyword of pattern.keywords) {
      const re = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (re.test(text)) {
        scores[pattern.substrate] += pattern.weight;
      }
    }
  }

  // Structural scoring
  for (const sig of STRUCTURAL_SIGNALS) {
    if (sig.pattern.test(text)) {
      scores[sig.substrate] += sig.weight;
    }
  }

  return scores;
}

// ============================================================================
// Explanation templates — short, human, opinionated
// ============================================================================

interface SubstrateTemplate {
  why: string;
  exampleFn: (desc: string) => string;
  antiPattern: string;
  steps: string[];
}

const TEMPLATES: Record<Substrate, SubstrateTemplate> = {
  claude_md: {
    why: 'Rules and preferences need to reach your agent at the start of every session. CLAUDE.md is the one file the agent reads before anything else — perfect for short, stable guidance.',
    exampleFn: (d) => `Add a section to ~/.claude/CLAUDE.md like:\n\n\`\`\`\n## ${d.slice(0, 40)}\n- Specific rule #1\n- Specific rule #2\n\`\`\``,
    antiPattern: 'Putting rules in a memory file. Memory is for lessons learned, not standing instructions — the agent won\'t necessarily load it at session start.',
    steps: [
      'Open ~/.claude/CLAUDE.md (create if missing)',
      'Add a section with a clear heading and 3-5 concrete rules',
      'Keep it under 200 lines total — the agent reads this every session, so brevity pays',
    ],
  },
  memory_file: {
    why: 'Lessons, corrections, and context that accrue over time belong in memory files. They don\'t need to load every session — the /learn skill surfaces them when relevant.',
    exampleFn: () => `Create ~/.claude/projects/<project>/memory/feedback_<topic>.md with:\n\n\`\`\`\n---\nname: <topic>\ndescription: one-line summary\ntype: feedback\n---\n\n{lesson content}\n\`\`\``,
    antiPattern: 'Stuffing every lesson into CLAUDE.md. It bloats, the agent loads it every session, and you lose the ability to retrieve specific lessons on demand.',
    steps: [
      'Install the /learn skill if not already',
      'When a correction or lesson comes up, run /learn — it captures it to memory',
      'Memory files can be revisited and edited; they\'re narrative, not structured',
    ],
  },
  database: {
    why: 'Lists that grow, need filtering, or are counted/aggregated belong in a real database. SQLite works for local solo use; Supabase when you need shared or remote access.',
    exampleFn: (d) => `For "${d.slice(0, 60)}" — create a Supabase table with typed columns. Example schema:\n\n\`\`\`sql\nCREATE TABLE items (\n  id SERIAL PRIMARY KEY,\n  title TEXT NOT NULL,\n  status TEXT,\n  created_at TIMESTAMP DEFAULT now()\n);\n\`\`\``,
    antiPattern: 'Keeping the list in a markdown file. You can\'t query, filter, or count without parsing — and after 50 entries it\'s unreadable to both you and the agent.',
    steps: [
      'Create a Supabase project (free tier works)',
      'Write the schema: tables + typed columns + timestamps',
      'Expose it to your agent as an MCP server (supabase-mcp or a custom wrapper)',
    ],
  },
  document: {
    why: 'Content that needs formatting or is read by humans alongside the agent belongs in a document tool. Notion and Google Docs both have AI integrations; the content stays legible and editable without forcing everything through Claude.',
    exampleFn: (d) => `Create a Notion page for "${d.slice(0, 60)}". Give the agent read access via the Notion MCP server or embed links in CLAUDE.md.`,
    antiPattern: 'Dumping long-form content into CLAUDE.md or memory. It bloats context, loses formatting, and humans can\'t easily collaborate on it.',
    steps: [
      'Pick the tool (Notion or Google Docs) and create the page/doc',
      'Install the corresponding MCP server so the agent can read it',
      'Reference the doc from CLAUDE.md so the agent knows it exists',
    ],
  },
  jsonl_log: {
    why: 'Time-series data (daily standups, run logs, events) appends forever. JSONL is one record per line — fast to append, easy to tail, and any tool can parse it.',
    exampleFn: (d) => `Create a file like ~/.dearuser/${d.slice(0, 20).replace(/\s+/g, '-')}.jsonl and append one JSON object per event:\n\n\`\`\`jsonl\n{"date":"2026-04-14","event":"X","count":5}\n{"date":"2026-04-15","event":"Y","count":3}\n\`\`\``,
    antiPattern: 'Appending to a markdown file. After 6 months you have a 500KB file nobody can parse consistently, and the agent has no way to query "last 7 days".',
    steps: [
      'Decide what goes in one record (date + the 2-3 fields you need)',
      'Write an append hook or scheduled task that adds one line per event',
      'Read it back with simple jq filters or a tiny script',
    ],
  },
  git_file: {
    why: 'Configuration, schemas, and shared settings need version control — you need to see what changed, roll back, and share with teammates or machines.',
    exampleFn: (d) => `Create a \`config.yaml\` in the relevant repo for "${d.slice(0, 60)}" and commit every change. Reference it from CLAUDE.md so the agent knows it\'s authoritative.`,
    antiPattern: 'Keeping config in CLAUDE.md or a memory file. You lose versioning, diff-ability, and the ability to roll back a broken config.',
    steps: [
      'Put the file in a git repo (even a personal one)',
      'Commit every change with a meaningful message',
      'Reference it from CLAUDE.md so the agent knows where to look',
    ],
  },
};

// ============================================================================
// Public API
// ============================================================================

export function classifySubstrate(description: string): SubstrateRecommendation {
  if (!description || description.trim().length < 3) {
    return {
      primary: 'claude_md',
      secondary: 'memory_file',
      confidence: 'low',
      why: 'Not enough context in your description to classify confidently. Default: rules and preferences go in CLAUDE.md, learnings go in memory files.',
      example: 'Tell me more about the data — what does each entry look like? How many entries do you expect? Who reads it?',
      antiPattern: 'Picking a substrate without understanding the data — you often need to migrate later.',
      stepsToApply: [
        'Describe one concrete example of the data',
        'Think about: how many entries, how often it grows, who reads it',
        'Come back with that clarity',
      ],
    };
  }

  const scores = scoreSubstrates(description);
  const ranked = (Object.entries(scores) as Array<[Substrate, number]>)
    .sort((a, b) => b[1] - a[1]);

  const [primary, primaryScore] = ranked[0];
  const [secondary, secondaryScore] = ranked[1];

  let confidence: SubstrateRecommendation['confidence'];
  if (primaryScore === 0) {
    confidence = 'low';
  } else if (primaryScore - secondaryScore >= 3) {
    confidence = 'high';
  } else if (primaryScore >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const chosen = primaryScore === 0 ? 'claude_md' : primary;
  const tpl = TEMPLATES[chosen];

  return {
    primary: chosen,
    secondary: secondaryScore > 0 ? secondary : null,
    confidence,
    why: tpl.why,
    example: tpl.exampleFn(description),
    antiPattern: tpl.antiPattern,
    stepsToApply: tpl.steps,
  };
}

/** Human label for a substrate. Used in UI text. */
export function substrateLabel(s: Substrate): string {
  switch (s) {
    case 'claude_md': return 'CLAUDE.md (rules your agent reads every session)';
    case 'memory_file': return 'memory file (lessons & feedback, loaded on demand)';
    case 'database': return 'database (SQLite or Supabase, for structured lists)';
    case 'document': return 'document tool (Notion / Google Docs, for formatted content)';
    case 'jsonl_log': return 'JSONL log (append-only time-series)';
    case 'git_file': return 'git-tracked file (config that needs versioning)';
  }
}
