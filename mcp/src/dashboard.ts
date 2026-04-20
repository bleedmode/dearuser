// dashboard.ts — Local web dashboard for Dear User reports.
//
// Visual identity: editorial "letter" motif. Every report reads as an open
// letter to the user. Palette: cream paper background, terracotta accent,
// Geist Sans + Geist Mono typography. Inspired by Linear/Vercel/Stripe
// dashboards but with a warmer, friendlier tone — Dear User is not a tech
// product, it is a pen pal who happens to scan your AI setup.
//
// Language: plain Danish, no jargon. Words the Lovable-audience actually
// uses. "Hooks" → "automatiske tjek". "PostToolUse" → "når filer redigeres".
// "Agent Memory" → "så din assistent husker dig". "Agent" → "assistent".
//
// Tech: Hono + in-process HTTP. Tailwind via Play CDN (zero build step) so
// the styling iterates fast. Geist fonts via Google Fonts CDN. Marked for
// markdown rendering of report bodies.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { marked } from 'marked';
import { getRecentRuns, getRunById, getScoreHistory, getRecommendations, updateRecommendationStatus, getLatestScoresByTool } from './engine/db.js';
import { getUserName, updatePreferences } from './engine/user-preferences.js';
import { friendlyLabel } from './engine/friendly-labels.js';
import { CATEGORY_EXPLANATIONS, overallVerdict, securityVerdict, systemHealthVerdict } from './engine/category-explanations.js';
import { runOnboard } from './tools/onboard.js';
import type { OnboardResult } from './tools/onboard.js';

const DEFAULT_PORT = 7700;
const MAX_PORT_ATTEMPTS = 10;

// ============================================================================
// Tool-name labels — friendly Danish for the Lovable audience
// ============================================================================

