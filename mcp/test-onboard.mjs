// Smoke test — walk through the full onboard flow.
import { runOnboard, formatOnboardResult } from './dist/tools/onboard.js';

function ask(label) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`STEP: ${label}`);
  console.log('='.repeat(70));
}

// 1. intro
ask('intro');
let result = runOnboard({});
console.log(formatOnboardResult(result));
let state = result.state;

// 2. role — simulate "I don't code but I want to use AI seriously"
ask('role → pretending user is a CEO');
result = runOnboard({
  step: 'role',
  answer: 'I don\'t code but I want to use AI seriously for my work — I run a venture studio and want AI to help me manage multiple projects.',
  state,
});
console.log(formatOnboardResult(result));
state = result.state;

// 3. goals
ask('goals');
result = runOnboard({
  step: 'goals',
  answer: 'Help me keep overview across all my projects without drowning in status meetings. Spot risks before they become crises.',
  state,
});
console.log(formatOnboardResult(result));
state = result.state;

// 4. stack
ask('stack');
result = runOnboard({
  step: 'stack',
  answer: 'I use Claude Code and ChatGPT daily. No custom MCP yet.',
  state,
});
console.log(formatOnboardResult(result));
state = result.state;

// 5. pains
ask('pains');
result = runOnboard({
  step: 'pains',
  answer: 'The agent forgets context between sessions. I end up re-explaining my projects every morning.',
  state,
});
console.log(formatOnboardResult(result));
state = result.state;

// 6. substrate — describe structured data (should classify as database)
ask('substrate → describing structured list');
result = runOnboard({
  step: 'substrate',
  answer: 'I have a list of ~40 AI app ideas with status, priority, and deadline. I need to filter by status and see what I should work on next.',
  state,
});
console.log(formatOnboardResult(result));
state = result.state;

// 7. plan
ask('plan');
result = runOnboard({
  step: 'plan',
  answer: 'Yes, show the plan',
  state,
});
console.log(formatOnboardResult(result));
console.log('\n--- DONE? ---', result.done);
