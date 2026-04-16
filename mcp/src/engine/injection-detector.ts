// injection-detector — pattern-match hooks, skills, and commands for
// prompt-injection surfaces.
//
// Prompt injection in the agent context comes in several flavours:
//   1. Shell injection via unescaped user input in hooks
//      (e.g. `bash -c "echo $CLAUDE_TOOL_INPUT"` where input is untrusted)
//   2. Agent-level injection via $ARGUMENTS passed straight into eval/bash
//   3. MCP servers that shell out to untrusted strings
//   4. Missing `set -e` / error handling in hooks → silent failures
//
// This is static pattern matching — false positives are possible. We flag
// suspicious patterns but rate severity conservatively. The goal is to surface
// things worth a manual look, not to claim a vulnerability definitively.

import type { AuditArtifact, GapSeverity, OwaspAgenticCategory } from '../types.js';

export type InjectionCategory =
  | 'shell_unquoted_var'
  | 'user_input_to_bash'
  | 'eval_in_skill'
  | 'hook_missing_set_e'
  | 'mcp_shell_template'
  | 'arguments_to_sensitive_cmd';

export interface InjectionFinding {
  id: string;
  category: InjectionCategory;
  severity: GapSeverity;
  title: string;
  artifactId: string;
  artifactPath: string;
  excerpt: string;
  why: string;
  recommendation: string;
  owaspCategory?: OwaspAgenticCategory;
}

/** Environment / argument variables whose values we do NOT control. */
const UNTRUSTED_VARS = [
  '\\$CLAUDE_TOOL_INPUT',
  '\\$CLAUDE_HOOK_INPUT',
  '\\$TOOL_INPUT',
  '\\$ARGUMENTS',
  '\\$CLAUDE_FILE_PATHS',
  '\\$CLAUDE_FILE',
  '\\$CLAUDE_USER_MESSAGE',
];

/** Commands that should never receive untrusted input without strong validation. */
const SENSITIVE_COMMANDS = [
  'rm',
  'curl',
  'wget',
  'eval',
  'bash\\s+-c',
  'sh\\s+-c',
  'zsh\\s+-c',
  'ssh',
  'scp',
  'find.*-exec',
  'xargs',
  'sudo',
];

function makeId(category: string, artifactId: string, hash: string): string {
  return `injection:${category}:${artifactId}:${hash}`.toLowerCase().replace(/[^\w:]+/g, '-');
}

function quickHash(s: string): string {
  // Small deterministic hash so finding ids are stable run-to-run
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}

function excerpt(content: string, matchIndex: number, matchLength: number, context = 60): string {
  const start = Math.max(0, matchIndex - context);
  const end = Math.min(content.length, matchIndex + matchLength + context);
  const snippet = content.slice(start, end).replace(/\n/g, ' ').trim();
  return snippet.length > 200 ? snippet.slice(0, 197) + '…' : snippet;
}

// ============================================================================
// Detectors
// ============================================================================

