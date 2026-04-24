// findings-ledger.ts — canonical finding store with scan-driven lifecycle.
//
// Replaces the dual-write pattern where du_recommendations, bobby_tasks, and
// platform advisors each tracked "is it fixed?" independently. Scans own the
// lifecycle here; workflow views (recommendations, PVS tasks) reference
// finding_hash and never mutate state.
//
// Design rules:
//  - A scan produces findings; each finding has a stable finding_hash
//    (per-platform formula, see computeFindingHash).
//  - upsertFinding keeps the finding's id stable — same hash ⇒ same row.
//  - finalizeScanScope closes findings in scope that this scan did NOT see.
//  - reopen happens automatically if a closed finding comes back in a later
//    scan (upsertFinding transitions closed → open).
//  - dismiss is a terminal-until-reverted state with a structured reason
//    (false_positive, wont_fix, accepted_risk, used_in_tests) and optional
//    expiry. Auto-reopens if expires_at passes and finding still open.
//
// Not event sourcing: du_finding_events is a bounded audit log, not the
// source of state. State lives denormalized on du_findings for cheap queries.

import { createHash } from 'crypto';
import { getDb, newId } from './db.js';
import type {
  PlatformAdvisorFinding,
  SecretFinding,
  InjectionFinding,
  RuleConflict,
  AuditFinding,
  CveFinding,
} from '../types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnyFinding =
  | PlatformAdvisorFinding
  | SecretFinding
  | InjectionFinding
  | RuleConflict
  | AuditFinding
  | CveFinding;

