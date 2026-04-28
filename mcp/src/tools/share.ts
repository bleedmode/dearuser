// share_report tool — generate a public shareable URL for a Dear User report.
//
// Why this exists: viral distribution. HubSpot Grader got 40K backlinks from
// exactly this pattern — users share their score, others audit back. Dear
// User's scans are local-only by design, so this is the ONE bit of data we
// ever upload, and only with an explicit tool call.
//
// Contract:
//   input:  { report_type, report_json, expires_at? }
//   output: { token, url }
//
// Privacy:
//   - Strips absolute paths (`/Users/foo/...`, `C:\Users\foo\...`) to basenames.
//   - Strips email addresses.
//   - Runs the report JSON through our own secret-scanner patterns and
//     redacts any match before upload.
//   - Never stores user email, project root, or any absolute filesystem path.
//
// Transport:
//   - Upserts via Supabase REST (service_role key). Dear User's OWN database
//     is local SQLite — this is intentional: only the *shared* subset ever
//     leaves the machine, and only when the user explicitly opts in.
//   - Env vars: DEARUSER_SUPABASE_URL + DEARUSER_SUPABASE_SERVICE_KEY.
//     Falls back to SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.

import { randomBytes } from 'crypto';

export interface ShareInput {
  report_type: 'collab' | 'security' | 'health' | 'wrapped';
  report_json: Record<string, unknown>;
  expires_at?: string;
}

export interface ShareResult {
  token: string;
  url: string;
}

function getBaseUrl(): string {
  return process.env.DEARUSER_PUBLIC_BASE_URL || 'https://dearuser.ai';
}

// URL-safe alphabet (no look-alike pairs like O/0, I/l, no padding chars).
// 10 chars × 57 alphabet = 57^10 ≈ 2^58 — plenty of entropy and short
// enough to be share-friendly. Tokens act as capabilities: whoever has it
// can read the report, so they must be unguessable but don't need to be
// cryptographically indistinguishable from random (network latency +
// rate-limiting makes brute force infeasible at this length).
const TOKEN_ALPHABET =
  'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateToken(length = 10): string {
  const alphabet = TOKEN_ALPHABET;
  const max = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(length)) {
      if (b >= max) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

// ============================================================================
// Anonymization
// ============================================================================

// Absolute paths on macOS/Linux (/Users/..., /home/..., /tmp/...), plus
// the generic root-anchored path shape. We collapse the path to its
// basename so a report like "/Users/karlo/secret-startup/code" becomes
// just "code" — no identity leak, no directory structure leak.
const POSIX_ABS_PATH = /(?<![A-Za-z0-9_])\/(?:Users|home|tmp|var|opt|etc|Volumes|private|root|mnt|usr\/local)\/[^\s"'`<>\]]+/g;
const WINDOWS_ABS_PATH = /(?<![A-Za-z0-9_])[A-Z]:\\(?:Users|Documents and Settings|Windows)\\[^\s"'`<>\]]+/gi;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Secret patterns — mirror the high-precision ones from secret-scanner.ts.
// We redact in the uploaded JSON so nothing toxic ever reaches the public
// surface. Conservative: if a pattern fires, we'd rather over-redact a
// commit hash than leak a real key.
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,      // OpenAI
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,                    // Anthropic
  /\bghp_[A-Za-z0-9]{36,}\b/g,                         // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g,                 // GitHub fine-grained
  /\bsk_live_[A-Za-z0-9]{20,}\b/g,                     // Stripe live
  /\bpk_live_[A-Za-z0-9]{20,}\b/g,                     // Stripe publishable
  /\bsk_test_[A-Za-z0-9]{20,}\b/g,                     // Stripe test
  /\bAKIA[0-9A-Z]{16}\b/g,                             // AWS access key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,                 // Slack
  /\bAIza[A-Za-z0-9_-]{35}\b/g,                        // Google API
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\b/g, // JWT
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
];

function anonymizeString(s: string): string {
  let out = s;
  // Paths first — collapse to basename so the final string is shorter and
  // downstream regex passes don't catch partial path fragments.
  out = out.replace(POSIX_ABS_PATH, (match) => {
    const parts = match.split('/').filter(Boolean);
    return parts[parts.length - 1] || '[redacted-path]';
  });
  out = out.replace(WINDOWS_ABS_PATH, (match) => {
    const parts = match.split('\\').filter(Boolean);
    return parts[parts.length - 1] || '[redacted-path]';
  });
  out = out.replace(EMAIL_REGEX, '[redacted-email]');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, '[redacted-secret]');
  }
  return out;
}

/**
 * Deep-clone-and-sanitize a report JSON blob. Preserves structure and
 * numeric/boolean values; rewrites strings through anonymizeString.
 *
 * Guarded against cycles (report JSON coming from our tools should be
 * tree-shaped, but we're paranoid — a self-reference would hang the upload).
 */
