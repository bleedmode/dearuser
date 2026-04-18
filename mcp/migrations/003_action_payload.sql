-- 003_action_payload: store enough info on each recommendation to implement
-- it automatically when the user accepts. Previously we kept only title +
-- text_snippet, which meant the implement tool couldn't know whether to
-- append to CLAUDE.md, merge into settings.json, or spawn a shell command.

ALTER TABLE du_recommendations ADD COLUMN action_type TEXT;
-- action_type values:
--   'claude_md_append'  — fs.appendFile(~/.claude/CLAUDE.md, action_data)
--   'settings_merge'    — parse action_data as JSON, merge into settings.json
--   'shell_exec'        — spawn action_data as a shell command (e.g. `claude mcp add ...`)
--   'manual'            — show action_data as instructions; agent/user acts
--   NULL                — legacy row, needs manual implementation

ALTER TABLE du_recommendations ADD COLUMN action_data TEXT;
-- The full payload needed to implement the recommendation. Raw markdown for
-- claude_md_append, JSON for settings_merge, shell command string for
-- shell_exec, free-text instructions for manual.
