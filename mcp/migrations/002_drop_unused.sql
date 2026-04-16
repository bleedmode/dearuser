-- Drop tables that belong to a separate product (task management / research).
-- Dear User = diagnose only.
-- Defensive: these may not exist in fresh DBs (001 was cleaned up).

DROP TABLE IF EXISTS du_tasks;
DROP TABLE IF EXISTS du_research_docs;
DROP TABLE IF EXISTS du_research_sources;
DROP TABLE IF EXISTS du_projects;

-- Note: project_id columns in du_agent_runs and du_score_history are left in place
-- on upgraded DBs (SQLite ALTER TABLE DROP COLUMN is fragile across versions).
-- They are nullable, unused, and harmless. New rows never set them.
