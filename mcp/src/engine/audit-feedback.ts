// audit-feedback — persist audit findings so we can track which were fixed
// between runs.
//
// Stored at ~/.dearuser/audit-findings.json. Each finding has a stable id
// (from audit-detectors), a first-seen timestamp, a last-seen timestamp, and
// a status. When a finding's id doesn't appear in the current run, we mark
// the stored record as 'fixed'.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { AuditFinding, AuditReport } from '../types.js';

interface StoredFinding {
  id: string;
  title: string;
  type: AuditFinding['type'];
  severity: AuditFinding['severity'];
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'pending' | 'fixed' | 'dismissed';
}

interface Store {
  version: '1.0';
  findings: StoredFinding[];
}

function storePath(): string {
  return join(homedir(), '.dearuser', 'audit-findings.json');
}

function loadStore(): Store {
  const path = storePath();
  if (!existsSync(path)) return { version: '1.0', findings: [] };
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.findings)) return parsed;
    return { version: '1.0', findings: [] };
  } catch {
    return { version: '1.0', findings: [] };
  }
}

function saveStore(store: Store): void {
  const path = storePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // Non-fatal — feedback loop just won't persist this run
  }
}

/**
 * Reconcile current-run findings against the stored history.
 *
 * - Present + previously pending → update lastSeenAt, stay pending
 * - Present + previously fixed → mark pending again (regression)
 * - Absent + previously pending → mark fixed
 * - Dismissed stays dismissed regardless
 *
 * Returns the feedback summary for AuditReport.feedback.
 */
export function reconcileFindings(
  current: AuditFinding[],
): AuditReport['feedback'] {
  const store = loadStore();
  const now = new Date().toISOString();
  const currentIds = new Set(current.map(f => f.id));
  const storedById = new Map(store.findings.map(f => [f.id, f]));

  // Update or insert current findings
  for (const f of current) {
    const prev = storedById.get(f.id);
    if (prev) {
      if (prev.status === 'dismissed') continue; // user explicitly dismissed
      prev.status = 'pending';
      prev.lastSeenAt = now;
      prev.title = f.title;
      prev.severity = f.severity;
    } else {
      store.findings.push({
        id: f.id,
        title: f.title,
        type: f.type,
        severity: f.severity,
        firstSeenAt: now,
        lastSeenAt: now,
        status: 'pending',
      });
    }
  }

  // Mark absent findings as fixed (unless dismissed)
  for (const stored of store.findings) {
    if (stored.status === 'dismissed') continue;
    if (!currentIds.has(stored.id) && stored.status === 'pending') {
      stored.status = 'fixed';
    }
  }

  saveStore(store);

  const pending = store.findings.filter(f => f.status === 'pending').length;
  const fixed = store.findings.filter(f => f.status === 'fixed').length;
  const dismissed = store.findings.filter(f => f.status === 'dismissed').length;

  // History: last 10 most-recently-seen, pending first
  const history = store.findings
    .slice()
    .sort((a, b) => {
      const statusOrder = { pending: 0, fixed: 1, dismissed: 2 };
      const s = statusOrder[a.status] - statusOrder[b.status];
      if (s !== 0) return s;
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    })
    .slice(0, 10)
    .map(f => ({
      id: f.id,
      title: f.title,
      status: f.status,
      firstSeenAt: f.firstSeenAt,
      lastSeenAt: f.lastSeenAt,
    }));

  return {
    totalTracked: store.findings.length,
    fixed,
    pending,
    dismissed,
    history,
  };
}

/** Mark a finding as explicitly dismissed. Called when user passes dismiss=id. */
export function dismissFinding(id: string): boolean {
  const store = loadStore();
  const target = store.findings.find(f => f.id === id);
  if (!target) return false;
  target.status = 'dismissed';
  target.lastSeenAt = new Date().toISOString();
  saveStore(store);
  return true;
}
