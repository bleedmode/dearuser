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
import { getRecentRuns, getRunById, getScoreHistory, getRecommendations } from './engine/db.js';
import { getUserName } from './engine/user-preferences.js';

const DEFAULT_PORT = 7700;
const MAX_PORT_ATTEMPTS = 10;

// ============================================================================
// Tool-name labels — friendly Danish for the Lovable audience
// ============================================================================

const TOOL_LABELS: Record<string, string> = {
  analyze: 'Din samarbejds-rapport',
  audit: 'Systemtjek',
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
    case 'audit': return '🩺';
    case 'security': return '🔒';
    case 'wrapped': return '🎁';
    case 'onboard': return '👋';
    default: return '📄';
  }
}

// ============================================================================
// Recommendation title rewriter — hide developer jargon
//
// Analyze writes recommendation titles like "Enable Agent Memory" or
// "Wrap pvs.sh in an MCP server". Rewrite the common ones to plain Danish.
// Unknown titles pass through unchanged rather than being mangled.
// ============================================================================

const RECOMMENDATION_REWRITES: Array<{ match: RegExp; title: string; hint?: string }> = [
  { match: /enable agent memory/i, title: 'Lad din assistent huske dine rettelser', hint: 'Så den ikke glemmer hvad du har lært den, hver gang I starter forfra.' },
  { match: /add quality hooks/i, title: 'Fang fejl automatisk mens du arbejder', hint: 'Dit system kan køre en hurtig tjekker hver gang en fil ændres — så du opdager problemer med det samme.' },
  { match: /wrap .+ in an mcp server/i, title: 'Gør dit script til et værktøj din assistent kan bruge', hint: 'Så assistenten kan kalde det direkte i stedet for at du skal køre det manuelt.' },
  { match: /catch scope creep/i, title: 'Stop med at lave mere end aftalt', hint: 'Nævn det når assistenten begynder at lave ekstra ting udover det du bad om.' },
  { match: /don.?t accept .it should work|demand verification/i, title: 'Bed altid om bevis for at det virker', hint: 'I stedet for at stole på "det burde virke": bed om et konkret tjek.' },
  { match: /calibrate the ask\/do line/i, title: 'Aftal hvornår assistenten må handle selv', hint: 'Skriv det ned — så du ikke skal forklare det forfra hver gang.' },
  { match: /name the tone mismatch/i, title: 'Sig til når tonen ikke passer', hint: 'Hvis svaret føles for teknisk eller for fladt, sig det — den tilpasser sig.' },
  { match: /upgrade repeating manual tasks/i, title: 'Automatiser de ting du laver igen og igen', hint: 'Det du gentager manuelt hver uge kan som regel køre af sig selv.' },
  { match: /^\d+ project.*uncommitted/i, title: 'Du har ting der ikke er gemt i Git', hint: 'Hvis din computer crasher nu, mister du arbejdet.' },
  { match: /stale project.*haven.?t been touched/i, title: 'Et projekt ligger og samler støv', hint: 'Overvej om det skal genoptages eller arkiveres.' },
  { match: /show repeated .fix again. commits/i, title: 'Du fixer det samme flere gange', hint: 'Typisk et tegn på at noget er uklart — enten koden eller instruktionen til assistenten.' },
];

