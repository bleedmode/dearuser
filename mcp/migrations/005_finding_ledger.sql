-- 005_finding_ledger: canonical finding ledger with scan-driven lifecycle.
--
-- Motivation: we had three parallel stores (du_recommendations, bobby_tasks,
-- platform advisors) each guessing whether a finding was "fixed". Keyword-
-- match against CLAUDE.md falsely marked findings implemented; PVS tasks got
-- closed manually while the underlying Supabase RLS issue stayed open.
--
-- Architecture (per 2026-04-22 research — see research/2026-04-22-finding-
-- ledger-architecture.md):
-- - du_findings is the single source of truth for finding lifecycle
-- - Scans upsert by finding_hash — same hash ⇒ same finding
-- - State transitions are scan-driven (auto-close when last_seen > N days,
--   auto-reopen when re-detected after closed)
-- - PVS tasks and du_recommendations become workflow views that reference
--   finding_hash — they can close independently, but the finding's state
--   is only reset by a scan
-- - Dismiss requires a structured reason; may expire (Dependabot pattern)
--
-- Convergent design across Snyk, Dependabot, Semgrep, Datadog, Tenable,
-- GitHub Code Scanning, Google SCC, DefectDojo.

CREATE TABLE IF NOT EXISTS du_findings (
  id TEXT PRIMARY KEY,
  finding_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  detector TEXT NOT NULL,
  subject TEXT,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'recommended'
    CHECK (severity IN ('critical', 'recommended', 'nice_to_have')),

  state TEXT NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'closed', 'dismissed')),
  dismiss_reason TEXT
    CHECK (dismiss_reason IS NULL OR dismiss_reason IN
      ('false_positive', 'wont_fix', 'accepted_risk', 'used_in_tests')),
  dismiss_expires_at INTEGER,
  dismiss_comment TEXT,

  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  closed_at INTEGER,
  reopened_count INTEGER NOT NULL DEFAULT 0,

  pvs_task_id TEXT,
  finding_json TEXT NOT NULL,
  last_agent_run_id TEXT REFERENCES du_agent_runs(id) ON DELETE SET NULL,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_findings_state ON du_findings(state, platform);
CREATE INDEX IF NOT EXISTS idx_findings_platform ON du_findings(platform, detector);
CREATE INDEX IF NOT EXISTS idx_findings_last_seen ON du_findings(last_seen_at DESC);

-- Append-only event log for audit. Small, bounded: one row per state change.
-- Not event-sourcing (we don't replay to derive state) — just an audit trail.
CREATE TABLE IF NOT EXISTS du_finding_events (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES du_findings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('opened', 'seen', 'closed', 'reopened', 'dismissed', 'undismissed')),
  agent_run_id TEXT REFERENCES du_agent_runs(id) ON DELETE SET NULL,
  reason TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finding_events_finding
  ON du_finding_events(finding_id, occurred_at DESC);

-- Link du_recommendations to du_findings via finding_hash. Existing recs
-- keep NULL; new recs produced from findings carry the hash so the
-- workflow view can reconcile against the ledger.
ALTER TABLE du_recommendations ADD COLUMN finding_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_recs_finding_hash
  ON du_recommendations(finding_hash);
