// db.ts — SQLite database layer for Dear User
//
// Single global database at ~/.dearuser/dearuser.db.
// Auto-creates on first access, auto-runs migrations.
// WAL mode for concurrent reads (dashboard reads while MCP writes).
//
// Dear User = diagnose. Only stores data Dear User's own tools produce:
// - du_agent_runs (tool execution log)
// - du_score_history (collaboration score over time)
// - du_recommendations (feedback loop)

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const DEARUSER_DIR = join(homedir(), '.dearuser');
const DB_PATH = join(DEARUSER_DIR, 'dearuser.db');

declare const __dirname: string;

function getMigrationsDir(): string {
  const candidates = [
    join(__dirname, '..', 'migrations'),       // from dist/ → mcp/migrations/
    join(__dirname, '..', '..', 'migrations'),  // from src/engine/ → mcp/migrations/
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0];
}

let _db: Database.Database | null = null;

/**
 * Get the database connection. Lazily opens on first call.
 * Auto-creates ~/.dearuser/ and runs pending migrations.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DEARUSER_DIR)) {
    mkdirSync(DEARUSER_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS du_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database.Database): void {
  const migrationsDir = getMigrationsDir();
  if (!existsSync(migrationsDir)) return;

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM du_migrations').all()
      .map((row: any) => row.name as string)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.exec(sql);

    db.prepare('INSERT INTO du_migrations (name, applied_at) VALUES (?, ?)')
      .run(file, Date.now());
  }
}

// ---------------------------------------------------------------------------
// Helper: generate IDs
// ---------------------------------------------------------------------------

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Agent Runs
// ---------------------------------------------------------------------------

export interface AgentRunInput {
  toolName: string;
  summary?: string;
  score?: number;
  details?: string;
  error?: string;
  status?: 'running' | 'success' | 'failed';
}

export function insertAgentRun(input: AgentRunInput): string {
  const db = getDb();
  const id = newId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO du_agent_runs (id, tool_name, started_at, finished_at, status, summary, score, details, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.toolName,
    now,
    input.status === 'running' ? null : now,
    input.status || 'success',
    input.summary || null,
    input.score ?? null,
    input.details || null,
    input.error || null,
  );

  return id;
}

export function getRecentRuns(limit = 50): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM du_agent_runs ORDER BY started_at DESC LIMIT ?
  `).all(limit);
}

/**
 * Latest successful run for each of the three scoring tools. Used by the
 * landing-page dashboard to show the current samarbejds / sikkerheds /
 * system-sundhed score side-by-side. Returns only runs with a non-null score
 * so the dashboard doesn't render "——/100" placeholders.
 *
 * Tool names map: analyze → collaboration, security → security, system-health
 * (or legacy "audit") → system-sundhed.
 */
export function getLatestScoresByTool(): {
  analyze: any | null;
  security: any | null;
  systemHealth: any | null;
} {
  const db = getDb();
  // Filter rows where details is NULL/empty so the tile click-through never
  // lands on a ghost letter (row was inserted but the render/persist path
  // aborted before writing the body). Same filter as getRecentRuns on the
  // landing page — otherwise the user taps "Samarbejde" and sees a greeting
  // + score line with no content.
  const latest = (tools: string[]): any | null => {
    const placeholders = tools.map(() => '?').join(', ');
    return db.prepare(`
      SELECT * FROM du_agent_runs
      WHERE tool_name IN (${placeholders})
        AND score IS NOT NULL
        AND details IS NOT NULL AND details != ''
      ORDER BY started_at DESC LIMIT 1
    `).get(...tools) || null;
  };
  return {
    // Accept legacy tool names so renames didn't erase history
    analyze: latest(['collab', 'analyze']),
    security: latest(['security']),
    systemHealth: latest(['health', 'system-health', 'audit']),
  };
}

/** Get a single run by id — used by the dashboard share-URL (/r/:id). */
export function getRunById(id: string): any | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM du_agent_runs WHERE id = ?').get(id);
}

/**
 * Runs for a given tool, newest first. The `history` tool uses this for
 * summary (limit 1), trend (limit 14), and regression (limit 2: latest + prior).
 *
 * Accepts legacy tool names so renames (analyze→collab, audit→health) don't
 * erase history — same mapping logic as getLatestScoresByTool.
 */
