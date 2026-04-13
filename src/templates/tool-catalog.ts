// Tool Catalog — curated MCP servers, skills, and repos mapped to specific problems
// Updated: 2026-04-13
// Source: verified GitHub stars + manual review

export interface ToolRecommendation {
  name: string;
  type: 'mcp_server' | 'skill' | 'github_repo' | 'hook';
  description: string;
  install: string;
  stars?: number;
  url?: string;
  solves: string[];  // problem IDs this tool addresses
  personas: string[];  // which personas benefit most
  lastVerified: string;  // YYYY-MM-DD
}

export const TOOL_CATALOG: ToolRecommendation[] = [
  // === MCP Servers: Documentation/Context ===
  {
    name: 'Context7',
    type: 'mcp_server',
    description: 'Fresh, version-specific library documentation. Stops hallucinated API calls.',
    install: 'claude mcp add context7 -- npx -y @upstash/context7-mcp@latest',
    stars: 52480,
    url: 'https://github.com/upstash/context7',
    solves: ['hallucination', 'outdated_docs', 'wrong_api'],
    personas: ['senior_dev', 'indie_hacker', 'venture_studio', 'vibe_coder', 'team_lead'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Exa Search',
    type: 'mcp_server',
    description: 'Semantic web search optimized for AI. Sub-200ms. Best accuracy.',
    install: 'claude mcp add exa -- npx -y exa-mcp',
    stars: 4230,
    url: 'https://github.com/exa-labs/exa-mcp-server',
    solves: ['missing_context', 'research'],
    personas: ['senior_dev', 'indie_hacker', 'venture_studio'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Firecrawl',
    type: 'mcp_server',
    description: 'Web scraping that returns clean, LLM-ready markdown.',
    install: 'claude mcp add firecrawl -- npx -y firecrawl-mcp',
    stars: 6028,
    url: 'https://github.com/firecrawl/firecrawl-mcp-server',
    solves: ['missing_context', 'research', 'documentation'],
    personas: ['senior_dev', 'venture_studio'],
    lastVerified: '2026-04-13',
  },

  // === MCP Servers: UI/Design ===
  {
    name: 'Chrome DevTools MCP',
    type: 'mcp_server',
    description: 'Agent can see browser output — screenshots, console, network, DOM.',
    install: 'claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
    stars: 34604,
    url: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    solves: ['ui_blind', 'cant_verify_output', 'visual_bugs'],
    personas: ['vibe_coder', 'senior_dev', 'indie_hacker'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Playwright MCP',
    type: 'mcp_server',
    description: 'Cross-browser testing and automation via accessibility tree.',
    install: 'claude mcp add playwright -- npx @playwright/mcp@latest',
    stars: 30729,
    url: 'https://github.com/microsoft/playwright-mcp',
    solves: ['no_testing', 'cant_verify_output', 'browser_automation'],
    personas: ['senior_dev', 'team_lead'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Figma Context MCP (Framelink)',
    type: 'mcp_server',
    description: 'Design-to-code from Figma frames. Sends structured layout data to agent.',
    install: 'claude mcp add figma -- npx -y figma-developer-mcp --figma-api-key=YOUR_KEY --stdio',
    stars: 14294,
    url: 'https://github.com/GLips/Figma-Context-MCP',
    solves: ['design_to_code', 'ui_mismatch'],
    personas: ['vibe_coder', 'indie_hacker', 'team_lead'],
    lastVerified: '2026-04-13',
  },
  {
    name: '21st.dev Magic',
    type: 'mcp_server',
    description: 'Generate UI components from natural language. Multiple style variations.',
    install: 'claude mcp add 21st -- npx -y @21st-dev/magic@latest API_KEY=YOUR_KEY',
    stars: 4709,
    url: 'https://github.com/21st-dev/magic-mcp',
    solves: ['ui_components', 'design_to_code'],
    personas: ['vibe_coder', 'indie_hacker'],
    lastVerified: '2026-04-13',
  },

  // === MCP Servers: Backend/Database ===
  {
    name: 'Supabase MCP',
    type: 'mcp_server',
    description: 'Full backend access — tables, queries, auth, storage.',
    install: 'Remote OAuth: https://mcp.supabase.com/mcp',
    solves: ['database_access', 'backend_setup'],
    personas: ['vibe_coder', 'indie_hacker'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Sentry MCP',
    type: 'mcp_server',
    description: 'Production error data, stack traces, breadcrumbs in agent context.',
    install: 'Remote OAuth: https://mcp.sentry.dev/mcp',
    solves: ['production_debugging', 'error_tracking'],
    personas: ['senior_dev', 'team_lead'],
    lastVerified: '2026-04-13',
  },

  // === MCP Servers: Deploy/Infra ===
  {
    name: 'Vercel MCP',
    type: 'mcp_server',
    description: 'Manage projects, deployments, and domains from Claude Code.',
    install: 'Remote OAuth via Vercel',
    solves: ['deploy_friction', 'dashboard_dependency'],
    personas: ['vibe_coder', 'indie_hacker', 'venture_studio'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'GitHub MCP',
    type: 'mcp_server',
    description: 'Issues, PRs, CI workflows from the terminal.',
    install: 'claude mcp add github -- npx -y @anthropic/mcp-server-github',
    solves: ['github_context_switch', 'pr_management'],
    personas: ['senior_dev', 'team_lead'],
    lastVerified: '2026-04-13',
  },

  // === GitHub Repos/Tools ===
  {
    name: 'claude-code-prompt-improver',
    type: 'github_repo',
    description: 'UserPromptSubmit hook that intercepts vague prompts and asks clarifying questions.',
    install: 'See github.com/severity1/claude-code-prompt-improver for hook setup',
    stars: 1351,
    url: 'https://github.com/severity1/claude-code-prompt-improver',
    solves: ['vague_prompts', 'prompt_quality'],
    personas: ['vibe_coder', 'team_lead'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'agnix',
    type: 'github_repo',
    description: 'Linter for CLAUDE.md, AGENTS.md, SKILL.md, hooks. 385 rules.',
    install: 'npm i -g agnix',
    stars: 169,
    url: 'https://github.com/agent-sh/agnix',
    solves: ['config_quality', 'rule_conflicts'],
    personas: ['senior_dev', 'team_lead', 'venture_studio'],
    lastVerified: '2026-04-13',
  },

  // === Hook patterns ===
  {
    name: 'Destructive command blocker',
    type: 'hook',
    description: 'PreToolUse hook that blocks rm -rf, git push --force, terraform destroy, DROP TABLE.',
    install: `Add to .claude/settings.json:
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "if echo \\"$CLAUDE_COMMAND\\" | grep -qiE 'rm -rf|push --force|terraform destroy|DROP TABLE'; then echo 'BLOCKED: Destructive command' >&2; exit 2; fi"
      }]
    }]
  }
}`,
    solves: ['destructive_commands', 'safety'],
    personas: ['vibe_coder', 'indie_hacker', 'venture_studio', 'senior_dev', 'team_lead'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Auto-build after edit',
    type: 'hook',
    description: 'PostToolUse hook that runs build after every code change.',
    install: `Add to .claude/settings.json:
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "npm run build 2>&1 || echo 'BUILD FAILED'"
      }]
    }]
  }
}`,
    solves: ['no_build_verification', 'quality_gaps'],
    personas: ['vibe_coder', 'indie_hacker', 'venture_studio'],
    lastVerified: '2026-04-13',
  },
  {
    name: 'Protected files guard',
    type: 'hook',
    description: 'PreToolUse hook that blocks edits to .env, credentials, package-lock.',
    install: `Add to .claude/settings.json:
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "if echo \\"$CLAUDE_FILE_PATH\\" | grep -qiE '\\\\.env|credentials|secrets|package-lock'; then echo 'BLOCKED: Protected file' >&2; exit 2; fi"
      }]
    }]
  }
}`,
    solves: ['accidental_secret_exposure', 'protected_files'],
    personas: ['vibe_coder', 'indie_hacker', 'venture_studio', 'senior_dev', 'team_lead'],
    lastVerified: '2026-04-13',
  },
];

/**
 * Match problems to tools. Returns tools sorted by relevance.
 */
export function recommendTools(
  problems: string[],
  persona: string,
  installedMcpServers: string[] = []
): ToolRecommendation[] {
  const scored = TOOL_CATALOG.map(tool => {
    let score = 0;

    // Problem match
    for (const problem of problems) {
      if (tool.solves.some(s => s === problem || problem.includes(s) || s.includes(problem))) {
        score += 10;
      }
    }

    // Persona match
    if (tool.personas.includes(persona)) score += 5;

    // Already installed? Skip
    const nameLC = tool.name.toLowerCase();
    if (installedMcpServers.some(s => s.toLowerCase().includes(nameLC))) {
      score = -1; // already have it
    }

    return { tool, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.tool);
}
