// secret-scanner — pattern-match for credentials leaked into CLAUDE.md,
// memory files, skills, scheduled tasks, and settings.
//
// Conservative: false positives are worse than false negatives here because
// a "you have a leaked key!" false alarm erodes trust fast. Every pattern
// must match a recognisable token prefix — we do NOT flag arbitrary 32-char
// hex strings or base64-looking blobs (too many commit hashes, nonces, IDs).

import type { AuditArtifact, FileInfo, GapSeverity } from '../types.js';

export type SecretCategory =
  | 'openai_key'
  | 'anthropic_key'
  | 'github_token'
  | 'stripe_key'
  | 'aws_key'
  | 'slack_token'
  | 'google_api_key'
  | 'supabase_key'
  | 'vercel_token'
  | 'private_key'
  | 'env_secret'
  | 'bearer_token';

export interface SecretFinding {
  id: string;
  category: SecretCategory;
  severity: GapSeverity;
  title: string;
  location: string;          // file path
  excerpt: string;           // redacted preview (first 4 chars of secret + ...)
  lineNumber?: number;
  recommendation: string;
}

interface Pattern {
  category: SecretCategory;
  severity: GapSeverity;
  /** Regex that MUST include a capture group for the token body. */
  regex: RegExp;
  description: string;
  /** Extra validator to reject false positives — e.g., commit hash shape. */
  validate?: (match: string) => boolean;
}

// ============================================================================
// Secret patterns — prefix-anchored, high precision
// ============================================================================

const PATTERNS: Pattern[] = [
  {
    category: 'openai_key',
    severity: 'critical',
    // Negative lookahead for `ant-` so we don't double-flag Anthropic keys.
    regex: /\b(sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    description: 'OpenAI API key',
  },
  {
    category: 'anthropic_key',
    severity: 'critical',
    regex: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    description: 'Anthropic API key',
  },
  {
    category: 'github_token',
    severity: 'critical',
    regex: /\b(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/g,
    description: 'GitHub personal access token',
  },
  {
    category: 'stripe_key',
    severity: 'critical',
    regex: /\b(sk_live_[A-Za-z0-9]{20,}|pk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,})\b/g,
    description: 'Stripe API key',
  },
  {
    category: 'aws_key',
    severity: 'critical',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    description: 'AWS access key ID',
  },
  {
    category: 'slack_token',
    severity: 'critical',
    regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    description: 'Slack token',
  },
  {
    category: 'google_api_key',
    severity: 'critical',
    regex: /\b(AIza[A-Za-z0-9_-]{35})\b/g,
    description: 'Google API key',
  },
  {
    category: 'supabase_key',
    severity: 'critical',
    regex: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,})\b/g,
    description: 'JWT-shaped token (Supabase, Auth0, etc.)',
    validate: (s) => {
      // JWT has 3 segments — accept only if middle segment looks base64-ish and >20 chars
      const parts = s.split('.');
      return parts.length === 3 && parts[1].length >= 20;
    },
  },
  {
    category: 'vercel_token',
    severity: 'critical',
    regex: /\b([A-Za-z0-9]{24})\b/g, // Vercel tokens are 24-char alnum — low-specificity, validated
    description: 'Possible Vercel token',
    validate: (s) => {
      // Only flag if context hint is present — the regex alone is too broad
      // (catches any 24-char alnum). We rely on contextual detection elsewhere.
      return false; // disabled by default; re-enable when we have context heuristics
    },
  },
  {
    category: 'private_key',
    severity: 'critical',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    description: 'Embedded private key',
  },
  {
    category: 'env_secret',
    severity: 'recommended',
    // "SECRET=..." or "PASSWORD=..." or "TOKEN=..." with an assigned value
    // Capture group includes the key name so we can surface which one
    regex: /\b([A-Z][A-Z0-9_]{2,}(?:SECRET|PASSWORD|TOKEN|APIKEY|API_KEY|PRIVATE|CREDENTIALS))\s*=\s*["']?([A-Za-z0-9+/_\-=.]{12,})["']?/g,
    description: '.env-style secret assignment',
    validate: (s) => {
      // Reject placeholder values
      const placeholders = ['your_key_here', 'xxxxx', 'changeme', 'todo', 'example', 'placeholder', 'secret_here'];
      return !placeholders.some(p => s.toLowerCase().includes(p));
    },
  },
  {
    category: 'bearer_token',
    severity: 'recommended',
    regex: /\b(?:Bearer|Authorization:\s*Bearer)\s+([A-Za-z0-9_\-.]{30,})/g,
    description: 'Bearer token in headers',
  },
];

// ============================================================================
// Scanning
// ============================================================================

/** Redact: show first 4 and last 2 chars, hide the middle. */
function redact(secret: string): string {
  if (secret.length <= 10) return secret.slice(0, 2) + '****';
  return secret.slice(0, 4) + '...' + secret.slice(-2);
}

/** Line number of a character index in a string (1-indexed). */
function lineNumberOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

/** Scan a blob of text for secret-ish patterns. Returns findings. */
function scanText(content: string, location: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    let match: RegExpExecArray | null;
    pattern.regex.lastIndex = 0;
    while ((match = pattern.regex.exec(content)) !== null) {
      const token = match[1] || match[0];
      if (pattern.validate && !pattern.validate(token)) continue;

      const dedupKey = `${pattern.category}:${token.slice(0, 10)}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      findings.push({
        id: `secret:${pattern.category}:${location}:${match.index}`,
        category: pattern.category,
        severity: pattern.severity,
        title: `${pattern.description} found in ${location.split('/').pop()}`,
        location,
        excerpt: redact(token),
        lineNumber: lineNumberOf(content, match.index),
        recommendation: `Remove this secret from ${location} immediately. Rotate the credential — assume it\'s compromised if this file was ever committed to git or shared. Move to a secrets manager (1Password CLI, Doppler, or a .env file excluded via .gitignore).`,
      });
    }
  }
  return findings;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Scan artifacts (skills, scheduled tasks, memory files, hooks as JSON strings)
 * AND raw text files (CLAUDE.md, settings.json) for leaked secrets.
 */
export function scanSecrets(
  artifacts: AuditArtifact[],
  claudeMdFiles: FileInfo[],
  settingsFiles: FileInfo[],
): SecretFinding[] {
  const findings: SecretFinding[] = [];

  // Artifacts — scan the prompt/body
  for (const a of artifacts) {
    if (!a.prompt) continue;
    findings.push(...scanText(a.prompt, a.path));
  }

  // CLAUDE.md files
  for (const f of claudeMdFiles) {
    findings.push(...scanText(f.content, f.path));
  }

  // settings.json & similar — these often legitimately contain env-style keys
  // for MCP server configs, but those should reference secrets via ${env:VAR}
  // not inline them. Flag inline values.
  for (const f of settingsFiles) {
    findings.push(...scanText(f.content, f.path));
  }

  // Dedupe globally by id
  const seen = new Set<string>();
  const unique: SecretFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    unique.push(f);
  }

  const order: Record<GapSeverity, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  unique.sort((a, b) => order[a.severity] - order[b.severity]);
  return unique;
}
