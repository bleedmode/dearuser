// Recommendations — persona-specific text blocks for identified gaps
// All recommendations here are AGENT-facing: copy-paste fixes for files/config.
// User-facing behavior recommendations live in user-coaching.ts.

import type { Recommendation, PersonaId, Gap, EvidenceItem } from '../types.js';

// Human-readable labels for gap IDs used in evidence messages.
const GAP_LABELS: Record<string, string> = {
  missing_roles: 'Roles section',
  missing_autonomy: 'Autonomy tiers (do-yourself / ask-first / suggest-only)',
  missing_communication: 'Communication rules',
  missing_quality: 'Quality standards / definition of done',
  missing_north_star: 'North Star / goal',
  no_hooks: 'Any PostToolUse or PreToolUse hooks in .claude/settings.json',
  no_memory: 'Memory system (~/.claude/projects/*/memory/)',
};

// Text blocks per gap × persona
const RECOMMENDATION_BLOCKS: Record<string, Partial<Record<PersonaId, { title: string; description: string; textBlock: string; target: Recommendation['target']; placementHint: string }>>> = {
  missing_roles: {
    vibe_coder: {
      title: 'Add Role Definitions',
      description: 'Define who does what — you\'re the product owner, your agent is the executor',
      textBlock: `## Roles
- You (the user) are the CEO and product owner. You set direction, priorities, and make business decisions.
- Claude is the technical executor. Handle all code, git, builds, deploys, and technical research autonomously.
- The user's time is the scarcest resource. Only ask when genuinely necessary.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top of your CLAUDE.md, before any rules',
    },
    senior_dev: {
      title: 'Add Role Definitions',
      description: 'Clarify the partnership — you code too, so define where your agent adds value',
      textBlock: `## Roles
- We are technical partners. I write code and review your suggestions.
- You handle repetitive tasks, boilerplate, research, and initial implementations.
- Always explain your architectural choices — I want to understand, not just accept.
- Never change code I'm actively working on without flagging it first.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top of your CLAUDE.md',
    },
    indie_hacker: {
      title: 'Add Role Definitions',
      description: 'Keep it simple — you decide what to build, your agent builds it fast',
      textBlock: `## Roles
- I decide what to build and when to ship. You handle the how.
- Default to action. Ship first, polish later.
- If something takes less than 5 minutes, just do it. If it takes more, outline the approach first.`,
      target: 'global_claude_md',
      placementHint: 'Add at the top of your CLAUDE.md',
    },
    venture_studio: {
      title: 'Add Role Definitions',
      description: 'Define the meta-agent operating model for multi-project coordination',
      textBlock: `## Roles
- I am the CEO and portfolio manager. I set strategy and priorities across all projects.
- You are the meta-agent / operating system. Execute autonomously within established patterns.
- Proactively manage git, builds, deploys, and project health across the portfolio.
- Think in systems, not tasks. If we'll do it again, automate it.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top of your CLAUDE.md, before project-specific instructions',
    },
    team_lead: {
      title: 'Add Role Definitions',
      description: 'Define how agents interact within the team structure',
      textBlock: `## Roles
- I coordinate the team. You are my technical partner and force multiplier.
- Follow team standards and conventions exactly — consistency matters more than cleverness.
- When reviewing PRs or code from other team members, be constructive and specific.
- Never make decisions that affect team workflow without checking with me first.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top of your CLAUDE.md',
    },
  },
  missing_autonomy: {
    vibe_coder: {
      title: 'Add Autonomy Tiers',
      description: 'Three tiers: do it yourself, ask first, suggest only',
      textBlock: `## Do yourself — without asking
- Fix build errors, lint errors, and broken tests
- Git: commit, push, branch, merge
- Research and analysis
- Update memory and learnings
- Follow established patterns

## Ask first
- Change architecture or core logic
- Add new dependencies or services
- Delete features or files with business logic
- Publish anything (App Store, websites, social media)
- Anything that costs money

## Suggest — mention but don't implement
- Improvements beyond the task
- New features or ideas
- Refactoring that isn't necessary for the task`,
      target: 'global_claude_md',
      placementHint: 'Add after the Roles section',
    },
    venture_studio: {
      title: 'Add Autonomy Tiers',
      description: 'System-level autonomy boundaries for multi-project operation',
      textBlock: `## Do yourself — without asking
- Fix build errors, lint errors, and broken tests across all projects
- Git: commit, push, branch, merge (follow conventional commits)
- Research and competitive analysis
- Update memory, learnings, and task tracking
- Run scheduled tasks and health checks
- Clean up: delete unused code, stale branches, old worktrees

## Ask first
- Change architecture or core logic in any project
- Add new dependencies or services
- Delete features or entire files with business logic
- Publish anything externally
- Change business strategy or pricing
- Anything that costs money

## Suggest — mention but don't implement
- Improvements beyond the current task
- New features or product ideas
- Refactoring not required for the task
- Technology changes`,
      target: 'global_claude_md',
      placementHint: 'Add after the Roles section',
    },
  },
  missing_communication: {
    vibe_coder: {
      title: 'Add Communication Rules',
      description: 'Tell your agent how to talk to you — business language, not tech jargon',
      textBlock: `## Communication
- Answer in the user's language (match the language they write in)
- Keep it short and clear. No long technical explanations unless asked.
- Use business analogies first, technical details second.
- Never reference frameworks or tools as shared knowledge — explain what they do.
- Use the user's vocabulary, not developer jargon.`,
      target: 'global_claude_md',
      placementHint: 'Add after autonomy rules',
    },
  },
  no_hooks: {
    vibe_coder: {
      title: 'Add Quality Hooks',
      description: 'Automated guardrails that prevent your agent from breaking things',
      textBlock: `// Add to .claude/settings.json:
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "npm run build 2>&1 || echo 'BUILD FAILED'"
      }
    ]
  }
}`,
      target: 'settings',
      placementHint: 'Add to .claude/settings.json in your project root',
    },
    senior_dev: {
      title: 'Add Quality Hooks',
      description: 'Enforce build, lint, and test on every code change',
      textBlock: `// Add to .claude/settings.json:
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "npm run build && npm run lint 2>&1 || echo 'QUALITY CHECK FAILED'"
      }
    ]
  }
}`,
      target: 'settings',
      placementHint: 'Add to .claude/settings.json — consider adding test hooks too',
    },
  },
  no_memory: {
    vibe_coder: {
      title: 'Enable Agent Memory',
      description: 'Your agent can remember corrections across sessions — but you need to set it up',
      textBlock: `Agent memory is built into Claude Code. When you correct your agent, it can save the lesson for future sessions. To get started:

1. After a correction, say "remember this for next time"
2. Your agent will create a memory file in ~/.claude/projects/*/memory/
3. Over time, your agent builds up a profile of how you work

Key memory types:
- feedback: corrections and preferences
- user: your role, expertise, and goals
- project: ongoing work context
- reference: where to find things`,
      target: 'global_claude_md',
      placementHint: 'Consider adding a "Memory" section to your CLAUDE.md explaining what to remember',
    },
  },
  missing_north_star: {
    indie_hacker: {
      title: 'Add Your Revenue Goal',
      description: 'Your agent should know your target — every decision gets measured against it',
      textBlock: `## North Star
- Target: $X MRR
- Strategy: [your approach]
- Timeline: [your deadline]
- Every decision should be evaluated: "does this bring us closer to the target?"
- Ship fast. Kill what doesn't work. Double down on what does.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top, right after Roles',
    },
    venture_studio: {
      title: 'Add Portfolio North Star',
      description: 'Define the portfolio-level target that guides all projects',
      textBlock: `## North Star
- Target: $X MRR with Y% profit margin
- Strategy: N products over M months — repeatable system, not one lucky hit
- Runway: X months remaining
- Prioritization: Revenue-generating work ALWAYS first. Kill quickly (70-80% kill rate is healthy). Speed over perfection.
- Distribution is as important as product — an app nobody knows about is an app nobody uses.`,
      target: 'global_claude_md',
      placementHint: 'Add near the top, after Roles and Autonomy',
    },
  },
};

export function generateRecommendations(gaps: Gap[], persona: PersonaId): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const gap of gaps) {
    const blocks = RECOMMENDATION_BLOCKS[gap.id];
    if (!blocks) continue;

    // Try persona-specific first, then fall back to vibe_coder (most common)
    const block = blocks[persona] || blocks.vibe_coder;
    if (!block) continue;

    // Evidence for agent-recommendations is "what's missing" — we name the absent
    // artifact so the user can verify the claim against their own files.
    const label = GAP_LABELS[gap.id] || gap.id.replace('missing_', '').replace('no_', '');
    // Grammar: "No X found" reads awkward when label starts with "Any" or "A".
    // Strip leading "Any "/"A " to keep the sentence natural.
    const cleanLabel = label.replace(/^(Any |A )/, '');
    const evidence: EvidenceItem[] = [{
      source: block.target === 'settings' ? '.claude/settings.json' : 'CLAUDE.md',
      excerpt: `No ${cleanLabel} found in your setup`,
      kind: 'missing',
    }];

    recommendations.push({
      priority: gap.severity,
      audience: 'agent',
      title: block.title,
      description: block.description,
      textBlock: block.textBlock,
      evidence,
      target: block.target,
      placementHint: block.placementHint,
    });
  }

  return recommendations;
}