const TOOL_LABELS: Record<string, string> = {
  analyze: 'Din samarbejds-rapport',
  audit: 'System-sundhed', // legacy runs saved under the old tool name
  'system-health': 'System-sundhed',
  security: 'Sikkerhedstjek',
  wrapped: 'Samarbejdet i tal',
  onboard: 'Opstart',
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

function toolEmoji(toolName: string): string {
  switch (toolName) {
    case 'analyze': return '🔍';
    case 'audit': return '🩺'; // legacy runs — kept for backwards compat
    case 'system-health': return '🩺';
    case 'security': return '🔒';
    case 'wrapped': return '🎁';
    case 'onboard': return '👋';
    default: return '📄';
  }
}

// Friendly labels live in a shared module so the chat action-menu and the
// analyze report use the same wording as the dashboard. See
// src/engine/friendly-labels.ts for the mapping table.

// ============================================================================
// Time helpers — "for 3 timer siden" in plain Danish
// ============================================================================

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'lige nu';
  if (mins < 60) return `for ${mins} min. siden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `for ${hours} ${hours === 1 ? 'time' : 'timer'} siden`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `for ${days} ${days === 1 ? 'dag' : 'dage'} siden`;
  const months = Math.floor(days / 30);
  if (months < 12) return `for ${months} ${months === 1 ? 'måned' : 'måneder'} siden`;
  return `for ${Math.floor(months / 12)} år siden`;
}

function formatLetterDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================================================
// Greeting — "Kære Jarl" when we know the name, else "Kære bruger"
// ============================================================================

function greeting(): string {
  const name = getUserName();
  return name ? `Kære ${name}` : 'Kære bruger';
}

function signature(): string {
  return '— Dear User 💌';
}

// ============================================================================
// HTML shell — cream paper, Geist fonts, Tailwind Play CDN
// ============================================================================

function page(title: string, body: string, activeNav: 'oversigt' | 'kørsler' | 'forbedringer' = 'oversigt'): string {
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Dear User</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com?plugins=typography"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ['Geist', 'system-ui', 'sans-serif'],
          mono: ['Geist Mono', 'ui-monospace', 'monospace'],
        },
        colors: {
          paper: {
            50:  '#FDFBF6',   // near-white, base background
            100: '#F8F2E7',   // warm cream, card highlight
            200: '#EFE4CF',   // gentle divider
            300: '#D8C8A9',   // border
          },
          ink: {
            900: '#1F1A14',   // body text
            700: '#3E352A',
            500: '#72655B',   // muted
            300: '#AE9F91',   // very muted
          },
          accent: {
            600: '#C3563B',   // terracotta, primary accent
            500: '#D77356',   // hover
            100: '#F6E3D7',   // soft background for pills
          },
          good: { bg: '#E4EED5', fg: '#4B6B2B' },
          warn: { bg: '#F6E3D7', fg: '#9C4A2F' },
          bad:  { bg: '#F2D4CD', fg: '#8F2A1C' },
        },
      },
    },
  };
</script>
<style>
  body {
    font-family: 'Geist', system-ui, sans-serif;
    font-feature-settings: 'ss01';
  }
  /* Paper texture — very subtle noise for the cream background */
  body::before {
    content: '';
    position: fixed; inset: 0;
    background-image: radial-gradient(rgba(0,0,0,0.015) 1px, transparent 1px);
    background-size: 3px 3px;
    pointer-events: none;
    z-index: 0;
  }
  main, header { position: relative; z-index: 1; }
  .letter-prose h1, .letter-prose h2, .letter-prose h3 { font-weight: 600; color: #1F1A14; }
  .letter-prose h1 { font-size: 1.5rem; margin: 1.5rem 0 0.75rem; }
  .letter-prose h2 { font-size: 1.2rem; margin: 1.75rem 0 0.5rem; border-top: 1px solid #EFE4CF; padding-top: 1rem; }
  .letter-prose h3 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
  .letter-prose p { margin: 0.6rem 0; line-height: 1.65; color: #3E352A; }
  .letter-prose ul, .letter-prose ol { padding-left: 1.4rem; margin: 0.5rem 0; }
  .letter-prose li { margin: 0.25rem 0; line-height: 1.55; color: #3E352A; }
  .letter-prose strong { color: #1F1A14; }
  .letter-prose code { font-family: 'Geist Mono', monospace; font-size: 0.85em; background: #F8F2E7; padding: 0.1em 0.35em; border-radius: 3px; color: #9C4A2F; }
  .letter-prose pre { background: #FDFBF6; border: 1px solid #EFE4CF; border-radius: 6px; padding: 1rem; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
  .letter-prose pre code { background: none; padding: 0; color: #3E352A; }
  .letter-prose blockquote { border-left: 3px solid #C3563B; padding-left: 1rem; color: #72655B; margin: 1rem 0; font-style: italic; }
  .letter-prose a { color: #C3563B; text-decoration: underline; text-underline-offset: 2px; }
</style>
</head>
<body class="bg-paper-50 text-ink-900 antialiased min-h-screen">
  <header class="border-b border-paper-200 bg-paper-50/90 backdrop-blur sticky top-0 z-10">
    <div class="max-w-3xl mx-auto px-6 py-4 flex items-center gap-8">
      <a href="/" class="flex items-center gap-2 font-semibold text-ink-900 hover:text-accent-600 transition">
        <span class="text-xl">💌</span>
        <span>Dear User</span>
      </a>
      <nav class="flex gap-6 text-sm">
        <a href="/" class="${activeNav === 'oversigt' ? 'text-ink-900 font-medium' : 'text-ink-500 hover:text-ink-900'} transition">Forside</a>
        <a href="/historik" class="${activeNav === 'kørsler' ? 'text-ink-900 font-medium' : 'text-ink-500 hover:text-ink-900'} transition">Mine rapporter</a>
        <a href="/forbedringer" class="${activeNav === 'forbedringer' ? 'text-ink-900 font-medium' : 'text-ink-500 hover:text-ink-900'} transition">Forslag</a>
      </nav>
    </div>
  </header>
  <main class="max-w-3xl mx-auto px-6 py-10">
${body}
  </main>
  <footer class="max-w-3xl mx-auto px-6 py-10 text-sm text-ink-500">
    Alt kører lokalt på din computer. Intet forlader maskinen.
  </footer>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderMarkdown(md: string): string {
  // marked.parse returns a string for non-async usage. Cast to satisfy types.
  return marked.parse(md, { async: false }) as string;
}

// ============================================================================
// Landing — greeting + latest letter + open suggestions
// ============================================================================

/**
 * Landing page doubles as the product's main dashboard. Shows the three
 * domain scores (samarbejde / sikkerhed / system-sundhed) side-by-side with
 * one combined headline number, keeping the "Kære Jarl" letter tone in the
 * intro so the product doesn't feel clinical. Competitors are pure dashboards;
 * we're a dashboard with a voice.
 */
function renderLanding(): string {
  const recent = getRecentRuns(20).filter((r: any) => r.details && r.details.trim().length > 0).slice(0, 5);
  const latest = getLatestScoresByTool();
  const pending = getRecommendations('pending').slice(0, 3);

  // Normalise null/undefined/non-number to null so the tile renderer has a
  // single missing-value check. Previously `?.score` returned undefined on
  // missing domains, which the renderer's `=== null` check didn't catch —
  // result: "undefined/100" in red on the dashboard.
  const normScore = (run: any): number | null => {
    const s = run?.score;
    return typeof s === 'number' ? s : null;
  };
  const scores = {
    samarbejde: normScore(latest.analyze),
    sikkerhed: normScore(latest.security),
    systemSundhed: normScore(latest.systemHealth),
  };

  // Combined score = equal weight across the three domains we actually have
  // data for. Scoring a domain that hasn't run would be dishonest.
  const measured = [scores.samarbejde, scores.sikkerhed, scores.systemSundhed].filter((s): s is number => typeof s === 'number');
  const combinedScore = measured.length > 0 ? Math.round(measured.reduce((a, b) => a + b, 0) / measured.length) : null;

  const hasContent = recent.length > 0 || pending.length > 0 || measured.length > 0;

  if (!hasContent) {
    return page('Forside', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">${escapeHtml(greeting())}</h1>
        <p class="text-ink-500 max-w-md mx-auto leading-relaxed">
          Jeg har ikke hørt fra dig endnu. Gå tilbage til Claude Code og bed mig om at
          <code class="font-mono text-sm bg-paper-100 px-1.5 py-0.5 rounded text-accent-600">lave min første rapport</code>
          — så sender jeg et brev her til dig.
        </p>
      </section>
    `, 'oversigt');
  }

  // Score tile — one per domain. Missing scores render a neutral "not yet"
  // state with a CTA rather than a fake zero.
  const tile = (label: string, hint: string, score: number | null, reportId?: string, toolHint?: string): string => {
    if (score === null) {
      return `
        <div class="bg-paper-50 border border-dashed border-paper-300 rounded-xl p-5 flex flex-col justify-between min-h-[160px]">
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-400 mb-1">${escapeHtml(label)}</div>
            <div class="font-mono text-3xl text-ink-300">—/100</div>
          </div>
          <div class="text-xs text-ink-400 mt-3">
            Jeg har ikke kørt ${escapeHtml(label.toLowerCase())} endnu. Bed mig om <code class="font-mono bg-paper-100 px-1 rounded text-ink-500">${escapeHtml(toolHint || label)}</code>.
          </div>
        </div>
      `;
    }
    const color = score >= 85 ? 'text-emerald-700' : score >= 70 ? 'text-amber-700' : 'text-rose-700';
    const href = reportId ? `/r/${escapeHtml(reportId)}` : '#';
    return `
      <a href="${href}" class="bg-paper-100 border border-paper-200 rounded-xl p-5 flex flex-col justify-between min-h-[160px] hover:border-accent-600 transition group">
        <div>
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1 group-hover:text-accent-600 transition">${escapeHtml(label)}</div>
          <div class="font-mono text-4xl font-medium ${color} leading-none">${score}<span class="text-lg text-ink-300">/100</span></div>
        </div>
        <div class="text-xs text-ink-500 mt-3">${escapeHtml(hint)} <span class="text-ink-300 group-hover:text-accent-600 transition">→</span></div>
      </a>
    `;
  };

  const combinedBlock = combinedScore !== null ? `
    <div class="bg-gradient-to-br from-accent-50 to-paper-100 border border-accent-200 rounded-xl p-6 mb-6">
      <div class="flex items-baseline justify-between gap-6 flex-wrap">
        <div>
          <div class="text-xs uppercase tracking-wider text-accent-700 mb-1">Samlet</div>
          <div class="font-mono text-6xl font-medium text-ink-900 leading-none">${combinedScore}<span class="text-2xl text-ink-300">/100</span></div>
          <div class="text-sm text-ink-500 mt-2">
            Gennemsnit af ${measured.length} målt${measured.length === 1 ? '' : 'e'} område${measured.length === 1 ? '' : 'r'}.
          </div>
        </div>
        ${latest.analyze?.summary ? `
          <div class="text-sm text-ink-700 max-w-md">${escapeHtml(String(latest.analyze.summary).split(' — ').slice(-1)[0] || '')}</div>
        ` : ''}
      </div>
    </div>
  ` : '';

  const gridBlock = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${tile('Samarbejde', 'Hvor godt vi arbejder sammen', scores.samarbejde, latest.analyze?.id, 'lav en samarbejds-rapport')}
      ${tile('Sikkerhed', 'Secrets, injection, RLS, CVEs', scores.sikkerhed, latest.security?.id, 'kør sikkerhedstjek')}
      ${tile('System-sundhed', 'Om dit setup stadig hænger sammen', scores.systemSundhed, latest.systemHealth?.id, 'kør system-sundhed')}
    </div>
  `;

  const pendingBlock = pending.length > 0 ? `
    <div class="mt-10">
      <h2 class="text-xs uppercase tracking-wider text-ink-500 mb-3">Forslag der venter på dig</h2>
      <ul class="space-y-2">
        ${pending.map(p => {
          const f = friendlyLabel(p.title);
          return `
            <li class="bg-paper-50 border border-paper-200 rounded-lg px-4 py-3">
              <div class="font-medium text-ink-900">${escapeHtml(f.title)}</div>
              ${f.summary ? `<div class="text-sm text-ink-500 mt-0.5">${escapeHtml(f.summary)}</div>` : ''}
            </li>
          `;
        }).join('')}
      </ul>
      <a href="/forbedringer" class="inline-block mt-3 text-sm text-accent-600 hover:text-accent-500 transition">Se alle forslag →</a>
    </div>
  ` : '';

  return page('Forside', `
    <section>
      <h1 class="text-3xl font-semibold mb-2">${escapeHtml(greeting())},</h1>
      <p class="text-ink-500">Her er tilstanden i dag — tre områder jeg holder øje med for dig, plus et samlet tal.</p>
    </section>
    <section class="mt-8">
      ${combinedBlock}
      ${gridBlock}
      ${pendingBlock}
    </section>
  `, 'oversigt');
}

// ============================================================================
// Historik — alle kørsler
// ============================================================================

function renderHistorik(): string {
  // Hide runs with no saved body — they happen for older runs (pre-persist
  // feature) and are useless to the user since /r/:id would show nothing.
  const runs = getRecentRuns(100).filter((r: any) => r.details && r.details.trim().length > 0);

  if (runs.length === 0) {
    return page('Mine rapporter', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">Ingen rapporter endnu</h1>
        <p class="text-ink-500 max-w-md mx-auto">
          Åbn Claude Code og bed mig lave din første rapport. Alle mine breve ender her.
        </p>
      </section>
    `, 'kørsler');
  }

  return page('Mine rapporter', `
    <section>
      <h1 class="text-3xl font-semibold mb-2">Mine rapporter</h1>
      <p class="text-ink-500 mb-8">Hvert brev jeg har sendt til dig — nyeste først.</p>
      <ul class="space-y-2">
        ${runs.map(r => `
          <li>
            <a href="/r/${escapeHtml(r.id)}" class="flex items-start gap-4 bg-paper-100 border border-paper-200 rounded-lg p-4 hover:border-accent-600 transition group">
              <div class="text-xl">${toolEmoji(r.tool_name)}</div>
              <div class="flex-1 min-w-0">
                <div class="font-medium text-ink-900 group-hover:text-accent-600 transition">${escapeHtml(toolLabel(r.tool_name))}</div>
                <div class="text-sm text-ink-500 mt-0.5">${timeAgo(r.started_at)}</div>
                ${r.summary ? `<p class="text-sm text-ink-700 mt-2 truncate">${escapeHtml(r.summary)}</p>` : ''}
              </div>
              ${r.score !== null ? `<div class="font-mono text-lg text-ink-700">${r.score}</div>` : ''}
            </a>
          </li>
        `).join('')}
      </ul>
    </section>
  `, 'kørsler');
}

