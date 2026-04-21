// User-coaching — behavior recommendations for the HUMAN side of collaboration.
// Triggered by friction patterns detected in feedback files + sessions.
// Structure: Why → How it looks → Practice step (one concrete next-action).

import type { FrictionPattern, Recommendation, EvidenceItem } from '../types.js';

interface CoachingTemplate {
  title: string;
  description: string; // one-liner
  why: string;
  howItLooks: string;
  practiceStep: string;
}

const COACHING_BY_THEME: Record<FrictionPattern['theme'], CoachingTemplate> = {
  scope_creep: {
    title: 'Catch scope creep in the moment',
    description: 'Stop the agent the second it starts doing more than you asked',
    why: 'If you correct scope creep after the fact, the agent has already spent your context and possibly edited files you cared about. Catching it mid-action is 10x cheaper than fixing it afterwards — and it teaches the agent (via memory) what "the task" actually meant to you.',
    howItLooks: `You: "Fix the login button color"
Agent: [starts editing Button.tsx AND refactoring the whole form]
You: [STOP] "Only the button color. Revert everything else." ← correction happens within 2 seconds, not 2 minutes`,
    practiceStep: 'The next time your agent starts editing more than one file for a single-scope task, interrupt with "stop — scope?" and make it justify each file before continuing. Do this once; the memory system will carry the lesson forward.',
  },
  communication: {
    title: 'Name the tone mismatch explicitly',
    description: 'Don\'t just switch languages — tell the agent what pattern to remember',
    why: 'Saying "svar på dansk" once fixes the current response. Saying "always match my language — save this as a rule" makes the agent persist the preference. The second is 5 seconds of extra work and eliminates the correction forever.',
    howItLooks: `You: "Du svarer på engelsk igen."
Agent: [switches to Danish]
You: [NOT ENOUGH — you\'ll have to correct again in 3 days]

Better:
You: "Du svarer på engelsk igen. Husk det — altid dansk når jeg skriver dansk."
Agent: [saves to memory, problem stops recurring]`,
    practiceStep: 'When you catch a tone/language/length mismatch, add one phrase: "remember this" or "husk det". The agent will save it as a feedback memory and stop repeating the mistake.',
  },
  quality: {
    title: 'Don\'t accept "it should work" — demand verification',
    description: 'If the agent hasn\'t proven it works, it probably doesn\'t',
    why: '"It should work" is the agent saying "I did not verify this." Shipping unverified changes is the #1 source of regressions. Forcing verification into the workflow once is worth 100 bug-fix sessions.',
    howItLooks: `Agent: "Done — the login flow should now work."
You: [NOT ENOUGH]

Better:
You: "Prove it. Run the build, open the preview, walk through the flow. Paste the result."`,
    practiceStep: 'Add one rule to your CLAUDE.md: "Never say something works unless you have tested it." The agent will (1) actually verify more often, and (2) tell you explicitly when it couldn\'t test — which is just as useful as success.',
  },
  autonomy: {
    title: 'Calibrate the ask/do line once — in writing',
    description: 'Every autonomy surprise is a missing rule',
    why: 'If the agent acts when it should have asked (or vice-versa), the rule is missing — not the judgment. Writing the rule down is 30 seconds. Re-arguing it every session costs hours.',
    howItLooks: `Agent: [deletes files without asking]
You: "Don\'t delete without asking!"
Agent: [apologizes, will do it again next week]

Better:
You: "Don\'t delete without asking. Add that to my autonomy rules."
Agent: [writes it into CLAUDE.md — permanent fix]`,
    practiceStep: 'The next time the agent\'s autonomy surprises you (too much OR too little), respond with "add that to my autonomy rules". The agent will update CLAUDE.md and the surprise won\'t recur.',
  },
  tooling: {
    title: 'Upgrade repeating manual tasks to automation',
    description: 'If you did it twice, the agent should automate it the third time',
    why: 'Manual workarounds are tech debt in the collaboration itself. Every time you manually re-run a check, you\'re paying for a missing hook. The third time you do a task manually is the signal to stop and build the automation — the agent will happily do it.',
    howItLooks: `You (3rd time): "I keep running npm run build after every change to catch errors."
Agent: [just keeps doing it manually]

Better:
You (3rd time): "I keep manually running build. Automate this."
Agent: [adds a PostToolUse hook — problem solved forever]`,
    practiceStep: 'Keep a mental tally: "have I done this manually twice?" The third time, say "automate this". The agent will propose a hook, skill, or scheduled task.',
  },
  process: {
    title: 'Write the workflow once, then reference it',
    description: 'Multi-step procedures belong in a skill, not in your head',
    why: 'Explaining a 7-step deploy flow every time is draining and error-prone. Once a workflow is stable, it should live in a skill — so "deploy" becomes one word instead of 7 steps.',
    howItLooks: `You: "Deploy: build → check tests → vercel deploy --prod → update DNS → add alias → verify..."

Better:
You: "Turn that deploy flow into a skill."
Agent: [creates /deploy skill]
You (next time): "/deploy" ← done.`,
    practiceStep: 'The next multi-step procedure you explain to your agent, end with "turn this into a skill". Next time you need it, you type one word.',
  },
};

/**
 * Build user-facing (behavior-change) recommendations from detected friction patterns.
 * Each friction pattern above threshold becomes a coaching recommendation with
 * concrete evidence (the quote/feedback that triggered it) and a practice step.
 */
export function generateUserCoaching(friction: FrictionPattern[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const fp of friction) {
    const template = COACHING_BY_THEME[fp.theme];
    if (!template) continue;

    // Evidence = the actual quotes/snippets that led to this theme being flagged.
    // If the analyzer found nothing concrete, we don't fabricate evidence — we skip.
    const evidence: EvidenceItem[] = fp.evidence.length > 0
      ? fp.evidence.slice(0, 3).map(e => ({
          source: 'your feedback memory / rules',
          excerpt: e,
          kind: 'quote' as const,
        }))
      : [];

    if (evidence.length === 0) continue; // Skip themes with no concrete evidence

    // Rank 1 friction → critical. Rank 2 → recommended. Rank 3+ → nice_to_have.
    const priority = fp.rank === 1 ? 'critical' : fp.rank === 2 ? 'recommended' : 'nice_to_have';

    recs.push({
      priority,
      audience: 'user',
      title: template.title,
      description: template.description,
      textBlock: '', // User recs are structured via why/howItLooks/practiceStep, not a code block
      evidence,
      actionType: 'manual',
      placementHint: 'This is a behavior change — no file to edit.',
      why: template.why,
      howItLooks: template.howItLooks,
      practiceStep: template.practiceStep,
    });
  }

  return recs;
}