export function anonymizeReport(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return anonymizeString(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) {
    if (seen.has(input)) return '[circular]';
    seen.add(input);
    return input.map((v) => anonymizeReport(v, seen));
  }
  if (typeof input === 'object') {
    if (seen.has(input as object)) return '[circular]';
    seen.add(input as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Skip fields we know carry raw local paths / identifying context.
      // Callers shouldn't rely on these surviving the upload.
      if (k === '_projectRoot' || k === 'projectRoot' || k === '_localPath') {
        continue;
      }
      out[k] = anonymizeReport(v, seen);
    }
    return out;
  }
  // functions, symbols, bigints — drop.
  return undefined;
}

// ============================================================================
// Denormalization helpers — for social card / index
// ============================================================================

/**
 * Extract a display-friendly project name from the report. Basename only,
 * never an absolute path. Falls back to the report type if nothing usable
 * is present.
 */
export function extractProjectName(report: Record<string, unknown>): string | null {
  const candidate =
    (report as any).projectName ||
    (report as any).project_name ||
    (report as any).project ||
    null;
  if (typeof candidate === 'string' && candidate.trim()) {
    // If somehow an absolute path made it through, collapse to basename.
    const anon = anonymizeString(candidate);
    return anon.trim().slice(0, 64) || null;
  }
  return null;
}

/**
 * Extract the headline score for the social card. Different report types
 * store it in different fields — we check the common ones in priority
 * order. Returns null if nothing numeric is found (social card falls back
 * to showing archetype / title instead).
 */
export function extractScore(report: Record<string, unknown>): number | null {
  const candidates = [
    (report as any).collaborationScore,
    (report as any).score,
    (report as any).healthScore,
    (report as any).securityScore,
    (report as any).overall?.score,
  ];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) {
      return Math.max(0, Math.min(100, Math.round(c)));
    }
  }
  return null;
}

// ============================================================================
// Supabase transport
// ============================================================================

function getSupabaseEnv(): { url: string; key: string } | null {
  // 1. Environment variables — the canonical production path
  let url =
    process.env.DEARUSER_SUPABASE_URL || process.env.SUPABASE_URL || '';
  let key =
    process.env.DEARUSER_SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';

  // 2. Fallback: ~/.dearuser/config.json { tokens: { supabase_url, supabase_service_key } }
  //    Lets a local dashboard keep working across restarts without
  //    re-exporting env vars every session.
  if (!url || !key) {
    try {
      const os = require('node:os');
      const fs = require('node:fs');
      const path = require('node:path');
      const p = path.join(os.homedir(), '.dearuser', 'config.json');
      if (fs.existsSync(p)) {
        const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
        const t = cfg?.tokens || {};
        url = url || t.supabase_url || '';
        key = key || t.supabase_service_key || '';
      }
    } catch {
      // Config file unreadable — silently fall through to null return.
    }
  }

  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * POST the anonymized row to Supabase. Returns void on success, throws on
 * failure — the caller wraps in try/catch and surfaces a user-friendly
 * error. We use the REST endpoint (no client SDK needed) to keep the
 * dependency surface tiny.
 */
async function insertSharedReport(row: {
  token: string;
  report_type: string;
  report_json: unknown;
  project_name: string | null;
  score: number | null;
  expires_at: string | null;
}): Promise<void> {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      'Supabase credentials not configured. Set DEARUSER_SUPABASE_URL and DEARUSER_SUPABASE_SERVICE_KEY to enable share_report.',
    );
  }

  const res = await fetch(`${env.url}/rest/v1/du_shared_reports`, {
    method: 'POST',
    headers: {
      apikey: env.key,
      Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json',
      // Prefer: return=minimal keeps the response tiny — we already have
      // the token locally, no reason to round-trip the row back.
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Supabase insert failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
}

// ============================================================================
// Public entry point
// ============================================================================

export async function runShareReport(input: ShareInput): Promise<ShareResult> {
  if (!input || typeof input !== 'object') {
    throw new Error('share_report requires an input object.');
  }
  // Pre-launch: wrapped is the only shareable report type. Collab/health/
  // security reports carry findings text that can contain business context
  // non-technical users can't audit before sharing — too high a leak risk
  // for a product positioned on local-only privacy.
  if (input.report_type !== 'wrapped') {
    throw new Error(
      `share_report is restricted to report_type='wrapped'. Collab/health/security reports are not shareable.`,
    );
  }
  if (!input.report_json || typeof input.report_json !== 'object') {
    throw new Error('share_report requires a report_json object.');
  }

  const anonymized = anonymizeReport(input.report_json) as Record<string, unknown>;
  const token = generateToken(10);
  const projectName = extractProjectName(anonymized);
  const score = extractScore(anonymized);

  // expires_at — if provided, validate it's ISO-8601 before we send it.
  // Supabase will reject malformed timestamps with a 400, but a local
  // error is friendlier than a Postgres syntax complaint.
  let expiresAt: string | null = null;
  if (input.expires_at) {
    const parsed = new Date(input.expires_at);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(
        `Invalid expires_at: ${input.expires_at}. Expected an ISO-8601 timestamp.`,
      );
    }
    expiresAt = parsed.toISOString();
  }

  await insertSharedReport({
    token,
    report_type: input.report_type,
    report_json: anonymized,
    project_name: projectName,
    score,
    expires_at: expiresAt,
  });

  return {
    token,
    url: `${getBaseUrl()}/r/${token}`,
  };
}
