-- 009_tighten_feedback_policy: replace `WITH CHECK (true)` with bounded checks.
--
-- Why: 007 shipped `anyone can insert feedback WITH CHECK (true)`, which
-- means an anon caller could insert anything in any column — gigabyte
-- payloads in user_agent, novel-length context strings, etc. Supabase
-- advisor flagged this as WARN (rls_policy_always_true).
--
-- Fix: bound every text column at the policy level so the database refuses
-- the row before it lands. The original tabular CHECKs (message length,
-- rating range, source enum) stay — this just adds the missing bounds on
-- columns that had none.
--
-- Plus a global rate-limit trigger: pre-launch we expect <10 feedbacks/day
-- total, so 100/hour is a generous bot-stopper without blocking real use.
-- We can tighten or move to per-IP later when we have actual traffic.

DROP POLICY IF EXISTS "anyone can insert feedback" ON du_feedback;

CREATE POLICY "anyone can insert feedback"
  ON du_feedback
  FOR INSERT
  WITH CHECK (
    length(message) BETWEEN 1 AND 4000
    AND length(coalesce(context, '')) <= 50
    AND length(coalesce(email, '')) <= 320
    AND length(coalesce(user_agent, '')) <= 500
    AND (rating IS NULL OR rating BETWEEN 1 AND 5)
  );

CREATE OR REPLACE FUNCTION du_check_feedback_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*) FROM du_feedback
      WHERE created_at > now() - interval '1 hour') >= 100 THEN
    RAISE EXCEPTION 'Feedback rate limit exceeded (100/hour). Try again later.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS du_feedback_rate_limit ON du_feedback;
CREATE TRIGGER du_feedback_rate_limit
  BEFORE INSERT ON du_feedback
  FOR EACH ROW
  EXECUTE FUNCTION du_check_feedback_rate_limit();
