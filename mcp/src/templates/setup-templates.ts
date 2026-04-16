// setup-templates — content the onboard tool emits at the plan step.
// Templates are keyed by role. The plan generator merges these with
// user-provided answers (goals, pains, substrate decision) to produce
// the final setup-plan text.

export type Role = 'coder' | 'occasional' | 'non_coder';

export interface SetupTemplate {
  claudeMdSections: Array<{ heading: string; body: string }>;
  suggestedSkills: Array<{ name: string; why: string; install: string }>;
  suggestedHooks: Array<{ name: string; why: string; where: string }>;
  nextSteps: string[];
}

// ============================================================================
// Shared building blocks
// ============================================================================

const COMMON_SKILLS = {
  learn: {
    name: '/learn',
    why: 'Captures session lessons into memory automatically — so corrections don\'t get lost between sessions.',
    install: 'Create ~/.claude/skills/learn/SKILL.md — see https://github.com/bleedmode/dearuser for a template',
  },
  standup: {
    name: '/standup',
    why: 'Daily orientation — status of projects, tasks, git state in one command.',
    install: 'Create ~/.claude/skills/standup/SKILL.md with project paths and task CLI',
  },
  ship: {
    name: '/ship',
    why: 'Bundles build + test + commit + push into one safe flow. Fewer ways to ship broken code.',
    install: 'Create ~/.claude/skills/ship/SKILL.md — runs tests first, commits if green',
  },
  research: {
    name: '/research',
    why: 'Structured research with quality gates (Collect → Rate → Analyze). Prevents AI-generated slop from contaminating future work.',
    install: 'Create ~/.claude/skills/research/SKILL.md with a 3-phase prompt',
  },
  dearuser: {
    name: '/dearuser-analyze (+ audit, security, wrapped, help)',
    why: 'Reliable slash commands for all Dear User tools. Without these, MCP tool discovery is flaky — the agent may not find the tools.',
    install: 'Copy the skill files from https://github.com/bleedmode/dearuser/tree/main/skills into ~/.claude/skills/',
  },
};

const COMMON_HOOKS = {
  buildCheck: {
    name: 'post-edit build check',
    why: 'Runs your build after every file edit — catches syntax errors immediately.',
    where: '~/.claude/settings.json → hooks.PostToolUse',
  },
  protectedFiles: {
    name: 'protected-files guard',
    why: 'Blocks writes to sensitive paths (.env, credentials, production configs) unless you explicitly confirm.',
    where: '~/.claude/settings.json → hooks.PreToolUse',
  },
  destructiveCommandGuard: {
    name: 'destructive-command blocker',
    why: 'Prevents rm -rf, git force-push, etc. without explicit confirmation.',
    where: '~/.claude/settings.json → hooks.PreToolUse matching Bash',
  },
};

// ============================================================================
// Role-specific templates
// ============================================================================

const CODER_TEMPLATE: SetupTemplate = {
  claudeMdSections: [
    {
      heading: '## Role',
      body: '- I write code regularly; speed and correctness both matter.\n- Treat me as a technical peer — skip basic explanations.',
    },
    {
      heading: '## Autonomy',
      body: '- DO autonomously: formatting, lint fixes, writing tests for new functions, running the build.\n- ASK FIRST: adding dependencies, schema changes, public API changes, destructive git operations.\n- SUGGEST ONLY: architectural changes, tech choices, UX decisions.',
    },
    {
      heading: '## Quality',
      body: '- Build must pass before shipping.\n- Existing tests must stay green.\n- Write a test when you fix a bug.',
    },
    {
      heading: '## Communication',
      body: '- Be concise. File paths + line numbers > prose.\n- No marketing-speak. No apologies. Just status + next step.',
    },
  ],
  suggestedSkills: [COMMON_SKILLS.dearuser, COMMON_SKILLS.ship, COMMON_SKILLS.learn, COMMON_SKILLS.standup],
  suggestedHooks: [COMMON_HOOKS.buildCheck, COMMON_HOOKS.destructiveCommandGuard],
  nextSteps: [
    'Install the Dear User skills — copy skills/ from the repo into ~/.claude/skills/ so /dearuser-analyze always works',
    'Create ~/.claude/CLAUDE.md with the sections above filled in',
    'Add the build-check hook so syntax errors surface immediately',
  ],
};