export function getRunsByTool(tool: 'collab' | 'health' | 'security', limit = 14): any[] {
  const db = getDb();
  const alias: Record<string, string[]> = {
    collab: ['collab', 'analyze'],
    health: ['health', 'system-health', 'audit'],
    security: ['security'],
  };
  const tools = alias[tool];
  const placeholders = tools.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM du_agent_runs
    WHERE tool_name IN (${placeholders}) AND status = 'success'
      AND details IS NOT NULL AND details != ''
    ORDER BY started_at DESC LIMIT ?
  `).all(...tools, limit);
}

/**
 * Store the full human-readable report body against an existing run. Called
 * after the MCP tool has generated the markdown so the dashboard's /r/:id
 * route can show it. Silent no-op if the row doesn't exist.
 */
export function updateRunDetails(id: string, details: string): void {
  const db = getDb();
  db.prepare('UPDATE du_agent_runs SET details = ? WHERE id = ?').run(details, id);
}

/**
 * Store the structured report (AnalysisReport / AuditReport / SecurityReport)
 * alongside the markdown. The dashboard uses this to render a rich letter
 * view with progressive disclosure; the markdown stays as a fallback for
 * chat/agent consumers who need a linear render.
 */
export function updateRunJson(id: string, reportJson: unknown): void {
  const db = getDb();
  const payload = typeof reportJson === 'string' ? reportJson : JSON.stringify(reportJson);
  db.prepare('UPDATE du_agent_runs SET report_json = ? WHERE id = ?').run(payload, id);
}

// ---------------------------------------------------------------------------
// Score History
// ---------------------------------------------------------------------------

export interface ScoreHistoryInput {
  scope: 'global' | 'project';
  score: number;
  persona?: string;
  categoryScores?: Record<string, number>;
}

export function insertScoreHistory(input: ScoreHistoryInput): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO du_score_history (id, scope, score, persona, category_scores, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    newId(),
    input.scope,
    input.score,
    input.persona || null,
    input.categoryScores ? JSON.stringify(input.categoryScores) : null,
    Date.now(),
  );
}

export function getScoreHistory(days = 90): any[] {
  const db = getDb();
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);
  return db.prepare(`
    SELECT * FROM du_score_history WHERE recorded_at >= ? ORDER BY recorded_at ASC
  `).all(since);
}

// ---------------------------------------------------------------------------
// Recommendations (replaces JSON file)
// ---------------------------------------------------------------------------

export type ActionType = 'claude_md_append' | 'settings_merge' | 'shell_exec' | 'manual';

export interface RecommendationInput {
  agentRunId?: string;
  type: 'claude_md_rule' | 'hook' | 'skill' | 'mcp_server' | 'behavior';
  title: string;
  textSnippet?: string;
  keywords?: string[];
  severity?: 'critical' | 'recommended' | 'nice_to_have';
  scoreAtGiven?: number;
  /** How to implement: append to CLAUDE.md, merge into settings.json,
   *  spawn a shell command, or show as manual instructions. */
  actionType?: ActionType;
  /** Full payload needed to execute actionType. */
  actionData?: string;
}

export function insertRecommendation(input: RecommendationInput): string {
  const db = getDb();
  const id = newId();

  db.prepare(`
    INSERT INTO du_recommendations (id, agent_run_id, type, title, text_snippet, keywords, severity, status, score_at_given, given_at, action_type, action_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(
    id,
    input.agentRunId || null,
    input.type,
    input.title,
    input.textSnippet || null,
    input.keywords ? JSON.stringify(input.keywords) : null,
    input.severity || 'recommended',
    input.scoreAtGiven ?? null,
    Date.now(),
    input.actionType || null,
    input.actionData || null,
  );

  return id;
}

/** Get a single recommendation by id — used by implement/dismiss flows. */
export function getRecommendationById(id: string): any | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM du_recommendations WHERE id = ?').get(id);
}

export function getRecommendations(status?: string): any[] {
  const db = getDb();
  const base = `
    SELECT r.*, a.tool_name AS source_tool
    FROM du_recommendations r
    LEFT JOIN du_agent_runs a ON a.id = r.agent_run_id
  `;
  if (status) {
    return db.prepare(`${base} WHERE r.status = ? ORDER BY r.given_at DESC`).all(status);
  }
  return db.prepare(`${base} ORDER BY r.given_at DESC`).all();
}

export function updateRecommendationStatus(id: string, status: string, scoreAtCheck?: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE du_recommendations SET status = ?, score_at_check = ?, checked_at = ? WHERE id = ?
  `).run(status, scoreAtCheck ?? null, Date.now(), id);
}

export function findRecommendationByTitle(title: string): any | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM du_recommendations WHERE title = ? ORDER BY given_at DESC LIMIT 1').get(title);
}

// ---------------------------------------------------------------------------
// Migration helper: import existing JSON recommendations
// ---------------------------------------------------------------------------

export function migrateFromJson(): { imported: number } {
  const jsonPath = join(DEARUSER_DIR, 'recommendations.json');
  if (!existsSync(jsonPath)) return { imported: 0 };

  const db = getDb();

  const count = (db.prepare('SELECT COUNT(*) as c FROM du_recommendations').get() as any).c;
  if (count > 0) return { imported: 0 };

  try {
    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    if (!Array.isArray(data)) return { imported: 0 };

    const insert = db.prepare(`
      INSERT OR IGNORE INTO du_recommendations (id, type, title, text_snippet, keywords, severity, status, score_at_given, score_at_check, given_at, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      let imported = 0;
      for (const rec of data) {
        insert.run(
          rec.id || newId(),
          rec.type || 'claude_md_rule',
          rec.title,
          rec.textSnippet || null,
          rec.keywords ? JSON.stringify(rec.keywords) : null,
          'recommended',
          rec.status || 'pending',
          rec.scoreAtGiven ?? null,
          rec.scoreAtCheck ?? null,
          rec.givenAt ? new Date(rec.givenAt).getTime() : Date.now(),
          rec.checkedAt ? new Date(rec.checkedAt).getTime() : null,
        );
        imported++;
      }
      return imported;
    });

    const imported = tx();
    return { imported };
  } catch {
    return { imported: 0 };
  }
}

// ---------------------------------------------------------------------------
// Close (for clean shutdown)
// ---------------------------------------------------------------------------

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
