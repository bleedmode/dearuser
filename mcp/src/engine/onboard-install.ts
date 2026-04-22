// onboard-install.ts — auto-install everything a new Dear User user needs
// so they don't have to paste config snippets around. Each installer is
// idempotent and returns a structured result the onboarding finale can show
// as "I took care of this for you."
//
// Philosophy: the Lovable-segment user shouldn't learn what CLAUDE.md, hooks,
// or skills are just to use Dear User. We write the files, they press Next.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { implementClaudeMdAppend, implementSettingsMerge } from './implementer.js';
import type { LocalizedString } from './friendly-labels.js';
import type { OnboardState } from '../tools/onboard.js';
import { detectPlatforms } from '../tools/onboard.js';

export interface InstallStep {
  /** Short title in both languages. */
  title: LocalizedString;
  /** Did the write succeed? (true also covers "already there, no-op".) */
  ok: boolean;
  /** Human-readable detail — backup path, failure reason, etc. */
  detail?: string;
}

// ----------------------------------------------------------------------------
// 1. Skills — copy bundled mcp/skills/dearuser-*/ into ~/.claude/skills/.
// Mirrors the logic in src/install-skills.ts but callable from onboarding.
// ----------------------------------------------------------------------------
export function installDearUserSkills(): InstallStep {
  // esbuild banner defines __dirname. Skills sit one level up from dist/.
  const skillsSrc = join(__dirname, '..', 'skills');
  const skillsDest = join(homedir(), '.claude', 'skills');

  if (!existsSync(skillsSrc)) {
    return {
      title: { da: 'Installeret Dear User skills', en: 'Installed Dear User skills' },
      ok: false,
      detail: `Skills not found at ${skillsSrc}`,
    };
  }

  try {
    mkdirSync(skillsDest, { recursive: true });
    const skills = readdirSync(skillsSrc, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('dearuser-'))
      .map(e => e.name);

    for (const skill of skills) {
      cpSync(join(skillsSrc, skill), join(skillsDest, skill), { recursive: true, force: true });
    }
    return {
      title: {
        da: `Installeret ${skills.length} Dear User skills`,
        en: `Installed ${skills.length} Dear User skills`,
      },
      ok: true,
    };
  } catch (err) {
    return {
      title: { da: 'Installeret Dear User skills', en: 'Installed Dear User skills' },
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ----------------------------------------------------------------------------
// 2. CLAUDE.md — minimal, honest registration. No fake autonomy rules based on
// six shallow questions; just tell the agent Dear User is here.
// ----------------------------------------------------------------------------
export function registerDearUserInClaudeMd(state: OnboardState): InstallStep {
  const title = { da: 'Registreret Dear User i CLAUDE.md', en: 'Registered Dear User in CLAUDE.md' };

  // Idempotency beyond exact-block match: if the user already has a
  // Dear User heading anywhere, don't append a second one — they (or a
  // previous onboarding) set it up already.
  const claudeMd = join(homedir(), '.claude', 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    try {
      const contents = readFileSync(claudeMd, 'utf-8');
      if (/^##\s+Dear User\b/m.test(contents)) {
        return { title, ok: true, detail: 'already registered' };
      }
    } catch { /* fall through to append */ }
  }

  const name = state.name ? ` for ${state.name}` : '';
  const block = `## Dear User

The user${name} has Dear User installed — an AI collaboration watchdog that writes small letters about how we work together.

When they ask for one of these, use the matching MCP tool:
- \`/dearuser-collab\` → \`mcp__dearuser__collab\` (how we collaborate)
- \`/dearuser-health\` → \`mcp__dearuser__health\` (setup health)
- \`/dearuser-security\` → \`mcp__dearuser__security\` (secret / injection scan)
- \`/dearuser-wrapped\` → \`mcp__dearuser__wrapped\` (shareable stats)

Dashboard: http://localhost:7700 — Config: ~/.dearuser/config.json`;

  const result = implementClaudeMdAppend(block);
  return {
    title,
    ok: result.ok,
    detail: result.error || result.summary,
  };
}

// ----------------------------------------------------------------------------
// 3. Protected-files hook — blocks accidental writes to .env, credentials,
// and production configs. Added to ~/.claude/settings.json as a PreToolUse hook.
// Vibe coders love this because one mis-aimed Edit shouldn't leak a secret.
// ----------------------------------------------------------------------------
export function installProtectedFilesHook(): InstallStep {
  const snippet = JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write|MultiEdit',
          hooks: [
            {
              type: 'command',
              // Shell check: if the target path matches a sensitive pattern,
              // exit non-zero which Claude Code surfaces as a block.
              command: `jq -r '.tool_input.file_path // empty' | grep -E '\\.(env|env\\..+|pem|key)$|/(credentials|secrets)\\.|\\.aws/credentials|\\.ssh/' && { echo "Dear User blocked: protected file. Ask the user first."; exit 2; } || exit 0`,
            },
          ],
        },
      ],
    },
  });

  const result = implementSettingsMerge(snippet);
  return {
    title: {
      da: 'Beskyttet .env og credentials mod utilsigtede skrivninger',
      en: 'Protected .env and credentials from accidental writes',
    },
    ok: result.ok,
    detail: result.error || result.summary,
  };
}