// ============================================================================
// Single report — rendered as an open letter with the markdown body
// ============================================================================

function renderReport(id: string): string {
  const run = getRunById(id);
  if (!run) {
    return page('Rapport ikke fundet', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">Det her brev findes ikke</h1>
        <p class="text-ink-500 mb-6">Måske blev det slettet, eller linket er forkert.</p>
        <a href="/" class="text-accent-600 hover:text-accent-500 transition">Gå tilbage til forsiden</a>
      </section>
    `, 'oversigt');
  }

  // Structured letter render if we have JSON for this run (new analyze tool);
  // otherwise fall back to markdown-from-details (older runs).
  if (run.report_json) {
    try {
      const parsed = JSON.parse(run.report_json);
      if (run.tool_name === 'analyze') return renderAnalyzeLetter(run, parsed);
      if (run.tool_name === 'security') return renderSecurityLetter(run, parsed);
      if (run.tool_name === 'system-health' || run.tool_name === 'audit') {
        return renderSystemHealthLetter(run, parsed);
      }
    } catch { /* fall through to markdown */ }
  }
  return renderMarkdownFallback(run);
}

function renderMarkdownFallback(run: any): string {
  const body = run.details || run.summary || '_(Brevet indeholder ingen tekst.)_';
  // Strip the "Hvad vil du gøre nu?" menu from the body — that section is
  // for chat-flow only (the action menu only makes sense inline in a
  // conversation where the agent can call AskUserQuestion). On the web it
  // just reads as confusing bureaucracy.
  const stripped = body.replace(/\n*---\n*## Hvad vil du gøre nu\?[\s\S]*?(?=\n---|\s*$)/m, '');
  const rendered = renderMarkdown(stripped);
  return page(`${toolLabel(run.tool_name)}`, `
    <article class="max-w-2xl mx-auto">
      <header class="mb-8">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">${escapeHtml(toolLabel(run.tool_name))}</div>
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>
      <p class="text-xl text-ink-900 font-medium mb-1">${escapeHtml(greeting())},</p>
      <p class="text-ink-500 mb-8 leading-relaxed">Her er hvad jeg fandt.</p>
      <div class="letter-prose">${rendered}</div>
      <footer class="mt-12 pt-6 border-t border-paper-200">
        <p class="text-ink-500 italic">Med venlig hilsen,</p>
        <p class="text-ink-900 font-medium mt-1">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">← Se alle mine breve</a>
    </div>
  `, 'oversigt');
}

// ============================================================================
// Letter-format analyze report — the core redesign.
//
// Information architecture (top → bottom):
//   1. Warm greeting + one-sentence overall take
//   2. Score card — big number, persona name, no checklist clutter
//   3. "Det vigtigste først" — the ONE top action, framed as what we want the
//      user to change. Not 10 findings, ONE.
//   4. "Tre små ting" — 3 cards with friendly-label summary + benefit
//   5. "Hvordan står det til" — 7 category progress pills, details collapsed
//   6. Collapsed sections the user can open if curious:
//      - Tekniske detaljer i dine instruktioner (lint findings)
//      - Din daglige brug (stats, sessions, projects)
//      - Hvad der er sket siden sidst (feedback loop)
//   7. Warm sign-off
//
// Anti-patterns we're avoiding: markdown-dump, inline-kitchen-sink,
// technical-copy, no-hierarchy, no-focus.
// ============================================================================

function renderAnalyzeLetter(run: any, report: any): string {
  const score = typeof report.collaborationScore === 'number' ? report.collaborationScore : run.score;
  const persona = report.persona?.archetypeName || report.persona?.detected || 'bruger';
  const personaBlurb = report.persona?.archetypeDescription || '';

  // ---- Pick THE top action from the recommendations list ----
  const allRecs: any[] = Array.isArray(report.recommendations) ? report.recommendations : [];
  const topAction = pickTopAction(allRecs);
  const smallThings = pickSmallThings(allRecs, (report.toolRecs as any[]) || [], topAction);

  // ---- Category scores for the combined score + category section ----
  const categories = report.categories || {};
  const catEntries: Array<{ key: string; score: number }> = [
    { key: 'roleClarity',     score: categories.roleClarity?.score     ?? 0 },
    { key: 'communication',   score: categories.communication?.score   ?? 0 },
    { key: 'memoryHealth',    score: categories.memoryHealth?.score    ?? 0 },
    { key: 'coverage',        score: categories.coverage?.score        ?? 0 },
    { key: 'autonomyBalance', score: categories.autonomyBalance?.score ?? 0 },
    { key: 'systemMaturity',  score: categories.systemMaturity?.score  ?? 0 },
    { key: 'qualityStandards',score: categories.qualityStandards?.score?? 0 },
  ].sort((a, b) => b.score - a.score);

  const lintFindings: any[] = report.lint?.findings || [];
  const stats = report.stats || {};
  const session = report.session || {};
  const feedback = report.feedback || null;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <!-- Header -->
      <header class="mb-10 not-letter">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">Din samarbejds-rapport</div>
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <!-- Greeting — brev-style, leads into the rest of the letter -->
      <section class="mb-10">
        <p class="text-xl text-ink-900 font-medium mb-3" style="margin-bottom: 0.75rem">${escapeHtml(greeting())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">
          ${escapeHtml(personaBlurb
            ? `Jeg har kigget dit setup igennem. Du arbejder som "${persona}" — ${lowerFirst(personaBlurb.split('.')[0])}. Her er hvad jeg fandt.`
            : `Jeg har kigget dit setup igennem. Her er hvad jeg fandt.`)}
        </p>
      </section>

      <!-- Combined: overall score + per-category bars, one section, one glance -->
      ${renderScoreAndCategories(score, catEntries)}

      <!-- Top action — inline brev-prose, not a card -->
      ${topAction ? renderTopActionInline(topAction) : ''}

      ${smallThings.length > 0 ? renderSmallThings(smallThings) : ''}

      <!-- Progressive disclosure: technical details -->
      ${lintFindings.length > 0 ? renderCollapsedLint(lintFindings) : ''}

      ${Object.keys(stats).length > 0 ? renderCollapsedStats(stats, session) : ''}

      ${feedback ? renderCollapsedFeedback(feedback) : ''}

      <!-- Sign-off -->
      <footer class="mt-16 pt-8 border-t border-paper-200">
        <p class="text-ink-500 italic">Med venlig hilsen,</p>
        <p class="text-ink-900 font-medium mt-1">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">← Se alle mine breve</a>
    </div>
  `;

  return page(`${toolLabel(run.tool_name)}`, body, 'oversigt');
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

// ----- Top action — rendered as brev-prose, not a bordered card. A card
// reads as "dashboard KPI"; a letter reads as "Dear User wants to tell you
// one thing specifically". Use typography (a thin accent rule, italic lead-in)
// instead of a heavy border-box to keep the letter tone.

function renderTopActionInline(rec: any): string {
  const f = friendlyLabel(rec.title || '');
  const title = f.title || rec.title || 'Den vigtigste ting';
  const why = f.benefit || rec.why || rec.description || '';
  const howItLooks = rec.howItLooks || '';
  const practiceStep = rec.practiceStep || '';
  const leadIn = rec.priority === 'critical'
    ? 'Men én ting vil jeg særligt bede dig tage med dig:'
    : 'En ting jeg særligt lagde mærke til:';

  return `
    <section class="mb-12">
      <p class="text-ink-500 italic mb-3">${escapeHtml(leadIn)}</p>

      <!-- Accent rule to the left as a letter-style emphasis mark, no card border -->
      <div class="pl-5 border-l-2 border-accent-600">
        <h2 class="text-2xl font-semibold text-ink-900 mb-3 leading-tight" style="font-family: 'Geist', sans-serif">${escapeHtml(title)}</h2>
        ${why ? `<p class="text-ink-700 leading-relaxed mb-4">${escapeHtml(why)}</p>` : ''}

        ${howItLooks ? `
          <details class="mt-3 group">
            <summary class="cursor-pointer text-sm text-accent-600 hover:text-accent-500 list-none inline-flex items-center gap-1.5">
              <span class="transition-transform group-open:rotate-90">▸</span>
              <span>Et eksempel på hvordan det ser ud</span>
            </summary>
            <div class="mt-3 text-sm text-ink-700 whitespace-pre-wrap leading-relaxed italic">${escapeHtml(howItLooks)}</div>
          </details>
        ` : ''}

        ${practiceStep ? `
          <p class="mt-4 text-ink-700 leading-relaxed">
            <span class="text-ink-500 italic">Prøv det næste gang: </span>${escapeHtml(practiceStep)}
          </p>
        ` : ''}
      </div>
    </section>
  `;
}

// ----- Combined score + categories — one section, one glance.
//
// Hero-tal stays at the top, then each of the 7 categories flows directly
// underneath as a row with: name + plain-language line (always visible) +
// bar + score. Clicking the row expands "what's pulling this up/down" and
// "what your score means" — details are progressive, not demanded.

function renderScoreAndCategories(score: number | null, catEntries: Array<{ key: string; score: number }>): string {
  const pct = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
  const verdict = typeof score === 'number' ? overallVerdict(score) : '';

  return `
    <section class="mb-12">
      <!-- Hero score — big number, verdict line. No side-by-side persona card. -->
      <div class="bg-paper-100 border border-paper-200 rounded-2xl p-6 mb-5">
        <div class="flex items-baseline justify-between mb-3">
          <div class="text-xs uppercase tracking-wider text-ink-500">Overall</div>
          <div class="text-xs text-ink-300 font-mono">0–100</div>
        </div>
        <div class="flex items-baseline gap-3 mb-2">
          <div class="font-mono text-6xl font-semibold text-ink-900 leading-none">${typeof score === 'number' ? score : '—'}</div>
          <div class="text-xl text-ink-300">/100</div>
        </div>
        ${verdict ? `<p class="text-ink-700 leading-relaxed mt-3">${escapeHtml(verdict)}</p>` : ''}
      </div>

      <!-- Per-category rows, sorted high→low -->
      <div class="divide-y divide-paper-200 border-t border-paper-200">
        ${catEntries.map(c => renderCategoryRow(c.key, c.score)).join('')}
      </div>
    </section>
  `;
}

function renderCategoryRow(key: string, score: number): string {
  const explanation = CATEGORY_EXPLANATIONS[key];
  if (!explanation) return '';

  const pct = Math.max(0, Math.min(100, score));
  const barColor = pct >= 85 ? 'bg-good-fg' : pct >= 65 ? 'bg-accent-600' : 'bg-warn-fg';
  const verdict = explanation.verdict(pct);

  return `
    <details class="group py-3">
      <summary class="cursor-pointer list-none hover:bg-paper-50 rounded-lg -mx-2 px-2 py-1.5 transition">
        <div class="flex items-baseline gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="font-medium text-ink-900">${escapeHtml(explanation.label)}</span>
              <span class="text-ink-300 text-xs transition-transform group-open:rotate-90 inline-block">▸</span>
            </div>
            <div class="text-sm text-ink-500 mt-0.5 leading-snug">${escapeHtml(explanation.summary)}</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="w-28 h-2 bg-paper-200 rounded-full overflow-hidden">
              <div class="h-full ${barColor} rounded-full" style="width: ${pct}%"></div>
            </div>
            <div class="font-mono text-sm text-ink-700 w-8 text-right">${pct}</div>
          </div>
        </div>
      </summary>
      <div class="mt-3 ml-0 pl-4 border-l border-paper-200 text-sm leading-relaxed space-y-3">
        <div>
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">Hvad betyder din score</div>
          <p class="text-ink-700 italic">${escapeHtml(verdict)}</p>
        </div>
        <div>
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">Hvad trækker scoren op eller ned</div>
          <p class="text-ink-700">${escapeHtml(explanation.whatMatters)}</p>
        </div>
      </div>
    </details>
  `;
}

// ----- Three small things -----

function renderSmallThings(items: Array<{ title: string; summary?: string; benefit?: string }>): string {
  return `
    <section class="mb-12">
      <h2 class="text-lg font-semibold text-ink-900 mb-4">Tre små ting jeg lagde mærke til</h2>
      <p class="text-sm text-ink-500 mb-5">Ikke kritiske, men de kunne gøre dagligdagen lettere.</p>
      <ul class="space-y-3">
        ${items.slice(0, 3).map(item => `
          <li class="bg-paper-100 border border-paper-200 rounded-xl p-5">
            <div class="font-medium text-ink-900 mb-1.5">${escapeHtml(item.title)}</div>
            ${item.summary ? `<div class="text-sm text-ink-700 leading-relaxed">${escapeHtml(item.summary)}</div>` : ''}
            ${item.benefit ? `
              <details class="mt-2 group">
                <summary class="cursor-pointer text-xs text-accent-600 hover:text-accent-500 list-none inline-flex items-center gap-1">
                  <span class="transition-transform group-open:rotate-90">▸</span>
                  <span>Hvad bliver bedre?</span>
                </summary>
                <div class="mt-2 text-sm text-ink-600 leading-relaxed">${escapeHtml(item.benefit)}</div>
              </details>
            ` : ''}
          </li>
        `).join('')}
      </ul>
      <a href="/forbedringer" class="inline-block mt-4 text-sm text-accent-600 hover:text-accent-500">Se alle forslag →</a>
    </section>
  `;
}

// ----- Collapsed sections -----

function renderCollapsedLint(findings: any[]): string {
  const critical = findings.filter(f => f.severity === 'critical').length;
  const recommended = findings.filter(f => f.severity === 'recommended').length;
  const nice = findings.filter(f => f.severity === 'nice_to_have').length;
  const headline = critical > 0
    ? `${critical} kritisk, ${recommended} anbefalet, ${nice} nice-to-have`
    : `${recommended + nice} små ting der kan forbedres (ingen kritiske)`;

  return `
    <section class="mb-8">
      <details class="group bg-paper-100/60 border border-paper-200 rounded-xl">
        <summary class="cursor-pointer px-5 py-4 list-none flex items-center justify-between hover:bg-paper-100 rounded-xl">
          <div>
            <div class="font-medium text-ink-900">Tekniske detaljer i dine instruktioner</div>
            <div class="text-sm text-ink-500 mt-0.5">${escapeHtml(headline)}</div>
          </div>
          <span class="text-ink-300 transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div class="px-5 pb-5 pt-2">
          <ul class="space-y-3">
            ${findings.slice(0, 24).map(f => `
              <li class="border-l-2 ${f.severity === 'critical' ? 'border-bad-fg' : f.severity === 'recommended' ? 'border-warn-fg' : 'border-paper-300'} pl-3">
                <div class="text-sm font-medium text-ink-800">${escapeHtml(f.title || f.id || 'Finding')}</div>
                ${f.description ? `<div class="text-xs text-ink-500 mt-0.5 leading-relaxed">${escapeHtml(f.description)}</div>` : ''}
                ${f.fix ? `<div class="text-xs text-accent-600 mt-1">→ ${escapeHtml(f.fix)}</div>` : ''}
              </li>
            `).join('')}
          </ul>
        </div>
      </details>
    </section>
  `;
}

function renderCollapsedStats(stats: any, session: any): string {
  const activeSessions = session?.stats?.sessionsLast7Days ?? 0;
  const totalRules = stats?.totalRules ?? 0;
  const memoryFiles = stats?.memoryFiles ?? 0;
  const corrections = session?.corrections?.negationCount ?? 0;

  return `
    <section class="mb-8">
      <details class="group bg-paper-100/60 border border-paper-200 rounded-xl">
        <summary class="cursor-pointer px-5 py-4 list-none flex items-center justify-between hover:bg-paper-100 rounded-xl">
          <div>
            <div class="font-medium text-ink-900">Din daglige brug</div>
            <div class="text-sm text-ink-500 mt-0.5">${activeSessions} sessioner sidste 7 dage · ${totalRules} regler · ${memoryFiles} memory-filer</div>
          </div>
          <span class="text-ink-300 transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div class="px-5 pb-5 pt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">Regler i alt</div>
            <div class="font-mono text-lg text-ink-800">${totalRules}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">Memory-filer</div>
            <div class="font-mono text-lg text-ink-800">${memoryFiles}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">Sessioner sidste 7 dage</div>
            <div class="font-mono text-lg text-ink-800">${activeSessions}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">Rettelser du har givet</div>
            <div class="font-mono text-lg text-ink-800">${corrections}</div>
          </div>
        </div>
      </details>
    </section>
  `;
}

function renderCollapsedFeedback(feedback: any): string {
  const implemented = feedback.implemented ?? 0;
  const pending = feedback.pending ?? 0;
  const total = feedback.totalRecommendations ?? 0;
  if (total === 0) return '';

  return `
    <section class="mb-8">
      <details class="group bg-paper-100/60 border border-paper-200 rounded-xl">
        <summary class="cursor-pointer px-5 py-4 list-none flex items-center justify-between hover:bg-paper-100 rounded-xl">
          <div>
            <div class="font-medium text-ink-900">Hvad er der sket siden sidst</div>
            <div class="text-sm text-ink-500 mt-0.5">${implemented} implementeret · ${pending} venter · ${total} i alt</div>
          </div>
          <span class="text-ink-300 transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div class="px-5 pb-5 pt-2 text-sm text-ink-600 leading-relaxed">
          Jeg holder styr på hvilke forslag du har taget imod og hvilke der stadig venter. Se detaljerne på <a href="/forbedringer" class="text-accent-600 hover:text-accent-500">Forslag-siden</a>.
        </div>
      </details>
    </section>
  `;
}

// ============================================================================
// Security & system-sundhed letters — share the visual language of the
// analyze letter so every report feels like the same product speaking. The
// structure is deliberately simpler: these reports are findings-driven, so
// they don't need "top action + three small things" — the findings ARE the
// actions, sorted by severity.
// ============================================================================

function renderSecurityLetter(run: any, report: any): string {
  const score = typeof report.securityScore === 'number' ? report.securityScore : run.score;
  const categories = report.categories || {};
  const catEntries: Array<{ key: string; score: number }> = [
    { key: 'secretSafety', score: categories.secretSafety?.score ?? 0 },
    { key: 'injectionResistance', score: categories.injectionResistance?.score ?? 0 },
    { key: 'ruleIntegrity', score: categories.ruleIntegrity?.score ?? 0 },
    { key: 'dependencySafety', score: categories.dependencySafety?.score ?? 0 },
    { key: 'platformCompliance', score: categories.platformCompliance?.score ?? 0 },
  ].sort((a, b) => b.score - a.score);

  const allFindings = [
    ...(report.secrets || []).map((f: any) => ({ ...f, _kind: 'Secret' })),
    ...(report.injection || []).map((f: any) => ({ ...f, _kind: 'Injection' })),
    ...(report.ruleConflicts || []).map((f: any) => ({ ...f, _kind: 'Rule conflict' })),
    ...(report.cveFindings || []).map((f: any) => ({ ...f, _kind: 'CVE' })),
    ...(report.platformFindings || []).map((f: any) => ({ ...f, _kind: 'Platform' })),
  ];
  const sevOrder: Record<string, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  allFindings.sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  const ceiling = report.scoreCeiling;
  const leadIn = allFindings.length === 0
    ? 'Jeg har gennemgået dit setup for leaks, injection-overflader, regel-konflikter og eksterne advisors. Alt ser rent ud.'
    : `Jeg har gennemgået dit setup for leaks, injection-overflader, regel-konflikter og eksterne advisors. Jeg fandt ${allFindings.length} ${allFindings.length === 1 ? 'ting' : 'ting'} værd at kigge på.`;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <header class="mb-10 not-letter">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">Sikkerhedstjek</div>
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <section class="mb-10">
        <p class="text-xl text-ink-900 font-medium mb-3" style="margin-bottom: 0.75rem">${escapeHtml(greeting())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${escapeHtml(leadIn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, securityVerdict, ceiling)}

      ${renderSecurityFindings(allFindings)}

      <footer class="mt-16 pt-8 border-t border-paper-200">
        <p class="text-ink-500 italic">Med venlig hilsen,</p>
        <p class="text-ink-900 font-medium mt-1">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">← Se alle mine breve</a>
    </div>
  `;

  return page(`${toolLabel(run.tool_name)}`, body, 'oversigt');
}

function renderSystemHealthLetter(run: any, report: any): string {
  const score = typeof report.systemHealthScore === 'number' ? report.systemHealthScore : run.score;
  const categories = report.categories || {};
  const catEntries: Array<{ key: string; score: number }> = [
    { key: 'jobIntegrity', score: categories.jobIntegrity?.score ?? 0 },
    { key: 'artifactOverlap', score: categories.artifactOverlap?.score ?? 0 },
    { key: 'dataClosure', score: categories.dataClosure?.score ?? 0 },
    { key: 'configHealth', score: categories.configHealth?.score ?? 0 },
    { key: 'substrateHealth', score: categories.substrateHealth?.score ?? 0 },
  ].sort((a, b) => b.score - a.score);

  const findings: any[] = report.findings || [];
  const sevOrder: Record<string, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
  const sortedFindings = [...findings].sort((a, b) => (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3));

  const ceiling = report.scoreCeiling;
  const closureRate = typeof report.graph?.closureRate === 'number' ? Math.round(report.graph.closureRate * 100) : null;
  const leadIn = findings.length === 0
    ? 'Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Alt hænger sammen.'
    : `Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Jeg fandt ${findings.length} ${findings.length === 1 ? 'ting' : 'ting'} værd at tage fat på${closureRate !== null ? ` (og ${closureRate}% af dine outputs har en modtager)` : ''}.`;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <header class="mb-10 not-letter">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">System-sundhed</div>
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <section class="mb-10">
        <p class="text-xl text-ink-900 font-medium mb-3" style="margin-bottom: 0.75rem">${escapeHtml(greeting())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${escapeHtml(leadIn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, systemHealthVerdict, ceiling)}

      ${renderSystemHealthFindings(sortedFindings)}

      <footer class="mt-16 pt-8 border-t border-paper-200">
        <p class="text-ink-500 italic">Med venlig hilsen,</p>
        <p class="text-ink-900 font-medium mt-1">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">← Se alle mine breve</a>
    </div>
  `;

  return page(`${toolLabel(run.tool_name)}`, body, 'oversigt');
}

/**
 * Shared score + per-category section for the two findings-based letters.
 * Takes a verdict function so each domain uses its own wording (security
 * speaks in terms of "fund", system-sundhed speaks in terms of "sammenhæng").
 * Mirrors renderScoreAndCategories but surfaces the ceiling since findings-
 * driven reports reach their ceiling purely by fixing things — users should
 * see that line-of-sight directly.
 */
function renderDomainScoreAndCategories(
  score: number | null,
  catEntries: Array<{ key: string; score: number }>,
  verdictFn: (s: number) => string,
  ceiling: any,
): string {
  const verdict = typeof score === 'number' ? verdictFn(score) : '';
  const ceilingLine = ceiling && typeof ceiling.ceilingScore === 'number' && ceiling.delta > 0
    ? `<p class="text-sm text-ink-500 mt-3">Fixer du alle fund nedenfor rykker du til <strong class="text-ink-900">${ceiling.ceilingScore}/100</strong> (+${ceiling.delta}).</p>`
    : ceiling && ceiling.ceilingScore === score
      ? `<p class="text-sm text-ink-500 mt-3">Du er allerede på loftet for hvad der kan måles lige nu.</p>`
      : '';

  return `
    <section class="mb-12">
      <div class="bg-paper-100 border border-paper-200 rounded-2xl p-6 mb-5">
        <div class="flex items-baseline justify-between mb-3">
          <div class="text-xs uppercase tracking-wider text-ink-500">Overall</div>
          <div class="text-xs text-ink-300 font-mono">0–100</div>
        </div>
        <div class="flex items-baseline gap-3 mb-2">
          <div class="font-mono text-6xl font-semibold text-ink-900 leading-none">${typeof score === 'number' ? score : '—'}</div>
          <div class="text-xl text-ink-300">/100</div>
        </div>
        ${verdict ? `<p class="text-ink-700 leading-relaxed mt-3">${escapeHtml(verdict)}</p>` : ''}
        ${ceilingLine}
      </div>

      <div class="divide-y divide-paper-200 border-t border-paper-200">
        ${catEntries.map(c => renderCategoryRow(c.key, c.score)).join('')}
      </div>
    </section>
  `;
}

function severityBadge(severity: string): string {
  if (severity === 'critical') return '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700"><span class="w-1.5 h-1.5 rounded-full bg-rose-600"></span>Kritisk</span>';
  if (severity === 'recommended') return '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Anbefalet</span>';
  return '<span class="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500"><span class="w-1.5 h-1.5 rounded-full bg-ink-300"></span>Nice to have</span>';
}

function renderSecurityFindings(findings: any[]): string {
  if (findings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed italic">Ingen fund i dag. Kom tilbage efter næste scan.</p>
      </section>
    `;
  }
  const shown = findings.slice(0, 15);
  const extra = findings.length - shown.length;

  return `
    <section class="mb-12">
      <h2 class="text-lg font-semibold text-ink-900 mb-4">Det jeg fandt</h2>
      <div class="space-y-4">
        ${shown.map(f => {
          const title = f.title || f.category || f._kind;
          const where = f.location || f.artifactPath || f.conflictingPath || f.projectName || '';
          const fix = f.recommendation || f.fix || '';
          const why = f.why || '';
          return `
            <article class="border-l-2 border-paper-300 pl-4 py-1">
              <div class="flex items-baseline gap-3 flex-wrap mb-1">
                ${severityBadge(f.severity)}
                <span class="text-xs uppercase tracking-wider text-ink-400">${escapeHtml(f._kind)}</span>
              </div>
              <h3 class="font-medium text-ink-900 mt-1" style="margin: 0.25rem 0">${escapeHtml(title)}</h3>
              ${where ? `<p class="text-xs text-ink-500 font-mono mt-1" style="margin: 0.25rem 0">${escapeHtml(where)}</p>` : ''}
              ${why ? `<p class="text-sm text-ink-700 mt-2 leading-relaxed" style="margin-top: 0.5rem">${escapeHtml(why)}</p>` : ''}
              ${fix ? `<p class="text-sm text-ink-700 mt-2 leading-relaxed" style="margin-top: 0.5rem"><span class="text-ink-500 italic">Fix: </span>${escapeHtml(fix)}</p>` : ''}
            </article>
          `;
        }).join('')}
      </div>
      ${extra > 0 ? `<p class="text-sm text-ink-500 mt-4 italic">…og ${extra} fund til. Kør med format="detailed" eller kig i chat-outputtet for alle.</p>` : ''}
    </section>
  `;
}

function renderSystemHealthFindings(findings: any[]): string {
  if (findings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed italic">Ingen ting at rydde op i. Setup\'et hænger sammen.</p>
      </section>
    `;
  }
  const TYPE_LABELS: Record<string, string> = {
    orphan_job: 'Forældreløst job',
    stale_schedule: 'Dødt skema',
    overlap: 'Overlap',
    missing_closure: 'Manglende modtager',
    unregistered_mcp_tool: 'Ikke-registreret MCP tool',
    substrate_mismatch: 'Forkert substrat',
    unbacked_up_substrate: 'Ikke backup\'et',
  };

  const shown = findings.slice(0, 15);
  const extra = findings.length - shown.length;

  return `
    <section class="mb-12">
      <h2 class="text-lg font-semibold text-ink-900 mb-4">Det jeg fandt</h2>
      <div class="space-y-4">
        ${shown.map(f => {
          const typeLabel = TYPE_LABELS[f.type] || f.type;
          return `
            <article class="border-l-2 border-paper-300 pl-4 py-1">
              <div class="flex items-baseline gap-3 flex-wrap mb-1">
                ${severityBadge(f.severity)}
                <span class="text-xs uppercase tracking-wider text-ink-400">${escapeHtml(typeLabel)}</span>
              </div>
              <h3 class="font-medium text-ink-900 mt-1" style="margin: 0.25rem 0">${escapeHtml(f.title)}</h3>
              ${f.description ? `<p class="text-sm text-ink-700 mt-2 leading-relaxed" style="margin-top: 0.5rem">${escapeHtml(f.description)}</p>` : ''}
              ${f.why ? `<p class="text-sm text-ink-500 italic mt-2 leading-relaxed" style="margin-top: 0.5rem">${escapeHtml(f.why)}</p>` : ''}
              ${f.recommendation ? `<p class="text-sm text-ink-700 mt-2 leading-relaxed" style="margin-top: 0.5rem"><span class="text-ink-500 italic">Fix: </span>${escapeHtml(f.recommendation)}</p>` : ''}
            </article>
          `;
        }).join('')}
      </div>
      ${extra > 0 ? `<p class="text-sm text-ink-500 mt-4 italic">…og ${extra} fund til.</p>` : ''}
    </section>
  `;
}

// ----- Helpers for picking content -----

function pickTopAction(recs: any[]): any | null {
  // Prefer the user-facing critical recommendation (it's a behavior change,
  // not a file-edit — those are easier to "one action" the user onto).
  const criticalUser = recs.find(r => r.priority === 'critical' && (r.audience === 'user' || r.audience === 'both'));
  if (criticalUser) return criticalUser;
  const critical = recs.find(r => r.priority === 'critical');
  if (critical) return critical;
  const recommendedUser = recs.find(r => r.priority === 'recommended' && (r.audience === 'user' || r.audience === 'both'));
  if (recommendedUser) return recommendedUser;
  return recs[0] || null;
}

function pickSmallThings(
  recs: any[],
  toolRecs: any[],
  topAction: any | null,
): Array<{ title: string; summary?: string; benefit?: string }> {
  const out: Array<{ title: string; summary?: string; benefit?: string }> = [];
  const seenTitles = new Set<string>();
  if (topAction?.title) seenTitles.add(topAction.title);

  // 1-2 user-facing recommendations (not the top one)
  for (const r of recs) {
    if (out.length >= 2) break;
    if (!r.title || seenTitles.has(r.title)) continue;
    if (r === topAction) continue;
    if (r.priority === 'critical') continue;
    const f = friendlyLabel(r.title);
    out.push({ title: f.title, summary: f.summary || r.description, benefit: f.benefit });
    seenTitles.add(r.title);
  }

  // 1-2 tool recommendations
  for (const t of toolRecs) {
    if (out.length >= 3) break;
    if (!t.name || seenTitles.has(t.name)) continue;
    const f = friendlyLabel(t.name);
    out.push({ title: f.title, summary: f.summary || t.userFriendlyDescription || t.description, benefit: f.benefit });
    seenTitles.add(t.name);
  }

  return out.slice(0, 3);
}

// ============================================================================
// Forbedringer — recommendations, cleaned of jargon
// ============================================================================

function renderForbedringer(): string {
  const pending = getRecommendations('pending');
  const implemented = getRecommendations('implemented');
  const dismissed = getRecommendations('dismissed');

  const renderList = (items: any[], canDrop: boolean) => {
    if (items.length === 0) return `<p class="text-ink-500 text-sm">Ingen lige nu.</p>`;
    return `
      <ul class="space-y-3">
        ${items.map(r => {
          const f = friendlyLabel(r.title);
          // Fall back to the DB text_snippet when we don't have a curated
          // summary — better than showing just the raw tool name.
          const summary = f.summary || (r.text_snippet ? r.text_snippet.toString() : '');
          const dropForm = canDrop ? `
            <form method="POST" action="/forbedringer/${escapeHtml(r.id)}/dismiss" class="ml-3 shrink-0">
              <button type="submit"
                class="text-xs text-ink-500 hover:text-bad-fg border border-paper-300 hover:border-bad-fg rounded-full px-3 py-1 transition">
                Drop
              </button>
            </form>
          ` : '';
          return `
            <li class="bg-paper-100 border border-paper-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <div class="text-accent-600 mt-1">•</div>
                <div class="flex-1">
                  <div class="font-medium text-ink-900">${escapeHtml(f.title)}</div>
                  ${summary ? `
                    <div class="mt-2">
                      <div class="text-xs uppercase tracking-wider text-ink-300 mb-0.5">Hvad er det?</div>
                      <div class="text-sm text-ink-700 leading-relaxed">${escapeHtml(summary)}</div>
                    </div>
                  ` : ''}
                  ${f.benefit ? `
                    <div class="mt-2">
                      <div class="text-xs uppercase tracking-wider text-ink-300 mb-0.5">Hvad bliver bedre?</div>
                      <div class="text-sm text-ink-700 leading-relaxed">${escapeHtml(f.benefit)}</div>
                    </div>
                  ` : ''}
                  <div class="font-mono text-xs text-ink-300 mt-3">${timeAgo(r.given_at)}</div>
                </div>
                ${dropForm}
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  };

  if (pending.length === 0 && implemented.length === 0) {
    return page('Forslag', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">Ingen forslag endnu</h1>
        <p class="text-ink-500 max-w-md mx-auto">
          Når jeg har lavet min første rapport for dig, samler jeg forslag her — små ting du kan ændre for at få mere ud af din assistent.
        </p>
      </section>
    `, 'forbedringer');
  }

  return page('Forslag', `
    <section>
      <h1 class="text-3xl font-semibold mb-2">Forslag</h1>
      <p class="text-ink-500 mb-8">Små ting du kan prøve. Ingen af dem er livsnødvendige — bare idéer.</p>

      <div class="mb-10">
        <h2 class="text-sm uppercase tracking-wider text-ink-500 mb-3">Venter på dig (${pending.length})</h2>
        ${renderList(pending, true)}
      </div>

      ${implemented.length > 0 ? `
        <div class="mb-10">
          <h2 class="text-sm uppercase tracking-wider text-ink-500 mb-3">Allerede gjort (${implemented.length})</h2>
          ${renderList(implemented, false)}
        </div>
      ` : ''}

      ${dismissed.length > 0 ? `
        <div>
          <h2 class="text-sm uppercase tracking-wider text-ink-500 mb-3">Droppet (${dismissed.length})</h2>
          ${renderList(dismissed, false)}
        </div>
      ` : ''}
    </section>
  `, 'forbedringer');
}

// ============================================================================
// Onboarding in the dashboard — hybrid flow
//
// Why this exists: typing long free-text answers in the Claude Code chat is
// awkward. The browser lets users think, re-read, and pick from suggestions.
// We reuse runOnboard() as the backend — one source of truth for questions,
// parsing, and state transitions.
//
// Flow: GET /onboard starts fresh. POST /onboard accepts the form submission,
// runs one step, and either returns the next question or writes the final
// config + shows the plan.
// ============================================================================

function renderOnboardForm(result: OnboardResult, error?: string): string {
  const totalSteps = 5;
  const stepNo = result.done ? totalSteps : Math.max(1, Math.min(stepNumberFromResult(result), totalSteps));
  const progress = Math.round((stepNo / totalSteps) * 100);

  const teaching = result.teaching
    ? `<div class="prose prose-stone max-w-none text-ink-700 mb-6 leading-relaxed whitespace-pre-wrap">${escapeHtml(result.teaching)}</div>`
    : '';

  const optionsChips = result.options.length > 0
    ? `
      <div class="mb-3 flex flex-wrap gap-2">
        ${result.options.map(opt => `
          <button type="button" onclick="document.getElementById('answer').value = ${JSON.stringify(opt)}; document.getElementById('answer').focus();"
            class="text-sm bg-paper-100 hover:bg-accent-100 border border-paper-300 hover:border-accent-600 rounded-full px-3 py-1 text-ink-700 transition">
            ${escapeHtml(opt)}
          </button>
        `).join('')}
      </div>
      <p class="text-xs text-ink-500 mb-3">Klik et forslag eller skriv dit eget svar.</p>
    `
    : '';

  const errorBlock = error
    ? `<div class="bg-bad-bg border border-bad-fg/30 text-bad-fg rounded-lg px-4 py-3 mb-4 text-sm">${escapeHtml(error)}</div>`
    : '';

  const body = `
    <section class="max-w-xl mx-auto">
      <div class="mb-6">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">Spørgsmål ${stepNo} af ${totalSteps}</div>
        <div class="h-1.5 bg-paper-200 rounded-full overflow-hidden">
          <div class="h-full bg-accent-600 rounded-full transition-all" style="width: ${progress}%"></div>
        </div>
      </div>

      ${teaching}

      ${errorBlock}

      <form method="POST" action="/onboard" class="space-y-4">
        <input type="hidden" name="step" value="${escapeHtml(result.nextStep || 'greet')}">
        <input type="hidden" name="state" value="${escapeHtml(result.state)}">

        <label for="answer" class="block font-medium text-ink-900 text-lg leading-relaxed">
          ${escapeHtml(result.question)}
        </label>

        ${optionsChips}

        <textarea
          id="answer"
          name="answer"
          rows="${result.options.length > 0 ? 2 : 4}"
          class="w-full bg-paper-50 border border-paper-300 focus:border-accent-600 focus:ring-2 focus:ring-accent-100 rounded-lg p-3 text-ink-900 placeholder-ink-300 font-sans resize-y transition"
          placeholder="Skriv dit svar her..."
          autofocus
        ></textarea>

        <div class="flex items-center justify-between pt-2">
          <a href="/" class="text-sm text-ink-500 hover:text-ink-900 transition">Afbryd</a>
          <button type="submit"
            class="bg-accent-600 hover:bg-accent-500 text-white font-medium px-5 py-2 rounded-lg transition">
            Næste →
          </button>
        </div>
      </form>
    </section>
  `;

  return page('Opstart', body, 'oversigt');
}

function stepNumberFromResult(result: OnboardResult): number {
  const map: Record<string, number> = {
    greet: 1, intro: 2, work: 3, data: 4, cadence: 5, plan: 5,
  };
  if (result.nextStep && result.nextStep !== result.step && result.nextStep !== 'plan') {
    return map[result.nextStep] || 1;
  }
  return map[result.step] || 1;
}

function renderOnboardDone(plan: string): string {
  const rendered = renderMarkdown(plan);
  return page('Færdig!', `
    <section>
      <div class="text-center mb-8">
        <div class="text-5xl mb-3">💌</div>
        <h1 class="text-3xl font-semibold mb-2">Færdig — tak!</h1>
        <p class="text-ink-500">Jeg har gemt dine svar. Din plan er klar nedenfor.</p>
      </div>
      <div class="letter-prose bg-paper-100 border border-paper-200 rounded-xl p-6">
        ${rendered}
      </div>
      <div class="mt-8 text-center">
        <a href="/" class="inline-block bg-accent-600 hover:bg-accent-500 text-white font-medium px-5 py-2 rounded-lg transition">
          Gå til forsiden
        </a>
      </div>
    </section>
  `, 'oversigt');
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

  // Onboarding — GET starts fresh, POST advances one step.
  app.get('/onboard', (c) => {
    const result = runOnboard({});
    return c.html(renderOnboardForm(result));
  });

  app.post('/onboard', async (c) => {
    const form = await c.req.formData();
    const step = (form.get('step') || '').toString();
    const state = (form.get('state') || '').toString();
    const answer = (form.get('answer') || '').toString().trim();

    // Empty submission — re-render the same step with a gentle nudge.
    if (!answer) {
      const current = runOnboard({ step, state });
      return c.html(renderOnboardForm(current, 'Skriv dit svar før du går videre.'));
    }

    try {
      const result = runOnboard({ step, answer, state });
      if (result.done && result.plan) {
        // runOnboard's stepPlan already writes the config (via its own
        // writeConfigTemplate). Nothing more to persist here.
        return c.html(renderOnboardDone(result.plan));
      }
      return c.html(renderOnboardForm(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reset = runOnboard({});
      return c.html(renderOnboardForm(reset, `Noget gik galt: ${msg}. Vi starter forfra.`));
    }
  });

  // Drop a recommendation — status → 'dismissed'. POST so browsers don't
  // pre-fetch it, and so CSRF scanners see side-effect intent.
  app.post('/forbedringer/:id/dismiss', async (c) => {
    try {
      updateRecommendationStatus(c.req.param('id'), 'dismissed');
    } catch { /* non-fatal — the redirect still goes through */ }
    return c.redirect('/forbedringer');
  });

  // Health probe — used by other MCP sessions to detect that a Dear User
  // dashboard is already running on this port (avoids duplicate servers).
  app.get('/health', (c) => c.json({ ok: true, product: 'dearuser', version: 1 }));

  return app;
}

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
 * Find-or-start the dashboard. Phase 1: reuse any existing Dear User
 * instance on ports 7700..7710 to keep the URL stable across parallel
 * Claude Code sessions. Phase 2: bind the first free port if none found.
 */
export async function startDashboard(): Promise<string | null> {
  for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
    const port = DEFAULT_PORT + i;
    if (await probeDashboard(port)) {
      console.error(`Dear User dashboard (reusing): http://localhost:${port}`);
      return `http://localhost:${port}`;
    }
  }

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
