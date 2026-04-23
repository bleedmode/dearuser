// preference-mismatch — recommendations that fire when the user's stated
// preferences (from onboarding) don't match what we see on disk.
//
// Onboarding asks four questions; this module turns each into a concrete
// "you said X, but your setup says Y" recommendation when the two diverge.
// All evidence cites the user's own answers — no generic best-practice
// nagging.

import type { ParseResult, Recommendation, ScanResult } from '../types.js';
import type { UserPreferences } from './user-preferences.js';

export function detectPreferenceMismatches(
  prefs: UserPreferences,
  parsed: ParseResult,
  scan: ScanResult,
): Recommendation[] {
  const out: Recommendation[] = [];

  // --- Cadence mismatch ----------------------------------------------------
  // Daily/weekly cadence needs scheduled tasks (or hooks for event-driven).
  // If the user wants automation but we see none, that's the gap.
  if (prefs.cadence === 'daily' && scan.scheduledTasksCount === 0) {
    out.push({
      priority: 'recommended',
      audience: 'both',
      title: 'You want a daily overview, but nothing runs automatically',
      description: `You told me you want me to work for you every day, but you have no scheduled tasks set up. That means every morning starts with you asking — which defeats the point of a daily cadence.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: 'Daily cadence' },
        { kind: 'missing', source: 'scheduled-tasks', excerpt: 'No scheduled tasks found on disk' },
      ],
      placementHint: 'Ask your agent: "Set up a scheduled task that runs every morning and gives me a briefing on [your focus area]."',
      textBlock: '',
      actionType: 'manual',
    });
  }

  if (prefs.cadence === 'weekly' && scan.scheduledTasksCount === 0) {
    out.push({
      priority: 'nice_to_have',
      audience: 'both',
      title: 'You want a weekly check-in, but nothing runs automatically',
      description: `You asked for a weekly rhythm, but there are no scheduled tasks. A weekly wrap-up needs a trigger — otherwise it only happens when you remember to ask.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: 'Weekly cadence' },
        { kind: 'missing', source: 'scheduled-tasks', excerpt: 'No scheduled tasks found on disk' },
      ],
      placementHint: 'Ask your agent: "Set up a scheduled task that runs every Friday afternoon and summarises my week."',
      textBlock: '',
      actionType: 'manual',
    });
  }

  if (prefs.cadence === 'event' && scan.hooksCount === 0) {
    out.push({
      priority: 'recommended',
      audience: 'both',
      title: 'You want event-driven work, but you have no hooks',
      description: `You told me you want your agent to react when something happens. That's what hooks do — without them, nothing will fire on events.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: 'Event-driven cadence' },
        { kind: 'missing', source: 'hooks', excerpt: 'No hooks configured' },
      ],
      placementHint: 'Ask your agent to set up a hook for the trigger you care about (e.g. "every time a PR merges" or "every time a test fails").',
      textBlock: '',
      actionType: 'manual',
    });
  }

  // --- Autonomy mismatch ---------------------------------------------------
  // Auto-execute needs guardrails — hooks or explicit protections — or it's
  // just unchecked autonomy. Ask-all with many do-rules is the opposite
  // gap: the contract says ask, the CLAUDE.md says act.
  const doRules = parsed.rules.filter(r => r.type === 'do_autonomously').length;
  const askRules = parsed.rules.filter(r => r.type === 'ask_first').length;

  if (prefs.autonomy === 'auto' && scan.hooksCount === 0) {
    out.push({
      priority: 'critical',
      audience: 'both',
      title: 'You want me to act on my own — but there are no guardrails',
      description: `You said you want your agent to work independently. That's fine, but without hooks (build checks, destructive-command blockers, protected-file guards) there is nothing catching mistakes before they land. Add guardrails before you hand over the keys.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: 'Autonomy = auto (act on my own)' },
        { kind: 'missing', source: 'hooks', excerpt: 'No hooks configured' },
      ],
      placementHint: 'Ask your agent: "Install the Dear User protected-files hook and add a pre-commit build check."',
      textBlock: '',
      actionType: 'manual',
    });
  }

  if (prefs.autonomy === 'ask-all' && doRules >= 5 && askRules < doRules / 2) {
    out.push({
      priority: 'recommended',
      audience: 'both',
      title: 'You want me to ask first — but your rules say I can act',
      description: `You told me to ask before every action. But your CLAUDE.md has ${doRules} "do yourself" rules and only ${askRules} "ask first" rules. Either soften the rules, or I'll keep acting when you expected a question.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: 'Autonomy = ask-all' },
        { kind: 'stat', source: 'CLAUDE.md', excerpt: `${doRules} do-rules vs ${askRules} ask-rules` },
      ],
      placementHint: 'Review the "do yourself without asking" section of your CLAUDE.md — move items to "ask first" that you actually want to approve.',
      textBlock: '',
      actionType: 'manual',
    });
  }

  // --- Audience mismatch ---------------------------------------------------
  // Team / customers require shared substrate: memory + some docs. Self can
  // get away with rules in one file.
  if ((prefs.audience === 'team' || prefs.audience === 'customers') && scan.memoryFiles.length === 0) {
    const who = prefs.audience === 'team' ? 'your team' : 'your customers';
    out.push({
      priority: 'recommended',
      audience: 'both',
      title: `${who.charAt(0).toUpperCase() + who.slice(1)} needs to see results — but you have no shared memory`,
      description: `You told me the output is for ${who}. That means corrections and learnings shouldn't live only in your head — they need a shared substrate so next session (or next teammate) can pick up the thread. Right now there are no memory files.`,
      evidence: [
        { kind: 'quote', source: 'your onboarding answer', excerpt: `Audience = ${prefs.audience}` },
        { kind: 'missing', source: 'memory', excerpt: 'No memory files on disk' },
      ],
      placementHint: 'Ask your agent: "Enable memory and install the /learn skill so corrections persist across sessions."',
      textBlock: '',
      actionType: 'manual',
    });
  }

  return out;
}