// ----------------------------------------------------------------------------
// 4. Shell profile — ensure ENABLE_TOOL_SEARCH=auto so MCP tools load on the
// first message of a new session (otherwise they're deferred and /dearuser-*
// fails on turn 1). Detect zsh/bash and append with a backup.
// ----------------------------------------------------------------------------
export function ensureToolSearchAuto(): InstallStep {
  const title = {
    da: 'Sat MCP tools til at loade straks (ENABLE_TOOL_SEARCH=auto)',
    en: 'Set MCP tools to load immediately (ENABLE_TOOL_SEARCH=auto)',
  };

  const shell = process.env.SHELL || '';
  const profile = shell.includes('zsh')
    ? join(homedir(), '.zshrc')
    : shell.includes('bash')
      ? join(homedir(), '.bashrc')
      : null;

  if (!profile) {
    return {
      title,
      ok: false,
      detail: `Unknown shell (${shell || 'no $SHELL'}) — skipped`,
    };
  }

  try {
    const existing = existsSync(profile) ? readFileSync(profile, 'utf-8') : '';
    // Idempotent: skip if already set (any value) or our block is there.
    if (/ENABLE_TOOL_SEARCH\s*=/.test(existing)) {
      return { title, ok: true, detail: 'already set' };
    }

    // Backup before touching a shell profile.
    const backupDir = join(homedir(), '.dearuser', 'backups');
    mkdirSync(backupDir, { recursive: true });
    const backup = join(backupDir, `${profile.split('/').pop()}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
    if (existsSync(profile)) copyFileSync(profile, backup);

    const block = `\n# Added by Dear User — loads MCP tools immediately instead of lazily.\nexport ENABLE_TOOL_SEARCH=auto\n`;
    writeFileSync(profile, existing + block, 'utf-8');
    return { title, ok: true, detail: `appended to ${profile}` };
  } catch (err) {
    return { title, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

// ----------------------------------------------------------------------------
// 5. Platform connect — for each detected platform (github, supabase, vercel),
// check if it's already authenticated. If not, return a ready-to-paste prompt
// the user can send to their agent. No digging through docs.
// ----------------------------------------------------------------------------
export type PlatformId = 'git' | 'github' | 'supabase' | 'vercel';

export interface PlatformStatus {
  id: PlatformId;
  label: string;
  /** 'connected' — nothing needed. 'needs-setup' — show the agent prompt. */
  state: 'connected' | 'needs-setup';
  /** Ready-to-paste prompt the user sends to their agent. Null if connected. */
  prompt: LocalizedString | null;
}

function ghIsLoggedIn(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch { return false; }
}

function hasEnvToken(varName: string): boolean {
  return !!process.env[varName];
}

function configHasToken(key: 'supabase' | 'vercel'): boolean {
  try {
    const configPath = join(homedir(), '.dearuser', 'config.json');
    if (!existsSync(configPath)) return false;
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    const token = cfg?.tokens?.[key];
    return typeof token === 'string' && token.length > 0;
  } catch { return false; }
}

/**
 * Detect platforms the user has in their projects and check which are
 * already connected. Returns only the detected ones — if they don't have
 * Supabase, we don't mention it.
 */
export function detectPlatformStatus(): PlatformStatus[] {
  const searchCandidates = ['code', 'projects', 'work', 'src', 'dev', 'clawd'];
  const searchRoots: string[] = [];
  for (const name of searchCandidates) {
    const p = join(homedir(), name);
    try { if (statSync(p).isDirectory()) searchRoots.push(p); } catch { /* skip */ }
  }
  const detected = detectPlatforms(searchRoots);

  const statuses: PlatformStatus[] = [];

  if (detected.has('github')) {
    const connected = ghIsLoggedIn();
    statuses.push({
      id: 'github',
      label: 'GitHub',
      state: connected ? 'connected' : 'needs-setup',
      prompt: connected ? null : {
        da: `Kør 'gh auth login' i min terminal så Dear User kan læse min GitHubs sikkerhedsalarmer (Dependabot, secret scanning).`,
        en: `Run 'gh auth login' in my terminal so Dear User can read my GitHub security alerts (Dependabot, secret scanning).`,
      },
    });
  }

  if (detected.has('supabase')) {
    const connected = hasEnvToken('SUPABASE_ACCESS_TOKEN') || configHasToken('supabase');
    statuses.push({
      id: 'supabase',
      label: 'Supabase',
      state: connected ? 'connected' : 'needs-setup',
      prompt: connected ? null : {
        da: `Hjælp mig med at forbinde Dear User til Supabase: åbn https://supabase.com/dashboard/account/tokens, lav en access token, og gem den i ~/.dearuser/config.json under tokens.supabase.`,
        en: `Help me connect Dear User to Supabase: open https://supabase.com/dashboard/account/tokens, create an access token, and save it to ~/.dearuser/config.json under tokens.supabase.`,
      },
    });
  }

  if (detected.has('vercel')) {
    const connected = hasEnvToken('VERCEL_TOKEN') || configHasToken('vercel');
    statuses.push({
      id: 'vercel',
      label: 'Vercel',
      state: connected ? 'connected' : 'needs-setup',
      prompt: connected ? null : {
        da: `Hjælp mig med at forbinde Dear User til Vercel: åbn https://vercel.com/account/tokens, lav en token, og gem den i ~/.dearuser/config.json under tokens.vercel.`,
        en: `Help me connect Dear User to Vercel: open https://vercel.com/account/tokens, create a token, and save it to ~/.dearuser/config.json under tokens.vercel.`,
      },
    });
  }

  return statuses;
}

// ----------------------------------------------------------------------------
// 6. Scheduled task — can't write this ourselves (scheduled-tasks is a
// separate MCP owned by Claude Code). Return a ready-to-paste prompt so the
// user sends one message to their agent instead of reading a tutorial.
// ----------------------------------------------------------------------------
export function buildScheduledTaskPrompt(state: OnboardState): LocalizedString | null {
  if (!state.cadence || state.cadence === 'on-demand') return null;

  switch (state.cadence) {
    case 'daily':
      return {
        da: `Opret en scheduled task der hver morgen kl 9 kører /dearuser-collab og sender mig et brev om hvordan jeg og min agent arbejder sammen.`,
        en: `Create a scheduled task that runs /dearuser-collab every morning at 9 am and sends me a letter about how my agent and I are working together.`,
      };
    case 'weekly':
      return {
        da: `Opret en scheduled task der hver fredag kl 16 kører /dearuser-collab og sender mig et ugentligt brev om samarbejdet.`,
        en: `Create a scheduled task that runs /dearuser-collab every Friday at 4 pm and sends me a weekly letter about the collaboration.`,
      };
    case 'event':
      return {
        da: `Sæt et hook op så /dearuser-health kører hver gang jeg ændrer noget i ~/.claude/settings.json eller tilføjer en ny skill.`,
        en: `Set up a hook so /dearuser-health runs every time I change ~/.claude/settings.json or add a new skill.`,
      };
  }
  return null;
}
