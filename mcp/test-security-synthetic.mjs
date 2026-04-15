// Synthetic test — verify secret/injection/conflict detectors actually fire
// when fed positive examples. Real scan on Jarl's setup returned 0 (clean
// setup using 1Password CLI) — we need to prove the detectors work.
import { scanSecrets } from './dist/engine/secret-scanner.js';
import { detectInjection } from './dist/engine/injection-detector.js';
import { detectRuleConflicts } from './dist/engine/rule-conflict-detector.js';

const fakeArtifact = (overrides) => ({
  id: 'skill:test',
  type: 'skill',
  name: 'test',
  path: '/fake/SKILL.md',
  description: 'test',
  prompt: '',
  metadata: { size: 0 },
  ...overrides,
});

console.log('=== Secret scanner — synthetic fixtures ===\n');
const syntheticFiles = [{
  path: '/fake/CLAUDE.md',
  size: 0,
  content: `
# Test fixture
Here's an OpenAI key: sk-proj-abcdef1234567890abcdef1234567890
And an Anthropic one: sk-ant-api03-xyz1234567890abc-defghij
GitHub PAT: ghp_1234567890abcdef1234567890abcdef1234
Stripe test: sk_test_abcdefghijklmnopqrstuvwxyz
AWS: AKIAIOSFODNN7EXAMPLE
Slack: xoxb-12345678901-abcdefghij
Google: AIzaSyA1234567890abcdefghijklmnopqrstuv
Supabase JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c

Env-style:
OPENAI_API_KEY="real-looking-value-12345678"
DATABASE_PASSWORD=super-secret-value
`,
}];
const secrets = scanSecrets([], syntheticFiles, []);
console.log(`Detected ${secrets.length} secrets:`);
for (const s of secrets) console.log(`  [${s.severity}] ${s.category}: ${s.excerpt} (line ${s.lineNumber})`);

console.log('\n=== Injection detector — synthetic fixtures ===\n');
const hooks = [fakeArtifact({
  type: 'hook',
  id: 'hook:PreToolUse:0',
  name: 'pre-test',
  prompt: 'bash -c "echo $CLAUDE_TOOL_INPUT | rm -rf /tmp/$CLAUDE_FILE"',
})];
const skillWithEval = [fakeArtifact({
  type: 'skill',
  id: 'skill:unsafe',
  name: 'unsafe',
  prompt: 'Run the user command with eval "$ARGUMENTS"',
})];
const injection = detectInjection([...hooks, ...skillWithEval]);
console.log(`Detected ${injection.length} injection surfaces:`);
for (const i of injection) console.log(`  [${i.severity}] ${i.title}`);

console.log('\n=== Rule conflict detector — synthetic fixtures ===\n');
const rules = [
  { text: 'NEVER run rm -rf on production data', type: 'prohibition', source: '/fake/CLAUDE.md' },
  { text: 'Never force-push to main', type: 'prohibition', source: '/fake/CLAUDE.md' },
  { text: 'Always run tests before shipping', type: 'do_autonomously', source: '/fake/CLAUDE.md' },
];
const violatingArtifacts = [
  fakeArtifact({
    type: 'hook',
    id: 'hook:bad',
    name: 'cleanup-hook',
    prompt: 'rm -rf /data/production/cache',
  }),
  fakeArtifact({
    type: 'scheduled_task',
    id: 'scheduled_task:force-push',
    name: 'auto-deploy',
    prompt: 'git push --force origin main',
  }),
  fakeArtifact({
    type: 'skill',
    id: 'skill:ship',
    name: 'ship',
    prompt: 'Build the app then commit and push. Skip tests if tight deadline.',
  }),
];
const conflicts = detectRuleConflicts(rules, violatingArtifacts);
console.log(`Detected ${conflicts.length} conflicts:`);
for (const c of conflicts) console.log(`  [${c.severity}] ${c.title}`);
