// Sample wrapped payload for /demo. Invented tastefully — "Alex" is a
// fictional vibe-coder with a lived-in setup: one loud correction pattern,
// a skill they built and never ran, and a five-page CLAUDE.md.
//
// Update freely — this file only powers the marketing demo page.

import type { WrappedSlidesInput } from './wrapped-slides.ts';

export const DEMO_WRAPPED: WrappedSlidesInput = {
  score: 87,
  year: new Date().getFullYear(),
  userName: 'Alex',
  projectName: 'alex-studio',
  mode: 'sample',
  showShareCta: true,
  setupArchetypeName: 'Trust-and-go',
  wrapped: {
    headlineStat: { value: '87', label: "Strong collaboration — you built a system, not a script." },
    topLesson: {
      quote: 'Never change code beyond what you were asked to change.',
      context: 'learned the hard way when a small UI tweak broke an unrelated flow',
    },
    autonomySplit: { doSelf: 58, askFirst: 30, suggest: 12 },
    archetype: {
      name: 'The Overachieving Assistant',
      description: "Does too much. Needs boundaries. Refactors your entire codebase when asked to fix a typo — but also manages your git, builds your apps and remembers every lesson learned.",
      traits: ['Proactive', 'Scope-creepy', 'Systems thinker', 'Boundary-tested', 'Multilingual'],
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
        narrative: 'Your setup beats 2,808 of 2,895 public CLAUDE.md files we benchmarked — top 3% territory.',
        detail: 'Score 87 — corpus median is 18.',
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
