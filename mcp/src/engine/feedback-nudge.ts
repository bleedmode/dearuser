// feedback-nudge — permanent footer + one-time welcome line for every tool output.
//
// Design rules (see memory `feedback_wording_avoid_misreading`):
// - Never use wording that can be misread as "we read your data". The VP is
//   local-only. Every line must frame feedback as the user's active outbound
//   message, not our inbound reading of their files.
// - No modals, no nags, no NPS popups. Footer is a passive signpost; welcome
//   is shown exactly once, ever.
// - The footer must be short — one line, ignorable by anyone not interested.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.dearuser');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const FOOTER_LINE = `Tell us what you think: \`dearuser feedback "..."\``;

const WELCOME_LINES = [
  ``,
  `---`,
  ``,
  `**Thanks for installing.** Your data stays on your machine.`,
  `Feedback for us? \`dearuser feedback "..."\``,
] as const;

interface NudgeState {
  feedbackWelcomeShown?: boolean;
}

interface FullConfig {
  preferences?: Record<string, unknown>;
  nudges?: NudgeState;
  [key: string]: unknown;
}

function readConfig(): FullConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as FullConfig;
  } catch {
    return null;
  }
}

function writeNudgeState(patch: NudgeState): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = readConfig() || {};
  const merged: FullConfig = {
    ...existing,
    nudges: { ...(existing.nudges || {}), ...patch },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

/** Permanent one-line footer appended to every tool output. */
export function feedbackFooter(): string[] {
  return [``, FOOTER_LINE];
}

/**
 * Returns welcome lines the FIRST time this is called ever, then nothing.
 * Flips the `feedbackWelcomeShown` flag on first call. Safe to call from
 * every tool formatter — subsequent calls are cheap no-ops.
 */
export function firstRunWelcome(): string[] {
  const cfg = readConfig();
  if (cfg?.nudges?.feedbackWelcomeShown) return [];
  writeNudgeState({ feedbackWelcomeShown: true });
  return [...WELCOME_LINES];
}
