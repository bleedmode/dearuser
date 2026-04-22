-- 006_shared_reports: public shareable report pages at dearuser.ai/r/<token>.
--
-- Motivation: viral distribution. HubSpot Grader got 40K backlinks from
-- exactly this pattern — users share their score, competitors audit back,
-- the product name spreads organically.
--
-- Architecture notes:
-- - Dear User's own data lives in local SQLite (~/.dearuser/dearuser.db).
--   That's intentional — scans are local, nothing leaves the machine.
-- - Shared reports are the ONLY piece that needs a public, shared surface.
--   Lives in Supabase because dearuser.ai needs to serve these to strangers.
-- - The share_report MCP tool anonymizes before upload: absolute paths,
--   email addresses, and anything matching our secret-scanner patterns are
--   stripped. The user's own DB still holds the raw original.
-- - No RLS — this table is intentionally public-read via the url-safe
--   10-char token. Tokens act as capabilities (unguessable). Writes are
--   restricted to service role only.

CREATE TABLE IF NOT EXISTS du_shared_reports (
  token TEXT PRIMARY KEY,
  report_type TEXT NOT NULL
    CHECK (report_type IN ('collab', 'security', 'health', 'wrapped')),
  report_json JSONB NOT NULL,
  project_name TEXT,                             -- anonymized (basename only)
  score INTEGER,                                 -- denormalized for social card
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shared_reports_created_at
  ON du_shared_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_reports_expires_at
  ON du_shared_reports(expires_at)
  WHERE expires_at IS NOT NULL;

-- Atomic view counter — used by Astro page on each render. Returns the
-- NEW count so the UI could (optionally) display it without a second read.
CREATE OR REPLACE FUNCTION du_increment_view_count(report_token TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE du_shared_reports
    SET view_count = view_count + 1
    WHERE token = report_token
    RETURNING view_count INTO new_count;
  RETURN new_count;
END;
$$;
