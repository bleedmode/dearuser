// dashboard.ts — Local Hono web dashboard for Dear User reports.
//
// Starts automatically when the MCP server starts. Renders the user's
// locally-stored reports (analyze/audit/security/wrapped) in a browser
// so non-technical users don't have to read markdown files in TextEdit.
//
// Binds to localhost ONLY — never exposed to the network. Reads from the
// same SQLite DB the MCP tools write to. Read-only queries.
//
// Language: Danish user-facing copy. Lovable audience — no jargon like
// "agent_runs" or "score_history" in the UI.
//
// Port strategy: tries 7700, falls back to 7701..7710. If all ports are
// busy, logs a warning and the MCP server continues without a dashboard.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getRecentRuns, getRunById, getScoreHistory, getRecommendations } from './engine/db.js';

const DEFAULT_PORT = 7700;
const MAX_PORT_ATTEMPTS = 10;

// ============================================================================
// Tool-name labels — map jargon keys to human Danish
// ============================================================================

const TOOL_LABELS: Record<string, string> = {
  analyze: 'Diagnose',
  audit: 'Systemtjek',
  security: 'Sikkerhedstjek',
  wrapped: 'Samarbejde wrapped',
  onboard: 'Opsætning',
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

function toolEmoji(toolName: string): string {
  switch (toolName) {
    case 'analyze': return '🔍';
    case 'audit': return '🩺';
    case 'security': return '🔒';
    case 'wrapped': return '🎁';
    case 'onboard': return '👋';
    default: return '📄';
  }
}

// ============================================================================
// Time helpers — "for 3 timer siden" instead of Unix timestamps
// ============================================================================

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'lige nu';
  if (mins < 60) return `for ${mins} min siden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `for ${hours} time${hours === 1 ? '' : 'r'} siden`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `for ${days} dag${days === 1 ? '' : 'e'} siden`;
  const months = Math.floor(days / 30);
  if (months < 12) return `for ${months} måned${months === 1 ? '' : 'er'} siden`;
  return `for ${Math.floor(months / 12)} år siden`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString('da-DK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================================================
// HTML shell — shared across pages
// ============================================================================

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Dear User</title>
<style>
  :root {
    --bg: #fafaf8;
    --fg: #1a1a1a;
    --muted: #6b6b6b;
    --border: #e5e5e0;
    --card: #ffffff;
    --accent: #0a7d4f;
    --accent-soft: #e7f4ec;
    --warn: #d27011;
    --warn-soft: #fdf3e6;
    --crit: #c0392b;
    --crit-soft: #fbe9e7;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; padding: 0;
    background: var(--bg); color: var(--fg);
    line-height: 1.5;
  }
  header {
    border-bottom: 1px solid var(--border);
    background: var(--card);
    padding: 1rem 2rem;
    display: flex; align-items: center; gap: 2rem;
  }
  header h1 { font-size: 1.1rem; margin: 0; font-weight: 600; }
  header nav { display: flex; gap: 1.5rem; }
  header nav a { color: var(--muted); text-decoration: none; font-size: 0.95rem; }
  header nav a:hover { color: var(--fg); }
  header nav a.active { color: var(--fg); font-weight: 500; }
  main { max-width: 960px; margin: 0 auto; padding: 2rem; }
  h2 { font-size: 1.4rem; font-weight: 600; margin: 2rem 0 1rem; }
  h3 { font-size: 1.1rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
  .card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1rem;
  }
  .row { display: flex; gap: 1rem; flex-wrap: wrap; }
  .row > .card { flex: 1; min-width: 240px; }
  .score-big {
    font-size: 3rem; font-weight: 700; color: var(--accent); line-height: 1;
  }
  .muted { color: var(--muted); font-size: 0.9rem; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.6rem 0.75rem; border-bottom: 1px solid var(--border); }
  th { font-weight: 500; color: var(--muted); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.03em; }
  tr:hover td { background: var(--bg); }
  td a { color: var(--accent); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .pill {
    display: inline-block; padding: 0.2rem 0.6rem; border-radius: 12px;
    font-size: 0.8rem; font-weight: 500;
  }
  .pill-ok { background: var(--accent-soft); color: var(--accent); }
  .pill-warn { background: var(--warn-soft); color: var(--warn); }
  .pill-crit { background: var(--crit-soft); color: var(--crit); }
  .pill-muted { background: var(--border); color: var(--muted); }
  .empty {
    text-align: center; padding: 3rem 1rem; color: var(--muted);
  }
  .empty strong { color: var(--fg); display: block; margin-bottom: 0.5rem; }
  pre.report {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 1.25rem; white-space: pre-wrap; word-wrap: break-word;
    font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.85rem;
    max-height: 80vh; overflow-y: auto;
  }
  .run-meta { display: flex; gap: 1.5rem; color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem; }
  footer { max-width: 960px; margin: 3rem auto 2rem; padding: 0 2rem; color: var(--muted); font-size: 0.85rem; }
  footer a { color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>📊 Dear User</h1>
  <nav>
    <a href="/">Oversigt</a>
    <a href="/historik">Kørsler</a>
    <a href="/forbedringer">Forbedringer</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  Kører lokalt på din maskine. Ingen data sendes videre.
  · <a href="https://dearuser.ai">dearuser.ai</a>
</footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// ============================================================================
// Landing page — most recent run + score + top recommendations
// ============================================================================

function renderLanding(): string {
  const recent = getRecentRuns(5);
  const scoreHistory = getScoreHistory(30);
  const latestScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : null;
  const pending = getRecommendations('pending').slice(0, 5);

  const scoreCard = latestScore
    ? `
      <div class="card">
        <div class="muted">Din score</div>
        <div class="score-big">${latestScore.score}<span style="font-size:1.2rem;color:var(--muted);font-weight:400"> / 100</span></div>
        ${latestScore.persona ? `<div class="muted">${escapeHtml(latestScore.persona)}</div>` : ''}
        <div class="muted" style="margin-top:0.5rem;font-size:0.8rem">Opdateret ${timeAgo(latestScore.recorded_at)}</div>
      </div>
    `
    : `
      <div class="card">
        <div class="muted">Din score</div>
        <div style="padding:1rem 0;color:var(--muted)">Kør /dearuser-analyze for at få din første score.</div>
      </div>
    `;

  const recentCard = recent.length === 0
    ? ''
    : `
      <div class="card">
        <div class="muted">Seneste kørsel</div>
        <div style="font-size:1.2rem;font-weight:600;margin-top:0.25rem">
          ${toolEmoji(recent[0].tool_name)} ${toolLabel(recent[0].tool_name)}
        </div>
        <div class="muted" style="margin-top:0.25rem">${timeAgo(recent[0].started_at)}</div>
        <a href="/r/${escapeHtml(recent[0].id)}" style="display:inline-block;margin-top:0.75rem;color:var(--accent);text-decoration:none">
          Læs rapport →
        </a>
      </div>
    `;

  const pendingCard = pending.length === 0
    ? `
      <div class="card">
        <div class="muted">Forbedringer</div>
        <div style="padding:1rem 0;color:var(--muted)">Ingen åbne forbedringer lige nu.</div>
      </div>
    `
    : `
      <div class="card">
        <div class="muted">Åbne forbedringer (${pending.length})</div>
        <ul style="padding-left:1.25rem;margin-top:0.5rem">
          ${pending.slice(0, 3).map(r => `
            <li style="margin-bottom:0.3rem">
              ${renderSeverityPill(r.severity)}
              ${escapeHtml(r.title)}
            </li>
          `).join('')}
        </ul>
        <a href="/forbedringer" style="display:inline-block;margin-top:0.75rem;color:var(--accent);text-decoration:none">
          Se alle →
        </a>
      </div>
    `;

  const empty = recent.length === 0 && pending.length === 0;

  return page('Oversigt', `
    <h2>Hej 👋</h2>
    ${empty ? `
      <div class="empty">
        <strong>Ingen rapporter endnu.</strong>
        Åbn Claude Code og kør <code>/dearuser-analyze</code> for at komme i gang.
      </div>
    ` : `
      <div class="row">
        ${scoreCard}
        ${recentCard}
        ${pendingCard}
      </div>
      <h3>Seneste kørsler</h3>
      ${renderRunsTable(recent)}
    `}
  `);
}

// ============================================================================
// Historik page — all runs in a table
// ============================================================================

function renderHistorik(): string {
  const runs = getRecentRuns(100);
  return page('Kørsler', `
    <h2>Alle dine kørsler</h2>
    ${runs.length === 0
      ? `<div class="empty"><strong>Ingen kørsler endnu.</strong>Kør /dearuser-analyze i Claude Code for at starte.</div>`
      : renderRunsTable(runs)
    }
  `);
}

function renderRunsTable(runs: any[]): string {
  return `
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Tidspunkt</th>
          <th>Status</th>
          <th>Score</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${runs.map(r => `
          <tr>
            <td>${toolEmoji(r.tool_name)} ${escapeHtml(toolLabel(r.tool_name))}</td>
            <td>${timeAgo(r.started_at)}</td>
            <td>${renderStatusPill(r.status)}</td>
            <td>${r.score ?? '—'}</td>
            <td><a href="/r/${escapeHtml(r.id)}">Læs →</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderStatusPill(status: string): string {
  switch (status) {
    case 'success': return `<span class="pill pill-ok">Færdig</span>`;
    case 'running': return `<span class="pill pill-warn">Kører</span>`;
    case 'failed': return `<span class="pill pill-crit">Fejlet</span>`;
    default: return `<span class="pill pill-muted">${escapeHtml(status)}</span>`;
  }
}

function renderSeverityPill(severity: string): string {
  switch (severity) {
    case 'critical': return `<span class="pill pill-crit">Kritisk</span>`;
    case 'recommended': return `<span class="pill pill-warn">Anbefalet</span>`;
    case 'nice_to_have': return `<span class="pill pill-muted">Nice to have</span>`;
    default: return `<span class="pill pill-muted">${escapeHtml(severity)}</span>`;
  }
}

// ============================================================================
// Single report page — /r/:id
// ============================================================================

function renderReport(id: string): string {
  const run = getRunById(id);
  if (!run) {
    return page('Rapport ikke fundet', `
      <div class="empty">
        <strong>Den rapport findes ikke.</strong>
        Måske blev den slettet, eller linket er forkert.
        <div style="margin-top:1rem"><a href="/">Tilbage til forsiden</a></div>
      </div>
    `);
  }

  // The report body is stored as plain text (markdown) in run.details.
  // We render it as preformatted text — good-enough for MVP. Later we can
  // upgrade to a markdown renderer.
  const body = run.details || run.summary || '(ingen rapport gemt)';

  return page(`${toolLabel(run.tool_name)} rapport`, `
    <h2>${toolEmoji(run.tool_name)} ${escapeHtml(toolLabel(run.tool_name))}</h2>
    <div class="run-meta">
      <span>${formatDate(run.started_at)}</span>
      <span>${renderStatusPill(run.status)}</span>
      ${run.score !== null ? `<span>Score: <strong>${run.score}/100</strong></span>` : ''}
    </div>
    ${run.summary && run.summary !== body ? `<div class="card"><strong>Sammenfatning</strong><br>${escapeHtml(run.summary)}</div>` : ''}
    <pre class="report">${escapeHtml(body)}</pre>
    <div style="margin-top:1rem"><a href="/historik" style="color:var(--accent);text-decoration:none">← Tilbage til alle kørsler</a></div>
  `);
}

// ============================================================================
// Forbedringer page — all recommendations
// ============================================================================

function renderForbedringer(): string {
  const pending = getRecommendations('pending');
  const implemented = getRecommendations('implemented');
  const dismissed = getRecommendations('dismissed');

  const section = (title: string, items: any[], emptyMsg: string) => `
    <h3>${escapeHtml(title)} (${items.length})</h3>
    ${items.length === 0
      ? `<div class="muted" style="padding:0.5rem 0">${escapeHtml(emptyMsg)}</div>`
      : `
        <table>
          <thead>
            <tr><th>Type</th><th>Forbedring</th><th>Tilføjet</th></tr>
          </thead>
          <tbody>
            ${items.map(r => `
              <tr>
                <td>${renderSeverityPill(r.severity)}</td>
                <td>${escapeHtml(r.title)}${r.text_snippet ? `<div class="muted" style="font-size:0.85rem;margin-top:0.25rem">${escapeHtml(r.text_snippet.slice(0, 180))}${r.text_snippet.length > 180 ? '…' : ''}</div>` : ''}</td>
                <td class="muted">${timeAgo(r.given_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    }
  `;

  const empty = pending.length === 0 && implemented.length === 0 && dismissed.length === 0;

  return page('Forbedringer', `
    <h2>Forbedringer du kan lave</h2>
    ${empty ? `
      <div class="empty">
        <strong>Ingen forbedringer endnu.</strong>
        Kør /dearuser-analyze — så finder den konkrete ting du kan gøre.
      </div>
    ` : `
      ${section('Åbne', pending, 'Ingen åbne forbedringer.')}
      ${section('Implementeret', implemented, 'Ingen implementerede endnu.')}
      ${section('Droppet', dismissed, 'Ingen droppede.')}
    `}
  `);
}

// ============================================================================
// Hono app + server
// ============================================================================

export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) => c.html(renderLanding()));
  app.get('/historik', (c) => c.html(renderHistorik()));
  app.get('/forbedringer', (c) => c.html(renderForbedringer()));
  app.get('/r/:id', (c) => c.html(renderReport(c.req.param('id'))));

  // Simple health probe — used by future multi-session coordination.
  app.get('/health', (c) => c.json({ ok: true, product: 'dearuser', version: 1 }));

  return app;
}

/**
 * Check whether a Dear User dashboard is already running on `port`. Returns
 * true only if the /health endpoint responds with `product: "dearuser"` —
 * that prevents us from silently binding to someone else's web server.
 */
async function probeDashboard(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return false;
    const data = await res.json() as any;
    return data?.product === 'dearuser';
  } catch {
    return false;
  }
}

/**
 * Find-or-start the dashboard. If another Claude Code session already has
 * one running on 7700..7710, reuse that URL instead of spawning a competing
 * instance on a different port — this way the user always sees the same
 * stable URL regardless of how many sessions are open.
 *
 * Returns the dashboard URL, or null if no port was available.
 */
export async function startDashboard(): Promise<string | null> {
  // Phase 1: look for an existing Dear User dashboard we can reuse.
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = DEFAULT_PORT + i;
    if (await probeDashboard(port)) {
      console.error(`Dear User dashboard (reusing): http://localhost:${port}`);
      return `http://localhost:${port}`;
    }
  }

  // Phase 2: nothing to reuse — start our own on the first free port.
  const app = createApp();
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = DEFAULT_PORT + i;
    try {
      await new Promise<void>((resolve, reject) => {
        const server = serve(
          { fetch: app.fetch, port, hostname: '127.0.0.1' },
          (info) => {
            // eslint-disable-next-line no-console
            console.error(`Dear User dashboard: http://localhost:${info.port}`);
            resolve();
          },
        );
        server.on('error', (err: NodeJS.ErrnoException) => reject(err));
      });
      return `http://localhost:${port}`;
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE') continue;
      console.error('Dashboard failed to start:', err?.message || err);
      return null;
    }
  }

  console.error(`Dashboard: all ports ${DEFAULT_PORT}..${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1} busy, skipping.`);
  return null;
}