const OCCASIONAL_TEMPLATE: SetupTemplate = {
  claudeMdSections: [
    {
      heading: '## Role',
      body: '- I work across code and product decisions.\n- When coding, explain the trade-offs in 1-2 sentences. When deciding, give me options not conclusions.',
    },
    {
      heading: '## Autonomy',
      body: '- DO autonomously: research, summarising, drafting content, running safe commands.\n- ASK FIRST: any code change that touches production, any external communication, any cost-incurring action.\n- SUGGEST ONLY: strategic decisions, tech stack choices.',
    },
    {
      heading: '## Communication',
      body: '- Default to showing work: 2-3 options with trade-offs, then recommend one.\n- Short paragraphs. Tables when comparing options.',
    },
    {
      heading: '## Quality',
      body: '- Built things must work on first try when handed to me — no "should work" hand-waves.\n- If unsure, say so and suggest a small test first.',
    },
  ],
  suggestedSkills: [COMMON_SKILLS.dearuser, COMMON_SKILLS.standup, COMMON_SKILLS.learn, COMMON_SKILLS.research],
  suggestedHooks: [COMMON_HOOKS.protectedFiles],
  nextSteps: [
    'Install the Dear User skills — copy skills/ from the repo into ~/.claude/skills/ so /dearuser-analyze always works',
    'Create ~/.claude/CLAUDE.md — keep it under 200 lines',
    'Add protected-files hook for .env and credentials before you experiment more',
  ],
};

const NON_CODER_TEMPLATE: SetupTemplate = {
  claudeMdSections: [
    {
      heading: '## Role',
      body: '- I don\'t write code but I use AI seriously for my work.\n- Explain technical concepts plainly — assume domain expertise, not tech expertise.',
    },
    {
      heading: '## Communication',
      body: '- Plain language. No jargon.\n- When showing something technical, explain the outcome before the mechanism.\n- Ask me what I want before you build. Never guess at scope.',
    },
    {
      heading: '## Autonomy',
      body: '- DO autonomously: research, drafting emails, summarising documents, analysing spreadsheets.\n- ASK FIRST: anything involving my accounts, calendars, or third parties.\n- NEVER: send anything on my behalf without explicit confirmation.',
    },
    {
      heading: '## Quality',
      body: '- When you\'re unsure, say so clearly — don\'t guess.\n- If a task looks bigger than we discussed, pause and check in.',
    },
  ],
  suggestedSkills: [COMMON_SKILLS.dearuser, COMMON_SKILLS.research, COMMON_SKILLS.learn],
  suggestedHooks: [COMMON_HOOKS.protectedFiles],
  nextSteps: [
    'Install the Dear User skills — copy skills/ from the repo into ~/.claude/skills/ so /dearuser-analyze always works',
    'Create a CLAUDE.md — start with the 4 sections above, edit as you learn what you want',
    'Don\'t add more than 3 skills in your first month. Add when you feel the friction.',
  ],
};

// ============================================================================
// Public API
// ============================================================================

export function getSetupTemplate(role: Role): SetupTemplate {
  switch (role) {
    case 'coder': return CODER_TEMPLATE;
    case 'occasional': return OCCASIONAL_TEMPLATE;
    case 'non_coder': return NON_CODER_TEMPLATE;
  }
}

/**
 * Render a SetupTemplate as markdown, interpolating the user's answers.
 * The substrate decision string is rendered as-is (we let substrate-advisor
 * build the actual recommendation).
 */
export function renderPlan(
  template: SetupTemplate,
  answers: { goals: string | null; pains: string | null; substrateSummary: string | null },
): string {
  const lines: string[] = [
    '# Your Tailored Dear User Setup Plan',
    '',
    '## Based on what you told me',
    '',
  ];

  if (answers.goals) lines.push(`- **Your goal:** ${answers.goals}`);
  if (answers.pains) lines.push(`- **Biggest pain:** ${answers.pains}`);
  if (answers.substrateSummary) lines.push(`- **Recommended substrate:** ${answers.substrateSummary}`);

  lines.push('', '## Your CLAUDE.md starter', '');
  lines.push('Copy this to `~/.claude/CLAUDE.md` (create the file if it doesn\'t exist).', '');
  lines.push('```markdown');
  lines.push('# My Claude Instructions');
  for (const section of template.claudeMdSections) {
    lines.push('');
    lines.push(section.heading);
    lines.push('');
    lines.push(section.body);
  }
  lines.push('```');

  if (template.suggestedSkills.length > 0) {
    lines.push('', '## Skills to add (start with one)', '');
    for (const skill of template.suggestedSkills) {
      lines.push(`### ${skill.name}`);
      lines.push(`**Why:** ${skill.why}`);
      lines.push(`**How:** ${skill.install}`);
      lines.push('');
    }
  }

  if (template.suggestedHooks.length > 0) {
    lines.push('## Hooks to add (safety first)', '');
    for (const hook of template.suggestedHooks) {
      lines.push(`### ${hook.name}`);
      lines.push(`**Why:** ${hook.why}`);
      lines.push(`**Where:** ${hook.where}`);
      lines.push('');
    }
  }

  lines.push('## Your next 3 steps', '');
  for (let i = 0; i < template.nextSteps.length; i++) {
    lines.push(`${i + 1}. ${template.nextSteps[i]}`);
  }

  lines.push(
    '',
    '---',
    '',
    '*You can re-run this dialog any time to refine your setup. Run `dearuser analyze` after a week or two to see how it\'s going.*',
  );

  return lines.join('\n');
}
