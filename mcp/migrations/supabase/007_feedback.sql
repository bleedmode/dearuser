-- 007_feedback: unified feedback channel across MCP + dashboard + share-render.
--
-- Motivation: we need founder-learning before launch. Three surfaces where a
-- user might want to tell us something — right after running a tool in the
-- terminal, while staring at a rendered report in the dashboard, or from the
-- footer of a shared report. All three write here. All three.
--
-- Architecture notes:
-- - Dear User's product data stays in local SQLite. Feedback is the deliberate
--   exception: the user is explicitly asking us to hear them, so it needs to
--   land in a place the founder can actually read (Supabase).
-- - RLS is ON with an insert-only policy — anyone with the anon key can POST
--   feedback, nobody (except the service role) can read it. No risk of a
--   third party scraping sentiment.
-- - No PII requirement: email is optional and only captured when the user
--   opts in for a follow-up. Message text is bounded (1..4000 chars) to stop
--   pathological payloads.
-- - `source` is an enum so we can slice inbox by surface when triaging.

CREATE TABLE IF NOT EXISTS du_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  context TEXT,                                  -- tool name ('collab'|'security'|'health'|'wrapped') or 'general'
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  email TEXT,                                    -- optional — only when user opts in to follow-up
  source TEXT NOT NULL
    CHECK (source IN ('mcp', 'dashboard', 'share', 'feedback-page')),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
  ON du_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_source
  ON du_feedback(source, created_at DESC);

ALTER TABLE du_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone holding the anon key can INSERT. There is no SELECT policy on
-- purpose — only the service role bypasses RLS and can read the inbox.
CREATE POLICY "anyone can insert feedback"
  ON du_feedback
  FOR INSERT
  WITH CHECK (true);