function friendlyRec(title: string): { title: string; hint?: string } {
  for (const rule of RECOMMENDATION_REWRITES) {
    if (rule.match.test(title)) return { title: rule.title, hint: rule.hint };
  }
  // Unknown titles: pass through, but strip markdown-like backticks
  return { title: title.replace(/`/g, '') };
}

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

function renderLanding(): string {
  const recent = getRecentRuns(5);
  const scoreHistory = getScoreHistory(30);
  const latestScore = scoreHistory.length > 0 ? scoreHistory[scoreHistory.length - 1] : null;
  const pending = getRecommendations('pending').slice(0, 3);

  const hasContent = recent.length > 0 || pending.length > 0 || latestScore;

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

  const scoreBlock = latestScore ? `
    <div class="bg-paper-100 border border-paper-200 rounded-xl p-6 flex items-baseline gap-6">
      <div>
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">Din score</div>
        <div class="font-mono text-5xl font-medium text-ink-900 leading-none">${latestScore.score}<span class="text-xl text-ink-300">/100</span></div>
      </div>
      ${latestScore.persona ? `
        <div class="flex-1 text-right">
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">Din stil</div>
          <div class="text-lg text-ink-700">${escapeHtml(latestScore.persona)}</div>
        </div>
      ` : ''}
    </div>
  ` : '';

  const latestRun = recent[0];
  const latestBlock = latestRun ? `
    <div class="mt-8">
      <h2 class="text-xs uppercase tracking-wider text-ink-500 mb-2">Seneste brev</h2>
      <a href="/r/${escapeHtml(latestRun.id)}" class="block bg-paper-100 border border-paper-200 rounded-xl p-6 hover:border-accent-600 transition group">
        <div class="flex items-start gap-4">
          <div class="text-2xl">${toolEmoji(latestRun.tool_name)}</div>
          <div class="flex-1">
            <div class="font-medium text-ink-900 group-hover:text-accent-600 transition">${escapeHtml(toolLabel(latestRun.tool_name))}</div>
            <div class="text-sm text-ink-500 mt-0.5">${timeAgo(latestRun.started_at)}</div>
            ${latestRun.summary ? `<p class="text-sm text-ink-700 mt-2 line-clamp-2">${escapeHtml(latestRun.summary)}</p>` : ''}
          </div>
          <div class="text-ink-300 group-hover:text-accent-600 transition">→</div>
        </div>
      </a>
    </div>
  ` : '';

  const pendingBlock = pending.length > 0 ? `
    <div class="mt-10">
      <h2 class="text-xs uppercase tracking-wider text-ink-500 mb-3">Forslag der venter på dig</h2>
      <ul class="space-y-2">
        ${pending.map(p => {
          const f = friendlyRec(p.title);
          return `
            <li class="bg-paper-50 border border-paper-200 rounded-lg px-4 py-3">
              <div class="font-medium text-ink-900">${escapeHtml(f.title)}</div>
              ${f.hint ? `<div class="text-sm text-ink-500 mt-0.5">${escapeHtml(f.hint)}</div>` : ''}
            </li>
          `;
        }).join('')}
      </ul>
      ${pending.length > 0 ? `<a href="/forbedringer" class="inline-block mt-3 text-sm text-accent-600 hover:text-accent-500 transition">Se alle forslag →</a>` : ''}
    </div>
  ` : '';

  return page('Forside', `
    <section>
      <h1 class="text-3xl font-semibold mb-2">${escapeHtml(greeting())},</h1>
      <p class="text-ink-500">Her er det vi ved om dit samarbejde med din AI-assistent.</p>
    </section>
    <section class="mt-8">
      ${scoreBlock}
      ${latestBlock}
      ${pendingBlock}
    </section>
  `, 'oversigt');
}

// ============================================================================
// Historik — alle kørsler
// ============================================================================

function renderHistorik(): string {
  const runs = getRecentRuns(100);

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

  const body = run.details || run.summary || '_(Brevet indeholder ingen tekst.)_';
  const rendered = renderMarkdown(body);

  return page(`${toolLabel(run.tool_name)}`, `
    <article>
      <header class="mb-8">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">${escapeHtml(toolLabel(run.tool_name))}</div>
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <p class="text-xl text-ink-900 font-medium mb-1">${escapeHtml(greeting())},</p>
      <p class="text-ink-500 mb-8 leading-relaxed">
        Her er det jeg fandt da jeg kiggede på dit setup. ${run.score !== null ? `Din score er <strong class="font-mono text-ink-900">${run.score}/100</strong>.` : ''}
      </p>

      <div class="letter-prose">
        ${rendered}
      </div>

      <footer class="mt-12 pt-6 border-t border-paper-200">
        <p class="text-ink-500 italic">Med venlig hilsen,</p>
        <p class="text-ink-900 font-medium mt-1">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">← Se alle mine breve</a>
    </div>
  `, 'oversigt');
}

// ============================================================================
// Forbedringer — recommendations, cleaned of jargon
// ============================================================================

function renderForbedringer(): string {
  const pending = getRecommendations('pending');
  const implemented = getRecommendations('implemented');

  const renderList = (items: any[]) => {
    if (items.length === 0) return `<p class="text-ink-500 text-sm">Ingen lige nu.</p>`;
    return `
      <ul class="space-y-3">
        ${items.map(r => {
          const f = friendlyRec(r.title);
          return `
            <li class="bg-paper-100 border border-paper-200 rounded-lg p-4">
              <div class="flex items-start gap-3">
                <div class="text-accent-600 mt-1">•</div>
                <div class="flex-1">
                  <div class="font-medium text-ink-900">${escapeHtml(f.title)}</div>
                  ${f.hint ? `<div class="text-sm text-ink-500 mt-1 leading-relaxed">${escapeHtml(f.hint)}</div>` : ''}
                  <div class="font-mono text-xs text-ink-300 mt-2">${timeAgo(r.given_at)}</div>
                </div>
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
        ${renderList(pending)}
      </div>

      ${implemented.length > 0 ? `
        <div>
          <h2 class="text-sm uppercase tracking-wider text-ink-500 mb-3">Allerede gjort (${implemented.length})</h2>
          ${renderList(implemented)}
        </div>
      ` : ''}
    </section>
  `, 'forbedringer');
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