/** Untrusted variable used unquoted in a shell context. */
function detectUnquotedVars(artifact: AuditArtifact): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const content = artifact.prompt;
  if (!content) return findings;

  for (const varPattern of UNTRUSTED_VARS) {
    // Match: something followed by $VAR not inside "..." or '...' quotes
    // Heuristic: look for the var with no surrounding double-quote on left
    // within 30 chars. False-positive-prone; treat as recommended, not critical.
    const regex = new RegExp(`(?<!["'])(${varPattern})(?!["'])`, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      // Quick check: is the variable inside a quoted string? Find last `"` or `'`
      // before the match and see if it's matched after.
      const before = content.slice(Math.max(0, match.index - 80), match.index);
      const openDouble = (before.match(/"/g) || []).length % 2 === 1;
      const openSingle = (before.match(/'/g) || []).length % 2 === 1;
      if (openDouble || openSingle) continue; // inside quotes → safe-ish

      const snippet = excerpt(content, match.index, match[0].length);
      findings.push({
        id: makeId('shell_unquoted_var', artifact.id, quickHash(snippet)),
        category: 'shell_unquoted_var',
        severity: 'recommended',
        title: `Unquoted untrusted variable ${match[0]} in ${artifact.name}`,
        artifactId: artifact.id,
        artifactPath: artifact.path,
        excerpt: snippet,
        why: 'Untrusted input spliced into a shell command without quoting can be interpreted as code if it contains spaces, semicolons, or backticks.',
        recommendation: `Quote the variable: \`"${match[0]}"\`. Better yet, validate input shape before using it (e.g., only allow alphanumeric).`,
        owaspCategory: 'ASI-01',
      });
    }
  }

  return findings;
}

/** $ARGUMENTS or $CLAUDE_* piped to a sensitive command. */
function detectUserInputToSensitiveCmd(artifact: AuditArtifact): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  const content = artifact.prompt;
  if (!content) return findings;

  for (const cmd of SENSITIVE_COMMANDS) {
    for (const varPattern of UNTRUSTED_VARS) {
      // "<sensitive cmd> ... <untrusted var>" within 80 chars
      const regex = new RegExp(`${cmd}[^\\n]{0,80}${varPattern}`, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const snippet = excerpt(content, match.index, match[0].length);
        findings.push({
          id: makeId('arguments_to_sensitive_cmd', artifact.id, quickHash(snippet)),
          category: 'arguments_to_sensitive_cmd',
          severity: 'critical',
          title: `Untrusted input passed to ${cmd.replace(/\\\\s\\+/g, ' ')} in ${artifact.name}`,
          artifactId: artifact.id,
          artifactPath: artifact.path,
          excerpt: snippet,
          why: `A sensitive command (${cmd.replace(/\\\\s\\+/g, ' ')}) is invoked with user-controlled input. Even a single crafted prompt could delete files, exfiltrate data, or run arbitrary code.`,
          recommendation: 'Validate and sanitise the input before use. For unavoidable cases, use argument arrays (exec instead of shell) so metacharacters cannot be interpreted.',
          owaspCategory: 'ASI-05',
        });
      }
    }
  }

  return findings;
}

/** `eval` on any substituted string in a skill prompt. Always flag. */
function detectEvalInSkill(artifact: AuditArtifact): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  if (artifact.type !== 'skill' && artifact.type !== 'command' && artifact.type !== 'scheduled_task') return findings;
  const content = artifact.prompt;
  if (!content) return findings;

  // `eval ` or `eval "$..."` or `eval $...`
  const regex = /\beval\s+[$"']/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const snippet = excerpt(content, match.index, 20);
    findings.push({
      id: makeId('eval_in_skill', artifact.id, quickHash(snippet)),
      category: 'eval_in_skill',
      severity: 'critical',
      title: `\`eval\` used in ${artifact.name}`,
      artifactId: artifact.id,
      artifactPath: artifact.path,
      excerpt: snippet,
      why: '`eval` executes arbitrary strings. If any substituted value is under an attacker\'s control, it becomes remote code execution.',
      recommendation: 'Rewrite without eval — use arrays, dispatch tables, or typed function calls.',
      owaspCategory: 'ASI-05',
    });
  }

  return findings;
}

/** Hooks that use bash without `set -e` — errors go unnoticed. */
function detectHookMissingSetE(artifact: AuditArtifact): InjectionFinding[] {
  if (artifact.type !== 'hook') return [];
  const content = artifact.prompt;
  if (!content) return [];
  if (!/\bbash\b|\bsh\b|\bzsh\b/.test(content)) return [];
  if (/set\s+-[eu]/.test(content)) return [];
  if (content.length < 40) return []; // very short hooks — noise not worth flagging

  return [{
    id: makeId('hook_missing_set_e', artifact.id, quickHash(content)),
    category: 'hook_missing_set_e',
    severity: 'nice_to_have',
    title: `Hook "${artifact.name}" has no \`set -e\` — errors silent-fail`,
    artifactId: artifact.id,
    artifactPath: artifact.path,
    excerpt: content.slice(0, 200),
    why: 'Shell hooks without `set -e` continue past failed commands. A broken hook can look like it worked for weeks.',
    recommendation: 'Start the hook with `set -eo pipefail` so a failed command aborts and surfaces the error.',
    owaspCategory: 'ASI-08',
  }];
}

/** MCP server configs that shell out to user-provided string interpolation. */
function detectMcpShellTemplates(artifact: AuditArtifact): InjectionFinding[] {
  if (artifact.type !== 'mcp_server') return [];
  const content = artifact.prompt; // we stored the JSON stringified config
  if (!content) return [];

  // MCP server with bash/sh command and templated args — worth a look
  // Heuristic: command contains sh/bash AND any args field contains ${...}
  if (/"command"\s*:\s*"(?:bash|sh|zsh)"/.test(content) && /\$\{[^}]+\}/.test(content)) {
    return [{
      id: makeId('mcp_shell_template', artifact.id, quickHash(content)),
      category: 'mcp_shell_template',
      severity: 'recommended',
      title: `MCP server "${artifact.name}" shells out with templated args`,
      artifactId: artifact.id,
      artifactPath: artifact.path,
      excerpt: content.slice(0, 200),
      why: 'MCP servers invoked via shell with interpolated strings can execute unintended commands if any interpolated value is agent-controlled.',
      recommendation: 'Prefer a direct executable (node/python/go binary) over bash wrappers. If you must shell, validate each interpolated value.',
      owaspCategory: 'ASI-02',
    }];
  }
  return [];
}

// ============================================================================
// Orchestration
// ============================================================================

export function detectInjection(artifacts: AuditArtifact[]): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const artifact of artifacts) {
    findings.push(...detectUnquotedVars(artifact));
    findings.push(...detectUserInputToSensitiveCmd(artifact));
    findings.push(...detectEvalInSkill(artifact));
    findings.push(...detectHookMissingSetE(artifact));
    findings.push(...detectMcpShellTemplates(artifact));
  }

  // Dedupe by id and sort: critical → recommended → nice_to_have
  const seen = new Set<string>();
  const unique: InjectionFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  const order: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  unique.sort((a, b) => order[a.severity] - order[b.severity]);

  return unique;
}
