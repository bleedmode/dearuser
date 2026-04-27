// Sample wrapped payload for /demo. Mirrors the /example letter — same
// person (Sam), same archetype (Solo Builder) — so the two marketing
// surfaces read as one coherent user journey. Keep the numbers, lessons
// and moments consistent with example.astro whenever you update either.

import type { WrappedSlidesInput } from './wrapped-slides.ts';

export const DEMO_WRAPPED: WrappedSlidesInput = {
  score: 87,
  year: new Date().getFullYear(),
  userName: 'Sam',
  projectName: 'sam-studio',
  mode: 'sample',
  showShareCta: true,
  setupArchetypeName: 'Trust-and-go',
  wrapped: {
    headlineStat: { value: '87', label: "Strong collaboration — you built a system, not a script." },
    topLesson: {
      quote: "The hook was routing around your own rule — fix the hook, not the rule.",
      context: 'learned on a Friday night when the build committed something it shouldn\'t have',
    },
    autonomySplit: { doSelf: 62, askFirst: 26, suggest: 12 },
    userArchetype: {
      name: 'Indie Hacker',
      description: "Solo, speed-obsessed, revenue-pragmatic. You'd rather ship imperfect and iterate than polish in the dark — every decision measured against one question: does this get us closer to paying users?",
    },
    archetype: {
      name: 'The Solo Builder',
      description: "Your agent isn't a colleague — it's a scaffold. Optimizes for momentum, not elegance. Your CLAUDE.md grows with every Friday-night lesson.",
      traits: ['Pragmatic', 'Iterative', 'Memory-first', 'Learns from mistakes', 'Scaffold-builder'],
    },
    systemGrid: { hooks: 4, skills: 12, scheduled: 3, rules: 48 },
    shareCard: {
      corrections: 18,
      memories: 34,
      projects: 3,
      prohibitionRatio: '38%',
    },
    moments: [
      {
        id: 'percentile',
        value: 'Top 3%',
        label: 'Where you rank',
        narrative: 'Your setup beats 958 of 988 public Claude Code setups we benchmarked — top 3% territory.',
        detail: 'Score 87 — corpus median is 32.',
      },
      {
        id: 'corrections',
        value: '18',
        label: 'Times you corrected me',
        narrative: 'You caught me and pushed back 18 times. The one I remember: "Don\'t rewrite the prompt — just fix the typo."',
      },
      {
        id: 'dead-skills',
        value: '2',
        label: 'Skills never called',
        narrative: "You built `deploy-preview`, `lighthouse-sweep` — I've never seen you use them. Maybe it's time to kill them, or tell me when they fire.",
        detail: 'Out of 12 total skills.',
      },
      {
        id: 'biggest-rule',
        value: '62 words',
        label: 'Your longest rule',
        narrative: 'Your longest rule runs 62 words. It starts: "Never commit without running the test suite first; if tests fail, fix them before moving on; if a test is flaky, mark it as such…"',
        detail: 'Long rules are easier to forget than short ones. If this is load-bearing, it might deserve to be two rules.',
      },
      {
        id: 'contrast',
        value: '+34',
        label: 'Your biggest gap',
        narrative: "You're strongest at Communication (94/100) and weakest at System Maturity (60). That's a 34-point spread — a clear next focus.",
      },
    ],
    percentile: { score: 87, percentile: 94, topPercent: 10, corpusSize: 50 },
    contrast: {
      strongest: { key: 'communication', name: 'Communication', score: 94 },
      weakest: { key: 'systemMaturity', name: 'System Maturity', score: 60 },
    },
  },
};
