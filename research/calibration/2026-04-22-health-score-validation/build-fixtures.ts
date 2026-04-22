// build-fixtures — generate 25 synthetic ~/.claude/-shaped directories with
// known issues, for validating the system-health scorer.
//
// Each fixture is a self-contained HOME directory we can point the scanner at
// by setting HOME=<fixture-dir>. Structure mirrors the real thing:
//
//   <fixture>/
//     .claude/
//       skills/<name>/SKILL.md
//       scheduled-tasks/<name>/SKILL.md
//       commands/<name>.md
//       settings.json        (hooks + optional mcpServers)
//       projects/<id>/memory/<file>.md
//     .claude.json           (mcpServers)
//     .dearuser/expected-jobs.json  (optional)
//     Library/Application Support/Claude/claude-code-sessions/<sid>/scheduled-tasks.json
//
// We write the scheduler-state file explicitly where needed so stale_schedule
// and expected_job_missing can fire. Skipping it = detectors see no lastRunAt
// and don't flag (which is also a useful negative case).

import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const FIXTURES_DIR = join(ROOT, 'fixtures');

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function write(path: string, content: string, mtime?: Date) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mtime) utimesSync(path, mtime, mtime);
}

function skill(dir: string, name: string, description: string, body: string) {
  const path = join(dir, '.claude', 'skills', name, 'SKILL.md');
  write(
    path,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

function scheduledTask(
  dir: string,
  name: string,
  description: string,
  body: string,
) {
  const path = join(dir, '.claude', 'scheduled-tasks', name, 'SKILL.md');
  write(
    path,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

function schedulerState(
  dir: string,
  tasks: Array<{
    id: string;
    cronExpression?: string;
    enabled?: boolean;
    lastRunAt?: string;
    createdAt?: number;
  }>,
) {
  const sessionId = 'synthetic-session';
  const path = join(
    dir,
    'Library',
    'Application Support',
    'Claude',
    'claude-code-sessions',
    sessionId,
    'scheduled-tasks.json',
  );
  write(path, JSON.stringify({ scheduledTasks: tasks }, null, 2));
}

function settings(dir: string, obj: Record<string, unknown>) {
  const path = join(dir, '.claude', 'settings.json');
  write(path, JSON.stringify(obj, null, 2));
}

function claudeJson(dir: string, obj: Record<string, unknown>) {
  const path = join(dir, '.claude.json');
  write(path, JSON.stringify(obj, null, 2));
}

function memoryFile(
  dir: string,
  project: string,
  filename: string,
  body: string,
  mtime?: Date,
) {
  const path = join(
    dir,
    '.claude',
    'projects',
    project,
    'memory',
    filename,
  );
  write(path, body, mtime);
}

function expectedJobs(dir: string, jobs: Array<{ name: string; cron?: string; purpose?: string }>) {
  const path = join(dir, '.dearuser', 'expected-jobs.json');
  write(path, JSON.stringify(jobs, null, 2));
}

// ----------------------------------------------------------------------------
// Fixture definitions
// ----------------------------------------------------------------------------

type FixtureName = string;
const builders: Record<FixtureName, (d: string) => void> = {};

// 1. Empty
builders['01-empty'] = (d) => {
  // truly nothing
};

// 2. Minimal clean — 1 skill, 1 scheduled task with a documented consumer in
//    another skill's prompt. Should score near ceiling.
builders['02-minimal-clean'] = (d) => {
  skill(
    d,
    'my-helper',
    'Helper skill',
    'This skill does one thing.\n\nIt produces output that daily-briefing reads.',
  );
  scheduledTask(
    d,
    'daily-briefing',
    'Daily briefing',
    'Send a daily notification to the user summarising their day.',
  );
};

// 3. Overlap — 3 near-duplicate "review code" skills (no shared prefix).
builders['03-overlap-duplicate-skills'] = (d) => {
  skill(
    d,
    'code-reviewer',
    'Review code for bugs and style issues',
    'Review pull requests for bugs and style issues. Check line length, variable names, dead code, security anti-patterns.',
  );
  skill(
    d,
    'pr-reviewer',
    'Review pull requests for bugs and style issues',
    'Review pull requests for bugs and style issues. Check variable names, dead code, line length, security anti-patterns.',
  );
  skill(
    d,
    'lint-reviewer',
    'Lint code for bugs and style issues',
    'Review pull requests for bugs and style issues. Check line length, variable names, security anti-patterns.',
  );
};

// 4. Overlap suite — 4 dearuser-prefix skills. Should cluster and be excluded
//    from scoring (treated as intentional product suite).
builders['04-overlap-suite'] = (d) => {
  const base = 'Tool in the dearuser product suite for collaboration analysis between humans and AI agents.';
  skill(d, 'dearuser-collab', 'Collaboration analysis for AI agents', base);
  skill(d, 'dearuser-health', 'System health analysis for AI agents', base);
  skill(d, 'dearuser-security', 'Security analysis for AI agents', base);
  skill(d, 'dearuser-wrapped', 'Wrapped stats analysis for AI agents', base);
};

// 5. Orphan scheduled task — writes to data path, no reader anywhere.
builders['05-orphan-scheduled-task'] = (d) => {
  scheduledTask(
    d,
    'data-dumper',
    'Dump data every hour',
    'Runs every hour. Writes to /tmp/dump-data/results.json. That is all.',
  );
  schedulerState(d, [{ id: 'data-dumper', cronExpression: '0 * * * *', enabled: true, lastRunAt: new Date().toISOString() }]);
};

// 6. Orphan effect task — no produces edges, no name mentions, no implicit
//    consumer pattern. Should be flagged as effect-orphan.
builders['06-orphan-effect-task'] = (d) => {
  scheduledTask(
    d,
    'lonely-watcher',
    'Watch something',
    'Just watches. Does stuff. No details.',
  );
};

// 7. Missing closure — non-scheduled producer writes to non-terminal path.
builders['07-missing-closure-skill'] = (d) => {
  skill(
    d,
    'data-saver',
    'Save data to disk',
    'This skill writes to /tmp/skill-cache/results-cache.json and never reads it back.',
  );
};

// 8. Substrate mismatch — 25 structured entries with dates.
builders['08-substrate-mismatch'] = (d) => {
  const entries = Array.from({ length: 25 }, (_, i) => {
    const date = `2026-04-${String((i % 28) + 1).padStart(2, '0')}`;
    return `- [${date}] entry number ${i}: status: done tags: something`;
  }).join('\n');
  memoryFile(
    d,
    '-Users-karlo-test',
    'project_learnings.md',
    `# Project learnings\n\n${entries}\n`,
    new Date(), // recent
  );
};

// 9. Unregistered MCP tool — skill references mcp__nonexistent__foo.
builders['09-unregistered-mcp-tool'] = (d) => {
  skill(
    d,
    'calls-missing-server',
    'Uses an unregistered MCP server',
    'When invoked: call mcp__nonexistent__do_thing with the user input. Then call mcp__nonexistent__finalize.',
  );
  // Register a DIFFERENT server so scanMcpServers returns something
  claudeJson(d, { mcpServers: { real_server: { command: 'node', args: ['server.js'] } } });
};

// 10. Unbacked substrate — 12 recent skills, no .git anywhere.
builders['10-unbacked-substrate'] = (d) => {
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    skill(d, `skill-${i}`, `Skill number ${i}`, `Does thing ${i}.`);
  }
  // Ensure mtime is recent (default is now, but be explicit in test)
};

// 11. Stale scheduled task — daily cron, last run 10 days ago.
builders['11-stale-scheduled-task'] = (d) => {
  scheduledTask(
    d,
    'nightly-backup',
    'Nightly backup',
    'Runs every night at 2am. Sends notification when complete.',
  );
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  schedulerState(d, [{ id: 'nightly-backup', cronExpression: '0 2 * * *', enabled: true, lastRunAt: tenDaysAgo }]);
};

// 12. Expected job missing — manifest declares a job that doesn't exist.
builders['12-expected-job-missing'] = (d) => {
  // No scheduled tasks exist
  expectedJobs(d, [{ name: 'morning-standup', cron: '0 8 * * *', purpose: 'Daily briefing' }]);
};

// 13. Implicit consumer — task has "sends notification" in prose, not orphan.
builders['13-implicit-consumer-notify'] = (d) => {
  scheduledTask(
    d,
    'status-pinger',
    'Ping user with status',
    'Every morning, sends a notification to the user with status info. Consumer is the user.',
  );
  schedulerState(d, [{ id: 'status-pinger', cronExpression: '0 8 * * *', enabled: true, lastRunAt: new Date().toISOString() }]);
};

// 14. Terminal path write — writes to CLAUDE.md and memory files, not orphan.
builders['14-terminal-path-write'] = (d) => {
  scheduledTask(
    d,
    'memory-appender',
    'Append to CLAUDE.md',
    'Writes to ~/.claude/CLAUDE.md and ~/.claude/memory/learnings.md. Sends notification when done.',
  );
  schedulerState(d, [{ id: 'memory-appender', cronExpression: '0 */6 * * *', enabled: true, lastRunAt: new Date().toISOString() }]);
};

// 15. Many small issues — a mixed handful of nice-to-haves.
builders['15-many-small-issues'] = (d) => {
  // Two somewhat-similar skills (nice-to-have overlap)
  skill(d, 'thing-a', 'Do thing A reliably and carefully', 'Does thing A with care and attention to detail and documentation.');
  skill(d, 'thing-b', 'Do thing B reliably and carefully', 'Does thing B with care and attention to detail and documentation.');
  // One skill that writes to a non-terminal path nobody reads (missing_closure)
  skill(d, 'lonely-writer', 'Write a thing', 'Writes to /tmp/lonely/output.log every time.');
};

// 16. One critical (unregistered MCP).
builders['16-one-critical'] = (d) => {
  skill(d, 'reader', 'Read stuff', 'A normal skill that reads from memory.');
  skill(d, 'writer', 'Write stuff', 'A normal skill that writes to the notification channel. Sends notification to user.');
  skill(d, 'broken', 'Calls unregistered MCP', 'When asked, call mcp__missing_server__magic_tool. Nothing else.');
  claudeJson(d, { mcpServers: { existing: { command: 'node' } } });
};

// 17. Multiple criticals.
builders['17-multiple-criticals'] = (d) => {
  // critical 1: unregistered MCP (one skill, one server -> ONE finding)
  skill(d, 'broken-1', 'Use missing MCP 1', 'Call mcp__ghost1__foo regularly.');
  skill(d, 'broken-2', 'Use missing MCP 2', 'Call mcp__ghost2__bar regularly.');
  // critical 2: stale schedule (never-run, enabled)
  scheduledTask(d, 'never-run', 'Never-run task', 'Runs every night.');
  schedulerState(d, [
    {
      id: 'never-run',
      cronExpression: '0 2 * * *',
      enabled: true,
      // No lastRunAt, but createdAt in the distant past to avoid grace period
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    },
  ]);
  // critical 3: expected-job-missing
  expectedJobs(d, [{ name: 'critical-backup-job', cron: '0 3 * * *' }]);
  claudeJson(d, { mcpServers: {} });
};

// 18. Skill references task by name — not orphan.
builders['18-skill-references-task'] = (d) => {
  scheduledTask(d, 'data-crunch', 'Crunch data', 'Runs hourly. Writes to /tmp/crunch/results.json.');
  skill(
    d,
    'crunch-reader',
    'Read data-crunch output',
    'Reads the results from data-crunch and presents them nicely.',
  );
  schedulerState(d, [{ id: 'data-crunch', cronExpression: '0 * * * *', enabled: true, lastRunAt: new Date().toISOString() }]);
};

// 19. Prose reminder — short task with "remind" keyword, not orphan.
builders['19-prose-reminder-task'] = (d) => {
  scheduledTask(
    d,
    'birthday-reminder',
    'Birthday reminder',
    'On the date, remind the user about the birthday. Send a reminder.',
  );
  schedulerState(d, [{ id: 'birthday-reminder', cronExpression: '0 9 * * *', enabled: true, lastRunAt: new Date().toISOString() }]);
};

// 20. Stacked overlaps — 3 skills with similar desc, different prefixes.
//     Should NOT be excluded as suite (no shared prefix).
builders['20-stacked-overlaps-no-suite'] = (d) => {
  const text = 'Review my code carefully for style and correctness issues before committing it to main branch.';
  skill(d, 'quality-gate', 'Review code carefully', text);
  skill(d, 'pre-commit-check', 'Review code carefully', text);
  skill(d, 'style-guardian', 'Review code carefully', text);
};

// 21. Mixed realistic small.
builders['21-mixed-realistic-small'] = (d) => {
  skill(d, 'briefing-formatter', 'Format a daily briefing', 'Reads from ~/.claude/memory/briefing-queue.md and renders a briefing.');
  skill(d, 'task-triage', 'Triage PVS tasks', 'Reviews tasks in the inbox and routes them.');
  skill(d, 'ship', 'Ship code safely', 'Builds, tests, commits, pushes.');
  scheduledTask(d, 'morning-standup', 'Morning standup', 'Sends a notification to the user each morning with the briefing.');
  scheduledTask(d, 'weekly-review', 'Weekly review', 'Creates a Linear issue each Monday summarising the week.');
  claudeJson(d, { mcpServers: { pvs: { command: 'node' } } });
  schedulerState(d, [
    { id: 'morning-standup', cronExpression: '0 8 * * *', enabled: true, lastRunAt: new Date().toISOString() },
    { id: 'weekly-review', cronExpression: '0 9 * * 1', enabled: true, lastRunAt: new Date().toISOString() },
  ]);
};

// 22. Mixed realistic medium with some issues.
builders['22-mixed-realistic-medium'] = (d) => {
  // 8 skills
  skill(d, 'briefing', 'Format briefing', 'Reads ~/.claude/memory/queue.md.');
  skill(d, 'triage', 'Triage tasks', 'Reviews inbox, routes tasks.');
  skill(d, 'ship-safe', 'Ship code safely with tests', 'Builds, tests, commits, pushes.');
  skill(d, 'ship-fast', 'Ship code fast without tests', 'Builds, commits, pushes.'); // similar to ship-safe
  skill(d, 'research', 'Research a topic', 'Searches and summarises.');
  skill(d, 'review-pr', 'Review a PR', 'Reviews code for bugs.');
  skill(d, 'explain', 'Explain code', 'Explains code in plain language.');
  skill(d, 'summarize', 'Summarize text', 'Summarises long text to bullets.');
  // 4 tasks
  scheduledTask(d, 'standup', 'Morning standup', 'Sends notification each morning.');
  scheduledTask(d, 'nightly-scan', 'Nightly security scan', 'Writes findings to /tmp/scan/findings.json.'); // orphan
  scheduledTask(d, 'weekly-report', 'Weekly report', 'Creates a Linear issue summarising the week.');
  scheduledTask(d, 'hourly-ping', 'Hourly ping', 'Sends notification to the user every hour.');
  // 2 MCPs — one registered, one missing (pvs referenced but not registered)
  skill(d, 'uses-pvs', 'Uses PVS tools', 'Calls mcp__pvs_missing__pvs_status often.');
  claudeJson(d, { mcpServers: { pvs: { command: 'node' } } });
  schedulerState(d, [
    { id: 'standup', cronExpression: '0 8 * * *', enabled: true, lastRunAt: new Date().toISOString() },
    { id: 'nightly-scan', cronExpression: '0 2 * * *', enabled: true, lastRunAt: new Date().toISOString() },
    { id: 'weekly-report', cronExpression: '0 9 * * 1', enabled: true, lastRunAt: new Date().toISOString() },
    { id: 'hourly-ping', cronExpression: '0 * * * *', enabled: true, lastRunAt: new Date().toISOString() },
  ]);
};

// 23. Large healthy — 20 skills, 5 tasks, all coherent.
builders['23-large-healthy'] = (d) => {
  for (let i = 0; i < 20; i++) {
    skill(
      d,
      `skill-${String.fromCharCode(97 + (i % 26))}-${i}`,
      `Do unique thing ${i}`,
      `This skill does a distinct task number ${i}. It uses niche vocabulary alpha-${i} beta-${i} gamma-${i}.`,
    );
  }
  for (let i = 0; i < 5; i++) {
    scheduledTask(
      d,
      `job-${i}`,
      `Scheduled job ${i}`,
      `Runs on a schedule. Sends notification to the user with job ${i} output.`,
    );
  }
  schedulerState(
    d,
    Array.from({ length: 5 }, (_, i) => ({
      id: `job-${i}`,
      cronExpression: '0 * * * *',
      enabled: true,
      lastRunAt: new Date().toISOString(),
    })),
  );
};

// 24. Many overlaps — 6 skills pairwise similar.
builders['24-many-overlaps'] = (d) => {
  for (let i = 0; i < 6; i++) {
    skill(
      d,
      `reviewer-${i}`,
      'Review pull requests thoroughly',
      'Reviews pull requests for bugs, style, security, correctness, readability, maintainability.',
    );
  }
};

// 25. No scheduled tasks — skills only.
builders['25-no-scheduled-tasks'] = (d) => {
  for (let i = 0; i < 5; i++) {
    skill(d, `simple-${i}`, `Distinct skill ${i}`, `Does thing ${i} with vocabulary unique-${i}-${i}.`);
  }
};

// ----------------------------------------------------------------------------
// Build
// ----------------------------------------------------------------------------

if (existsSync(FIXTURES_DIR)) {
  rmSync(FIXTURES_DIR, { recursive: true, force: true });
}
mkdirSync(FIXTURES_DIR, { recursive: true });

const names = Object.keys(builders).sort();
for (const name of names) {
  const dir = join(FIXTURES_DIR, name);
  mkdirSync(dir, { recursive: true });
  builders[name](dir);
  console.log(`Built fixture: ${name}`);
}

console.log(`\n${names.length} fixtures written to ${FIXTURES_DIR}`);