export interface LedgerFinding {
  id: string;
  finding_hash: string;
  platform: string;
  detector: string;
  subject: string | null;
  title: string;
  severity: 'critical' | 'recommended' | 'nice_to_have';
  state: 'open' | 'closed' | 'dismissed';
  dismiss_reason: string | null;
  dismiss_expires_at: number | null;
  dismiss_comment: string | null;
  first_seen_at: number;
  last_seen_at: number;
  closed_at: number | null;
  reopened_count: number;
  pvs_task_id: string | null;
  finding_json: string;
  last_agent_run_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Describes the scope a scan just covered, so the ledger can close findings
 * that fell out of scope. Pass the narrowest scope possible — e.g. a
 * Supabase scan of project "safedish" should use subject="safedish", not
 * scan all supabase findings globally.
 */
export interface ScanScope {
  platform: string;
  detector?: string;
  subject?: string;
}

// ---------------------------------------------------------------------------
// Hashing — per-platform stable identity
// ---------------------------------------------------------------------------

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

function normalizeRule(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Dispatch finding → stable hash. Volatile fields (line numbers, timestamps,
 * finding.id) are explicitly excluded — code shifts shouldn't create a new
 * finding. Fields that identify "the same issue" across scans are included.
 */
export function computeFindingHash(finding: AnyFinding): {
  hash: string;
  platform: string;
  detector: string;
  subject: string | null;
} {
  // PlatformAdvisorFinding (Supabase/GitHub/npm/Vercel)
  if ('platform' in finding && 'projectName' in finding) {
    const f = finding as PlatformAdvisorFinding;
    return {
      hash: sha(`platform|${f.platform}|${f.projectName}|${f.category}|${f.title}`),
      platform: f.platform,
      detector: `${f.platform}_advisor`,
      subject: f.projectName,
    };
  }

  // CveFinding — tool-known CVEs in Claude Code config
  if ('cveId' in finding && 'cvssScore' in finding) {
    const f = finding as CveFinding;
    return {
      hash: sha(`cve|${f.cveId}`),
      platform: 'agent',
      detector: 'cve_scanner',
      subject: f.cveId,
    };
  }

  // RuleConflict — has both a claude.md rule and a conflicting artifact
  if ('conflictingArtifact' in finding && 'claudeMdSource' in finding) {
    const f = finding as RuleConflict;
    return {
      hash: sha(
        `conflict|${f.category}|${f.conflictingArtifact}|${normalizeRule(f.claudeMdRule)}`
      ),
      platform: 'agent',
      detector: 'rule_conflict_detector',
      subject: f.conflictingArtifact,
    };
  }

  // InjectionFinding — artifactId + category
  if ('artifactId' in finding && 'why' in finding) {
    const f = finding as InjectionFinding;
    return {
      hash: sha(`injection|${f.category}|${f.artifactId}`),
      platform: 'agent',
      detector: 'injection_detector',
      subject: f.artifactId,
    };
  }

  // SecretFinding — location + category (NOT lineNumber; it's volatile)
  if ('excerpt' in finding && 'location' in finding) {
    const f = finding as SecretFinding;
    return {
      hash: sha(`secret|${f.category}|${f.location}`),
      platform: 'agent',
      detector: 'secret_scanner',
      subject: f.location,
    };
  }

  // AuditFinding — type + sorted affected artifacts
  if ('type' in finding && 'affectedArtifacts' in finding) {
    const f = finding as AuditFinding;
    const artifacts = [...f.affectedArtifacts].sort().join(',');
    return {
      hash: sha(`audit|${f.type}|${artifacts}`),
      platform: 'agent',
      detector: `audit_${f.type}`,
      subject: f.affectedArtifacts[0] ?? null,
    };
  }

  throw new Error(`computeFindingHash: unrecognized finding shape: ${JSON.stringify(finding).slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

function logEvent(
  findingId: string,
  eventType: 'opened' | 'seen' | 'closed' | 'reopened' | 'dismissed' | 'undismissed',
  agentRunId: string | null,
  reason: string | null,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO du_finding_events (id, finding_id, event_type, agent_run_id, reason, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(newId(), findingId, eventType, agentRunId, reason, Date.now());
}

/**
 * Upsert a finding by hash. Returns the ledger row.
 *
 * State transitions:
 *  - New hash → insert as 'open', emit 'opened' event
 *  - Existing hash, state='closed' → transition to 'open', reopened_count++,
 *    emit 'reopened' event
 *  - Existing hash, state='open' → update last_seen, emit 'seen' event
 *  - Existing hash, state='dismissed' → update last_seen only, no state
 *    change. Dismissal is a user decision; if dismiss_expires_at passed,
 *    reconciler handles the reopen.
 */
export function upsertFinding(
  finding: AnyFinding,
  agentRunId: string | null,
): LedgerFinding {
  const db = getDb();
  const now = Date.now();
  const { hash, platform, detector, subject } = computeFindingHash(finding);

  const existing = db.prepare('SELECT * FROM du_findings WHERE finding_hash = ?')
    .get(hash) as LedgerFinding | undefined;

  const anyFinding = finding as any;
  const severity: 'critical' | 'recommended' | 'nice_to_have' =
    anyFinding.severity ?? 'recommended';
  const title: string = anyFinding.title ?? '(untitled)';

  if (!existing) {
    const id = newId();
    db.prepare(`
      INSERT INTO du_findings (
        id, finding_hash, platform, detector, subject, title, severity,
        state, first_seen_at, last_seen_at, reopened_count,
        finding_json, last_agent_run_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, ?, ?, ?, ?)
    `).run(
      id, hash, platform, detector, subject, title, severity,
      now, now,
      JSON.stringify(finding), agentRunId, now, now,
    );
    logEvent(id, 'opened', agentRunId, null);
    return db.prepare('SELECT * FROM du_findings WHERE id = ?').get(id) as LedgerFinding;
  }

  // Existing row — always update last_seen + finding_json + severity (may drift)
  if (existing.state === 'closed') {
    db.prepare(`
      UPDATE du_findings
      SET state = 'open', closed_at = NULL, last_seen_at = ?, severity = ?,
          title = ?, finding_json = ?, last_agent_run_id = ?, updated_at = ?,
          reopened_count = reopened_count + 1
      WHERE id = ?
    `).run(now, severity, title, JSON.stringify(finding), agentRunId, now, existing.id);
    logEvent(existing.id, 'reopened', agentRunId, 'scan re-detected after closure');
  } else {
    // open or dismissed — just touch last_seen
    db.prepare(`
      UPDATE du_findings
      SET last_seen_at = ?, severity = ?, title = ?, finding_json = ?,
          last_agent_run_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, severity, title, JSON.stringify(finding), agentRunId, now, existing.id);
    logEvent(existing.id, 'seen', agentRunId, null);
  }

  return db.prepare('SELECT * FROM du_findings WHERE id = ?').get(existing.id) as LedgerFinding;
}

// ---------------------------------------------------------------------------
// Finalization — close findings that fell out of scope
// ---------------------------------------------------------------------------

/**
 * After a scan completes, call this with the scope the scan covered and the
 * hashes it observed. Any currently-open finding in that scope whose hash
 * isn't in `observedHashes` transitions to 'closed'.
 *
 * This is the close-loop mechanism: manual "mark done" on a PVS task does
 * NOT close the finding — only the scan does, and only by omission.
 *
 * Dismissed findings are never auto-closed (they're already out of the
 * "needs attention" view). But their last_seen is updated by upsert.
 */
export function finalizeScanScope(
  scope: ScanScope,
  observedHashes: Set<string>,
  agentRunId: string | null,
): { closed: number } {
  const db = getDb();
  const now = Date.now();

  const clauses = ['state = ?'];
  const params: any[] = ['open'];
  clauses.push('platform = ?');
  params.push(scope.platform);
  if (scope.detector) {
    clauses.push('detector = ?');
    params.push(scope.detector);
  }
  if (scope.subject) {
    clauses.push('subject = ?');
    params.push(scope.subject);
  }

  const openInScope = db.prepare(
    `SELECT id, finding_hash FROM du_findings WHERE ${clauses.join(' AND ')}`
  ).all(...params) as { id: string; finding_hash: string }[];

  let closed = 0;
  const closeStmt = db.prepare(`
    UPDATE du_findings
    SET state = 'closed', closed_at = ?, updated_at = ?
    WHERE id = ? AND state = 'open'
  `);

  for (const row of openInScope) {
    if (observedHashes.has(row.finding_hash)) continue;
    const result = closeStmt.run(now, now, row.id);
    if (result.changes > 0) {
      logEvent(row.id, 'closed', agentRunId, 'finding not observed in scan scope');
      closed++;
    }
  }

  return { closed };
}

/**
 * Check for expired dismissals and reopen them. Called by the reconciler.
 * A dismissal with dismiss_expires_at in the past goes back to 'open' so
 * the user re-decides.
 */
export function reopenExpiredDismissals(agentRunId: string | null): { reopened: number } {
  const db = getDb();
  const now = Date.now();

  const expired = db.prepare(`
    SELECT id FROM du_findings
    WHERE state = 'dismissed'
      AND dismiss_expires_at IS NOT NULL
      AND dismiss_expires_at < ?
  `).all(now) as { id: string }[];

  const stmt = db.prepare(`
    UPDATE du_findings
    SET state = 'open', dismiss_reason = NULL, dismiss_expires_at = NULL,
        dismiss_comment = NULL, updated_at = ?
    WHERE id = ?
  `);

  let reopened = 0;
  for (const row of expired) {
    stmt.run(now, row.id);
    logEvent(row.id, 'undismissed', agentRunId, 'dismissal expired');
    reopened++;
  }
  return { reopened };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getOpenFindings(platform?: string): LedgerFinding[] {
  const db = getDb();
  if (platform) {
    return db.prepare(
      `SELECT * FROM du_findings WHERE state = 'open' AND platform = ? ORDER BY severity, last_seen_at DESC`
    ).all(platform) as LedgerFinding[];
  }
  return db.prepare(
    `SELECT * FROM du_findings WHERE state = 'open' ORDER BY severity, last_seen_at DESC`
  ).all() as LedgerFinding[];
}

export function getFindingByHash(hash: string): LedgerFinding | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM du_findings WHERE finding_hash = ?')
    .get(hash) as LedgerFinding | undefined;
}

export function dismissFinding(
  hash: string,
  reason: 'false_positive' | 'wont_fix' | 'accepted_risk' | 'used_in_tests',
  comment: string | null,
  expiresAt: number | null,
  agentRunId: string | null,
): void {
  const db = getDb();
  const now = Date.now();
  const existing = getFindingByHash(hash);
  if (!existing) throw new Error(`No finding with hash ${hash}`);
  db.prepare(`
    UPDATE du_findings
    SET state = 'dismissed', dismiss_reason = ?, dismiss_comment = ?,
        dismiss_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).run(reason, comment, expiresAt, now, existing.id);
  logEvent(existing.id, 'dismissed', agentRunId, reason);
}

