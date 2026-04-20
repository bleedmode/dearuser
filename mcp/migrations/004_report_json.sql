-- 004_report_json: store the structured AnalysisReport alongside the
-- rendered markdown so the dashboard can render a rich letter-format view
-- with progressive disclosure instead of just dumping the markdown on a
-- web page. The markdown stays in `details` for chat/agent consumers;
-- the dashboard uses `report_json` when available.

ALTER TABLE du_agent_runs ADD COLUMN report_json TEXT;
-- JSON-serialized AnalysisReport / AuditReport / SecurityReport object
-- from the tool that produced this run. NULL for older runs that only
-- stored the rendered markdown — the dashboard falls back to markdown
-- rendering for those.
