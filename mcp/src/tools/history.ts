// history tool — retrieve past Dear User reports without re-running.
//
// Three flows:
//   - summary    → the latest stored report (no re-scan). Fast.
//   - trend      → score over time per scope, rendered as a sparkline.
//   - regression → delta vs prior run: score change + new/resolved findings.
//
// Data source: du_agent_runs (markdown + report_json + score per run).
// Accepts tool aliases (collab↔analyze, health↔audit) so renames don't erase
// history.

import { getRunsByTool, getRunById } from '../engine/db.js';

export type HistoryScope = 'collab' | 'health' | 'security' | 'wrapped' | 'all';
export type HistoryFormat = 'summary' | 'trend' | 'regression' | 'json';

export interface HistoryOptions {
  scope?: HistoryScope;
  format?: HistoryFormat;
  limit?: number;
  runId?: string;
}

interface Run {
  id: string;
  tool_name: string;
  started_at: number;
  finished_at: number | null;
  status: string;
  summary: string | null;
  score: number | null;
  details: string | null;
  error: string | null;
  report_json?: string | null;
}

const SCOPE_LABEL: Record<Exclude<HistoryScope, 'all'>, string> = {
  collab: 'Collaboration',
  health: 'System-sundhed',
  security: 'Security',
  wrapped: 'Wrapped',
};

// Diagnostic scopes only — 'all' iterates these. Wrapped is shareable stats,
// not a diagnostic, so it's addressable directly but not part of 'all'.
const SCOPES: Array<Exclude<HistoryScope, 'all'>> = ['collab', 'health', 'security'];

function resolveScopes(scope: HistoryScope): Array<Exclude<HistoryScope, 'all'>> {
  return scope === 'all' ? SCOPES : [scope];
}

function humanTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function absTime(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

// Extract stable finding IDs from a run's report_json. Each of the three
// core reports emits findings with stable `id` fields (audit/security
// findings, collab frictions). Returns [] when report_json is missing or
// the shape doesn't match — regression then falls back to score-only diff.
function extractFindingIds(run: Run): string[] {
  if (!run.report_json) return [];
  try {
    const r = JSON.parse(run.report_json);
    const ids: string[] = [];
    if (Array.isArray(r.findings)) {
      for (const f of r.findings) if (f?.id) ids.push(String(f.id));
    }
    if (Array.isArray(r.frictions)) {
      for (const f of r.frictions) if (f?.id) ids.push(String(f.id));
    }
    if (Array.isArray(r.secrets)) {
      for (const f of r.secrets) if (f?.id) ids.push(String(f.id));
    }
    return ids;
  } catch {
    return [];
  }
}

function sparkline(scores: number[]): string {
  if (scores.length === 0) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  return scores.map(s => {
    const idx = Math.min(7, Math.max(0, Math.floor(s / 12.5)));
    return blocks[idx];
  }).join('');
}

// --------------------------------------------------------------------------
// Flows
// --------------------------------------------------------------------------

function formatSummary(scope: HistoryScope): string {
  const scopes = resolveScopes(scope);
  const lines: string[] = [`# Dear User — Seneste rapporter`, ``];
  let anyFound = false;

  for (const s of scopes) {
    const runs = getRunsByTool(s, 1) as Run[];
    const latest = runs[0];
    if (!latest) {
      lines.push(`## ${SCOPE_LABEL[s]}`, `*Ingen rapporter endnu — kør \`${s}\` for at lave én.*`, ``);
      continue;
    }
    anyFound = true;
    const score = latest.score !== null ? `${latest.score}/100` : '—/100';
    lines.push(
      `## ${SCOPE_LABEL[s]}: ${score}`,
      `*Kørt ${humanTime(latest.started_at)} (${absTime(latest.started_at)})*`,
      ``,
    );
    if (latest.summary) {
      lines.push(latest.summary, ``);
    }
    lines.push(`_Run ID: \`${latest.id}\` — brug \`history\` med \`run_id\` for fuld rapport._`, ``);
  }

  if (!anyFound) {
    lines.push(`Ingen tidligere rapporter fundet. Kør \`collab\`, \`health\` eller \`security\` først.`);
  } else {
    lines.push(`---`, ``, `**Vil du have en frisk scan?** Kør \`collab\`, \`health\` eller \`security\` — rapporter er billige (~30 sek).`);
  }

  return lines.join('\n');
}

function formatTrend(scope: HistoryScope, limit: number): string {
  const scopes = resolveScopes(scope);
  const lines: string[] = [`# Dear User — Score-trend`, ``, `*Seneste ${limit} kørsler per område*`, ``];
  const regressions: string[] = [];
  const improvements: string[] = [];

  for (const s of scopes) {
    const runs = (getRunsByTool(s, limit) as Run[])
      .filter(r => r.score !== null)
      .reverse(); // oldest → newest for the sparkline
    if (runs.length === 0) {
      lines.push(`## ${SCOPE_LABEL[s]}`, `*Ingen score-historik endnu.*`, ``);
      continue;
    }
    const scores = runs.map(r => r.score as number);
    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const arrow = delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : `→ 0`;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    lines.push(
      `## ${SCOPE_LABEL[s]}: ${last}/100  ${arrow}`,
      `\`${sparkline(scores)}\`  (min ${min}, max ${max}, ${runs.length} kørsler)`,
      `*Ældste: ${absTime(runs[0].started_at)} · Nyeste: ${absTime(runs[runs.length - 1].started_at)}*`,
      ``,
    );
    if (delta <= -5) regressions.push(`**${SCOPE_LABEL[s]}** er faldet ${Math.abs(delta)} point — kør \`history\` med \`format: "regression"\` for at se hvad der ændrede sig.`);
    else if (delta >= 10) improvements.push(`**${SCOPE_LABEL[s]}** er steget ${delta} point — godt arbejde.`);
  }

  lines.push(`---`, ``, `## What to do next`, ``);
  if (regressions.length === 0 && improvements.length === 0) {
    lines.push(`Scoren er stabil på tværs af områder. Ingen handling nødvendig — kør en frisk scan hvis du har ændret noget siden sidst.`);
  } else {
    for (const msg of regressions) lines.push(`- ${msg}`);
    for (const msg of improvements) lines.push(`- ${msg}`);
    if (regressions.length > 0) {
      lines.push(``, `Hvis du ikke ved hvad der ændrede sig, kør en frisk scan (\`collab\` / \`health\` / \`security\`) og sammenlign mod den sidst gemte rapport.`);
    }
  }
  return lines.join('\n');
}

function formatRegression(scope: HistoryScope): string {
  const scopes = resolveScopes(scope);
  const lines: string[] = [`# Dear User — Regressions-rapport`, ``, `*Ændringer siden forrige kørsel*`, ``];
  let anyRegression = false;
  let anyImprovement = false;
  let anyNewFindings = false;

  for (const s of scopes) {
    const runs = getRunsByTool(s, 2) as Run[];
    if (runs.length < 2) {
      lines.push(
        `## ${SCOPE_LABEL[s]}`,
        runs.length === 0
          ? `*Ingen kørsler — kør \`${s}\` først.*`
          : `*Kun én kørsel endnu — ingen sammenligning mulig. Kør \`${s}\` igen for en diff næste gang.*`,
        ``,
      );
      continue;
    }
    const [latest, prior] = runs;
    const latestScore = latest.score ?? null;
    const priorScore = prior.score ?? null;
    const delta = latestScore !== null && priorScore !== null ? latestScore - priorScore : null;
    const scoreLine = latestScore === null
      ? `*Ingen score i seneste kørsel.*`
      : priorScore === null
        ? `**${latestScore}/100** (forrige kørsel manglede score)`
        : delta === 0
          ? `**${latestScore}/100** → uændret`
          : delta! > 0
            ? `**${latestScore}/100** (↑ +${delta} fra ${priorScore})`
            : `**${latestScore}/100** (↓ ${delta} fra ${priorScore}) — regression`;

    if (delta !== null && delta < 0) anyRegression = true;
    if (delta !== null && delta > 0) anyImprovement = true;

    const latestIds = new Set(extractFindingIds(latest));
    const priorIds = new Set(extractFindingIds(prior));
    const added = [...latestIds].filter(id => !priorIds.has(id));
    const resolved = [...priorIds].filter(id => !latestIds.has(id));
    if (added.length > 0) anyNewFindings = true;

    lines.push(
      `## ${SCOPE_LABEL[s]}`,
      scoreLine,
      `*Sammenligner ${humanTime(latest.started_at)} vs ${humanTime(prior.started_at)}*`,
      ``,
    );

    if (latestIds.size === 0 && priorIds.size === 0) {
      lines.push(`*Ingen strukturerede findings i rapporterne — kun score-diff mulig. Nye kørsler gemmer finding-ID'er, så næste sammenligning viser mere.*`, ``);
      continue;
    }

    if (added.length > 0) {
      lines.push(`**Nye findings (${added.length}):**`);
      for (const id of added.slice(0, 10)) lines.push(`- \`${id}\``);
      if (added.length > 10) lines.push(`- _… og ${added.length - 10} flere_`);
      lines.push(``);
    }
    if (resolved.length > 0) {
      lines.push(`**Løst siden sidst (${resolved.length}):**`);
      for (const id of resolved.slice(0, 10)) lines.push(`- \`${id}\``);
      if (resolved.length > 10) lines.push(`- _… og ${resolved.length - 10} flere_`);
      lines.push(``);
    }
    if (added.length === 0 && resolved.length === 0) {
      lines.push(`*Samme findings som forrige kørsel — ingen ændring i struktur.*`, ``);
    }
  }

  lines.push(`---`, ``, `## What to do next`, ``);
  if (anyRegression && anyNewFindings) {
    lines.push(`Scoren er faldet og der er nye findings. Kør en frisk scan for at se detaljer, og overvej \`implement_recommendation\` på pending recs.`);
  } else if (anyRegression) {
    lines.push(`Scoren er faldet men ingen nye structured findings. Enten er nogle findings blevet mere severe, eller ældre kørsler mangler finding-ID'er. Kør en frisk scan for at få fuldt billede.`);
  } else if (anyImprovement) {
    lines.push(`Scoren er steget — løste findings viser hvad der blev fikset. Ingen handling nødvendig.`);
  } else {
    lines.push(`Ingen ændring i score eller struktur. Systemet er stabilt siden forrige kørsel.`);
  }
  return lines.join('\n');
}

function formatSingleRun(runId: string): string {
  const run = getRunById(runId) as Run | undefined;
  if (!run) return `# Dear User — History\n\nIngen kørsel fundet med ID \`${runId}\`.`;
  const score = run.score !== null ? `${run.score}/100` : '—/100';
  const label = run.tool_name in SCOPE_LABEL ? SCOPE_LABEL[run.tool_name as keyof typeof SCOPE_LABEL] : run.tool_name;
  const body = run.details || run.summary || '*Ingen rapport-tekst gemt.*';
  return [
    `# Dear User — ${label}: ${score}`,
    `*Kørt ${humanTime(run.started_at)} (${absTime(run.started_at)}) · Run ID: \`${run.id}\`*`,
    ``,
    body,
  ].join('\n');
}

// --------------------------------------------------------------------------
// Public entry
// --------------------------------------------------------------------------

// Returns the latest stored report_json for a single scope as a JSON string.
// Used by the wrapped share flow to forward a structured report straight to
// share_report without re-running the scan. Scope 'all' is rejected because
// share_report operates on one report at a time.
function formatJson(scope: HistoryScope): string {
  if (scope === 'all') {
    return JSON.stringify({ error: 'format "json" requires a specific scope (collab, health, or security), not "all".' });
  }
  const runs = getRunsByTool(scope, 1) as Run[];
  const latest = runs[0];
  if (!latest) {
    return JSON.stringify({ error: `No stored ${scope} report found. Run \`${scope}\` first.` });
  }
  if (!latest.report_json) {
    return JSON.stringify({ error: `Latest ${scope} run (${latest.id}) has no structured report_json — it was stored before JSON persistence was added. Re-run \`${scope}\` to capture it.` });
  }
  // report_json is already a JSON string in the DB — return as-is so the
  // agent can parse and forward to share_report unchanged.
  return latest.report_json;
}

export function runHistory(options: HistoryOptions = {}): string {
  if (options.runId) return formatSingleRun(options.runId);
  const scope = options.scope || 'all';
  const format = options.format || 'summary';
  const limit = options.limit ?? (format === 'trend' ? 14 : format === 'regression' ? 2 : 1);

  switch (format) {
    case 'summary':    return formatSummary(scope);
    case 'trend':      return formatTrend(scope, limit);
    case 'regression': return formatRegression(scope);
    case 'json':       return formatJson(scope);
  }
}
