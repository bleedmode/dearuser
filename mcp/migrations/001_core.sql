-- Dear User core schema — local SQLite database
-- All timestamps are Unix epoch milliseconds (INTEGER).
-- All IDs are TEXT (UUIDs generated in JS via crypto.randomUUID()).
--
-- Dear User = diagnose. Only tables for data Dear User's own tools produce.

-- Migration tracking
CREATE TABLE IF NOT EXISTS du_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at INTEGER NOT NULL
);

-- Agent runs — log of what Dear User tools did and when
CREATE TABLE IF NOT EXISTS du_agent_runs (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  summary TEXT,
  score INTEGER,
  details TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tool ON du_agent_runs(tool_name, started_at DESC);

-- Recommendations — replaces ~/.dearuser/recommendations.json
CREATE TABLE IF NOT EXISTS du_recommendations (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT REFERENCES du_agent_runs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('claude_md_rule', 'hook', 'skill', 'mcp_server', 'behavior')),
  title TEXT NOT NULL,
  text_snippet TEXT,
  keywords TEXT,
  severity TEXT NOT NULL DEFAULT 'recommended' CHECK (severity IN ('critical', 'recommended', 'nice_to_have')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'implemented', 'ignored', 'dismissed')),
  score_at_given INTEGER,
  score_at_check INTEGER,
  given_at INTEGER NOT NULL,
  checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON du_recommendations(status);

-- Score history — time-series for tracking collaboration improvement
CREATE TABLE IF NOT EXISTS du_score_history (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'project')),
  score INTEGER NOT NULL,
  persona TEXT,
  category_scores TEXT,
  recorded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_score_history_time ON du_score_history(recorded_at DESC);
