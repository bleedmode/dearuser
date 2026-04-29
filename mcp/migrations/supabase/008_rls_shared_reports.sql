-- 008_rls_shared_reports: enable RLS on du_shared_reports.
--
-- Why: 006 left RLS off, arguing that the 10-char token acts as the
-- capability. But PostgREST happily exposes the whole table to anon —
-- a `GET /rest/v1/du_shared_reports?select=*` returns every token from
-- every share, no guessing required. Supabase advisor flagged this as
-- ERROR (rls_disabled_in_public + sensitive_columns_exposed).
--
-- Fix: turn RLS on, no policies for anon/authenticated. The service role
-- bypasses RLS automatically — both reads (web/src/lib/shared-report.ts)
-- and writes (mcp/src/tools/share.ts) already use the service key, so
-- the existing flows keep working. The capability model still holds:
-- you need to know the token to GET /r/<token>, but you can no longer
-- harvest tokens via PostgREST.

ALTER TABLE du_shared_reports ENABLE ROW LEVEL SECURITY;

-- No public policies on purpose. Service-role-only access.
