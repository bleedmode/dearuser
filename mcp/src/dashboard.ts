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
import { reconcilePendingRecommendations } from './engine/reconcile-recommendations.js';
import { getUserName, getAgentName, getPreferences, updatePreferences } from './engine/user-preferences.js';
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
  collab: 'Samarbejde',
  analyze: 'Samarbejde', // legacy
  health: 'System-sundhed',
  'system-health': 'System-sundhed', // legacy
  audit: 'System-sundhed', // legacy
  security: 'Sikkerhedstjek',
  wrapped: 'Samarbejdet i tal',
  onboard: 'Opstart',
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] || toolName;
}

function toolEmoji(toolName: string): string {
  switch (toolName) {
    case 'collab': return '🔍';
    case 'analyze': return '🔍'; // legacy
    case 'health': return '🩺';
    case 'system-health': return '🩺'; // legacy
    case 'audit': return '🩺'; // legacy
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

function greetingEn(): string {
  const name = getUserName();
  return name ? `Dear ${name}` : 'Dear user';
}

function signature(): string {
  return `<span class="inline-flex items-center gap-2">
    <svg width="22" height="22" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill="#EC5329"/>
      <path class="smile-path" d="M 11 22 Q 20 32 29 22" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    </svg>
    <span class="font-serif italic text-lg tracking-tight">Dear User</span>
  </span>`;
}

// ============================================================================
// HTML shell — cream paper, Geist fonts, Tailwind Play CDN
// ============================================================================

function page(title: string, body: string, activeNav: 'oversigt' | 'kørsler' | 'forbedringer' | 'profil' = 'oversigt'): string {
  return `<!DOCTYPE html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? escapeHtml(title) + ' — Dear User' : 'Dear User'}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='20' fill='%23EC5329'/%3E%3Cpath d='M 11 22 Q 20 32 29 22' stroke='%23FDFBF6' stroke-width='2.5' stroke-linecap='round' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com?plugins=typography"></script>
<script>
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ['Geist', 'system-ui', 'sans-serif'],
          mono: ['Geist Mono', 'ui-monospace', 'monospace'],
          serif: ['Fraunces', 'Georgia', 'serif'],
        },
        colors: {
          paper: {
            50:  'var(--c-paper-50)',
            100: 'var(--c-paper-100)',
            200: 'var(--c-paper-200)',
            300: 'var(--c-paper-300)',
          },
          ink: {
            900: 'var(--c-ink-900)',
            700: 'var(--c-ink-700)',
            500: 'var(--c-ink-500)',
            400: 'var(--c-ink-400)',
            300: 'var(--c-ink-300)',
          },
          accent: {
            600: 'var(--c-accent-600)',
            500: 'var(--c-accent-500)',
            100: 'var(--c-accent-100)',
          },
          action: {
            700: 'var(--c-action-700)',
            600: 'var(--c-action-600)',
            500: 'var(--c-action-500)',
            100: 'var(--c-action-100)',
          },
        },
      },
    },
  };
</script>
<style>
  /* Light theme (default) — cream paper */
  :root {
    --c-paper-50:   #FDFBF6;
    --c-paper-100:  #F8F2E7;
    --c-paper-200:  #EFE4CF;
    --c-paper-300:  #D8C8A9;
    --c-ink-900:    #1F1A14;
    --c-ink-700:    #3E352A;
    --c-ink-500:    #72655B;
    --c-ink-400:    #A69989;
    --c-ink-300:    #AE9F91;
    --c-accent-600: #C3563B;
    --c-accent-500: #D77356;
    --c-accent-100: #F6E3D7;
    --c-action-700: #C93F1B;
    --c-action-600: #EC5329;
    --c-action-500: #F06B43;
    --c-action-100: #FCE5DB;
    --c-smile-fill: #FDFBF6;
  }
  /* Dark theme — warm espresso, not harsh black */
  [data-theme="dark"] {
    --c-paper-50:   #1A1511;
    --c-paper-100:  #261F18;
    --c-paper-200:  #3A2F22;
    --c-paper-300:  #52422F;
    --c-ink-900:    #FFFAED;
    --c-ink-700:    #E5DBC3;
    --c-ink-500:    #A89A85;
    --c-ink-400:    #7E7162;
    --c-ink-300:    #5F5546;
    --c-accent-600: #E8725A;
    --c-accent-500: #F0896F;
    --c-accent-100: #3A241C;
    --c-action-700: #FF8560;
    --c-action-600: #FF7048;
    --c-action-500: #FF8F70;
    --c-action-100: #3D2218;
    --c-smile-fill: #1A1511;
  }
  /* Brighter score colors in dark mode for readability */
  [data-theme="dark"] .text-emerald-700 { color: #34D399; }
  [data-theme="dark"] .bg-emerald-600 { background-color: #34D399; }
  [data-theme="dark"] .text-amber-700 { color: #FBBF24; }
  [data-theme="dark"] .bg-amber-500 { background-color: #FBBF24; }
  [data-theme="dark"] .text-rose-700 { color: #F87171; }
  [data-theme="dark"] .bg-rose-600 { background-color: #F87171; }
  body {
    font-family: 'Geist', system-ui, sans-serif;
    font-feature-settings: 'ss01';
  }
  /* Language toggle — hide the non-active version */
  [data-lang="da"] .lang-en { display: none; }
  [data-lang="en"] .lang-da { display: none; }
  main, header { position: relative; z-index: 1; }
  .letter-prose h1, .letter-prose h2, .letter-prose h3 { font-weight: 600; color: var(--c-ink-900); }
  .letter-prose h1 { font-size: 1.5rem; margin: 1.5rem 0 0.75rem; }
  .letter-prose h2 { font-size: 1.2rem; margin: 1.75rem 0 0.5rem; border-top: 1px solid var(--c-paper-200); padding-top: 1rem; }
  .letter-prose h3 { font-size: 1rem; margin: 1.25rem 0 0.4rem; }
  .letter-prose p { margin: 0.6rem 0; line-height: 1.65; color: var(--c-ink-700); }
  .letter-prose ul, .letter-prose ol { padding-left: 1.4rem; margin: 0.5rem 0; }
  .letter-prose li { margin: 0.25rem 0; line-height: 1.55; color: var(--c-ink-700); }
  .letter-prose strong { color: var(--c-ink-900); }
  .letter-prose code { font-family: 'Geist Mono', monospace; font-size: 0.85em; background: var(--c-paper-100); padding: 0.1em 0.35em; border-radius: 3px; color: var(--c-action-700); }
  .letter-prose pre { background: var(--c-paper-50); border: 1px solid var(--c-paper-200); border-radius: 6px; padding: 1rem; overflow-x: auto; font-size: 0.8rem; line-height: 1.5; }
  .letter-prose pre code { background: none; padding: 0; color: var(--c-ink-700); }
  .letter-prose blockquote { border-left: 3px solid var(--c-accent-600); padding-left: 1rem; color: var(--c-ink-500); margin: 1rem 0; font-style: italic; }
  .letter-prose a { color: var(--c-action-600); text-decoration: underline; text-underline-offset: 2px; }
  .smile-path { stroke: var(--c-smile-fill); }
</style>
</head>
<body class="bg-paper-50 text-ink-900 antialiased min-h-screen">
  <header class="bg-paper-50/90 backdrop-blur sticky top-0 z-10">
    <div class="max-w-2xl mx-auto px-6 py-5 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 text-ink-900 hover:opacity-80 transition">
        <svg width="22" height="22" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="20" cy="20" r="20" fill="#EC5329"/>
          <path class="smile-path" d="M 11 22 Q 20 32 29 22" stroke-width="2.5" stroke-linecap="round" fill="none"/>
        </svg>
        <span class="font-serif italic text-lg tracking-tight">Dear User</span>
      </a>
      <nav class="flex items-center gap-6 text-[11px] uppercase tracking-[0.15em]">
        <a href="/historik" class="${activeNav === 'kørsler' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
          <span class="lang-da">Mine breve</span><span class="lang-en">My letters</span>
        </a>
        <a href="/forbedringer" class="${activeNav === 'forbedringer' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
          <span class="lang-da">Forslag</span><span class="lang-en">Suggestions</span>
        </a>
        <a href="/profil" class="${activeNav === 'profil' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
          <span class="lang-da">Profil</span><span class="lang-en">Profile</span>
        </a>
        <span class="w-px h-4 bg-paper-200"></span>
        <button id="lang-toggle" aria-label="Switch language" class="text-ink-400 hover:text-ink-900 transition">
          <span id="lang-label">EN</span>
        </button>
        <button id="theme-toggle" aria-label="Toggle theme" class="text-ink-400 hover:text-ink-900 transition flex items-center">
          <svg id="sun-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg id="moon-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </nav>
    </div>
  </header>
  <main class="max-w-2xl mx-auto px-6 pt-16 pb-24">
${body}
  </main>
  <script>
    (function() {
      var html = document.documentElement;
      var savedTheme = localStorage.getItem('dearuser-theme');
      var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var theme = savedTheme || (prefersDark ? 'dark' : 'light');
      if (theme === 'dark') html.setAttribute('data-theme', 'dark');

      var savedLang = localStorage.getItem('dearuser-lang');
      var systemDa = (navigator.language || '').toLowerCase().startsWith('da');
      var lang = savedLang || (systemDa ? 'da' : 'en');
      html.setAttribute('data-lang', lang);
      html.setAttribute('lang', lang);

      function updateIcons() {
        var isDark = html.getAttribute('data-theme') === 'dark';
        var sun = document.getElementById('sun-icon');
        var moon = document.getElementById('moon-icon');
        if (sun) sun.style.display = isDark ? 'none' : 'block';
        if (moon) moon.style.display = isDark ? 'block' : 'none';
      }
      function updateLangLabel() {
        var label = document.getElementById('lang-label');
        if (label) label.textContent = html.getAttribute('data-lang') === 'da' ? 'EN' : 'DA';
      }

      document.addEventListener('DOMContentLoaded', function() {
        updateIcons();
        updateLangLabel();

        var themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) themeBtn.addEventListener('click', function() {
          var isDark = html.getAttribute('data-theme') === 'dark';
          if (isDark) { html.removeAttribute('data-theme'); localStorage.setItem('dearuser-theme', 'light'); }
          else { html.setAttribute('data-theme', 'dark'); localStorage.setItem('dearuser-theme', 'dark'); }
          updateIcons();
        });

        var langBtn = document.getElementById('lang-toggle');
        if (langBtn) langBtn.addEventListener('click', function() {
          var current = html.getAttribute('data-lang');
          var next = current === 'da' ? 'en' : 'da';
          html.setAttribute('data-lang', next);
          html.setAttribute('lang', next);
          localStorage.setItem('dearuser-lang', next);
          updateLangLabel();
        });
      });
    })();
  </script>
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
  reconcilePendingRecommendations();
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
    return page('', `
      <section>
        <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-10">
          <span class="lang-da">${escapeHtml(greeting())},</span><span class="lang-en">${escapeHtml(greetingEn())},</span>
        </h1>
        <p class="font-serif text-2xl text-ink-700 leading-snug max-w-xl">
          <span class="lang-da">Jeg har ikke hørt fra dig endnu. Gå tilbage til Claude Code og bed mig om at <span class="italic">lave min første rapport</span> — så sender jeg et brev her til dig.</span>
          <span class="lang-en">I haven't heard from you yet. Go back to Claude Code and ask me to <span class="italic">write my first report</span> — and I'll send a letter back here.</span>
        </p>
      </section>
    `, 'oversigt');
  }

  // Score tile — clickable card with hover state and arrow, but kept airy.
  // Colored status dot signals "needs attention" without being a loud badge.
  const tile = (
    labelDa: string, labelEn: string,
    hintDa: string, hintEn: string,
    score: number | null, reportId?: string,
    toolHintDa?: string, toolHintEn?: string
  ): string => {
    const labelSpan = `<span class="lang-da">${escapeHtml(labelDa)}</span><span class="lang-en">${escapeHtml(labelEn)}</span>`;
    const hintSpan = `<span class="lang-da">${escapeHtml(hintDa)}</span><span class="lang-en">${escapeHtml(hintEn)}</span>`;
    if (score === null) {
      return `
        <div class="rounded-xl p-5 -mx-5 border border-dashed border-paper-200">
          <div class="flex items-center gap-2 mb-4">
            <span class="w-1.5 h-1.5 rounded-full bg-ink-300"></span>
            <span class="text-[11px] uppercase tracking-[0.15em] text-ink-400">${labelSpan}</span>
          </div>
          <div class="font-serif text-5xl text-ink-300 leading-none mb-4">—</div>
          <p class="text-sm text-ink-400 leading-relaxed">
            <span class="lang-da">Bed mig om <span class="italic text-ink-500">${escapeHtml(toolHintDa || labelDa)}</span></span>
            <span class="lang-en">Ask me to <span class="italic text-ink-500">${escapeHtml(toolHintEn || labelEn)}</span></span>
          </p>
        </div>
      `;
    }
    const color = score >= 85 ? 'text-emerald-700' : score >= 70 ? 'text-amber-700' : 'text-rose-700';
    const dot = score >= 85 ? 'bg-emerald-600' : score >= 70 ? 'bg-amber-500' : 'bg-rose-600';
    const href = reportId ? `/r/${escapeHtml(reportId)}` : '#';
    const needsAttention = score < 70;
    return `
      <a href="${href}" class="block rounded-xl p-5 -mx-5 hover:bg-paper-100 transition group">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
            <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">${labelSpan}</span>
          </div>
          ${needsAttention ? `<span class="text-[10px] uppercase tracking-wider bg-action-100 text-action-600 px-1.5 py-0.5 rounded"><span class="lang-da">Tjek</span><span class="lang-en">Check</span></span>` : ''}
        </div>
        <div class="font-serif text-6xl ${color} leading-none mb-4">${score}</div>
        <div class="flex items-center justify-between gap-3">
          <p class="text-sm text-ink-500 leading-relaxed">${hintSpan}</p>
          <span class="text-action-600 text-lg opacity-0 group-hover:opacity-100 transition flex-shrink-0">→</span>
        </div>
      </a>
    `;
  };

  // Natural-language narrative — reads like a letter, not KPI bullets. Built
  // in both Danish and English so the language toggle can swap them in place.
  const buildNarrative = (lang: 'da' | 'en'): string => {
    const strong: Array<{ label: string; score: number }> = [];
    const weak: Array<{ label: string; score: number }> = [];
    const okish: Array<{ label: string; score: number }> = [];
    const labels = lang === 'da'
      ? { samarbejde: 'vores samarbejde', sikkerhed: 'sikkerheden', systemSundhed: 'dit system' }
      : { samarbejde: 'our collaboration', sikkerhed: 'your security', systemSundhed: 'your system' };
    for (const key of ['samarbejde', 'sikkerhed', 'systemSundhed'] as const) {
      const s = scores[key];
      if (s === null) continue;
      const entry = { label: labels[key], score: s };
      if (s >= 85) strong.push(entry);
      else if (s >= 70) okish.push(entry);
      else weak.push(entry);
    }

    if (strong.length === 0 && okish.length === 0 && weak.length === 0) {
      return lang === 'da'
        ? 'Jeg har endnu ikke målt noget for dig. Bed mig om den første rapport, så skriver jeg et brev tilbage.'
        : 'I haven\'t measured anything yet. Ask me for your first report and I\'ll write back.';
    }

    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const sentences: string[] = [];
    if (strong.length > 0) {
      const list = strong.map(s => `${s.label} (${s.score})`).join(lang === 'da' ? ' og ' : ' and ');
      sentences.push(lang === 'da'
        ? (strong.length === 1 ? `${cap(list)} kører godt.` : `${cap(list)} kører begge godt.`)
        : (strong.length === 1 ? `${cap(list)} is in good shape.` : `${cap(list)} are both doing well.`));
    }
    if (okish.length > 0) {
      const list = okish.map(s => `${s.label} (${s.score})`).join(lang === 'da' ? ' og ' : ' and ');
      sentences.push(lang === 'da'
        ? `${cap(list)} er fin, men kunne være bedre.`
        : `${cap(list)} is fine, but could be better.`);
    }
    if (weak.length > 0) {
      const first = weak[0];
      if (weak.length === 1) {
        sentences.push(lang === 'da'
          ? `Men ${first.label} halter lidt — kun ${first.score} ud af 100, og det er værd at kigge på.`
          : `But ${first.label} is struggling — only ${first.score} out of 100, and worth a look.`);
      } else {
        const list = weak.map(w => `${w.label} (${w.score})`).join(lang === 'da' ? ' og ' : ' and ');
        sentences.push(lang === 'da'
          ? `Men ${list} halter — dem skal vi kigge på.`
          : `But ${list} need attention.`);
      }
    }
    if (combinedScore !== null && measured.length > 1) {
      sentences.push(lang === 'da'
        ? `Samlet står vi på ${combinedScore}.`
        : `Combined, we're at ${combinedScore}.`);
    }

    return sentences.join(' ');
  };
  const narrativeDa = buildNarrative('da');
  const narrativeEn = buildNarrative('en');

  const scoreSection = measured.length > 0 ? `
    <section class="mt-20 grid grid-cols-1 md:grid-cols-3 gap-12">
      ${tile(
        'Samarbejde', 'Collaboration',
        'Hvor godt vi arbejder sammen', 'How well we work together',
        scores.samarbejde, latest.analyze?.id,
        'lav en samarbejds-rapport', 'run a collaboration report'
      )}
      ${tile(
        'Sikkerhed', 'Security',
        'Om nogen kan misbruge din kode eller data', 'Whether anyone could misuse your code or data',
        scores.sikkerhed, latest.security?.id,
        'kør sikkerhedstjek', 'run a security check'
      )}
      ${tile(
        'System-sundhed', 'System health',
        'Om dit setup stadig hænger sammen', 'Whether your setup still holds together',
        scores.systemSundhed, latest.systemHealth?.id,
        'kør system-sundhed', 'run system health'
      )}
    </section>
  ` : '';

  const pendingCount = getRecommendations('pending').length;
  const pendingBlock = pending.length > 0 ? `
    <section class="mt-24 pt-10 border-t border-paper-200">
      <h2 class="mb-6 text-[11px] uppercase tracking-[0.15em] text-action-600">
        <span class="lang-da">${pendingCount} forslag venter</span>
        <span class="lang-en">${pendingCount} suggestion${pendingCount === 1 ? '' : 's'} waiting</span>
      </h2>
      <ul class="divide-y divide-paper-200">
        ${pending.map(p => {
          const f = friendlyLabel(p.title);
          return `
            <li class="py-5 flex items-start justify-between gap-6">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
                  <div class="font-serif text-xl text-ink-900 leading-snug">${escapeHtml(f.title)}</div>
                </div>
                ${f.summary ? `<div class="text-sm text-ink-500 leading-relaxed ml-3.5">${escapeHtml(f.summary)}</div>` : ''}
              </div>
              <a href="/forbedringer#${escapeHtml(p.id)}" class="flex-shrink-0 text-sm text-ink-700 hover:text-action-600 transition whitespace-nowrap">
                <span class="lang-da">Læs mere →</span><span class="lang-en">Read more →</span>
              </a>
            </li>
          `;
        }).join('')}
      </ul>
      <a href="/forbedringer" class="inline-block mt-6 text-sm font-medium text-action-600 hover:text-action-600 transition">
        <span class="lang-da">Se alle forslag →</span><span class="lang-en">See all suggestions →</span>
      </a>
    </section>
  ` : '';

  const now = new Date();
  const dateStrDa = now.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateStrEn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const actionStrip = `
    <div class="flex items-center gap-3 mb-12 pb-4 border-b border-paper-200 text-[11px] uppercase tracking-[0.15em]">
      <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
      <span class="text-ink-500">
        <span class="lang-da">${escapeHtml(dateStrDa)}</span><span class="lang-en">${escapeHtml(dateStrEn)}</span>
      </span>
    </div>
  `;

  return page('', `
    ${actionStrip}
    <section>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">
        <span class="lang-da">${escapeHtml(greeting())},</span><span class="lang-en">${escapeHtml(greetingEn())},</span>
      </h1>
      <p class="font-serif text-2xl text-ink-700 leading-snug max-w-xl">
        <span class="lang-da">${escapeHtml(narrativeDa)}</span><span class="lang-en">${escapeHtml(narrativeEn)}</span>
      </p>
    </section>
    ${scoreSection}
    ${pendingBlock}
    ${letterSignature()}
  `, 'oversigt');
}

/**
 * Shared sign-off used at the bottom of every letter-style page. Combines
 * the agent's personal note and the privacy assurance into one human-voiced
 * paragraph — the way a person would actually write it, not two separate
 * footers.
 */
function letterSignature(): string {
  const agent = escapeHtml(getAgentName());
  const user = getUserName();
  const addressedDa = user ? `, ${escapeHtml(user)}` : '';
  const addressedEn = user ? `, ${escapeHtml(user)}` : '';
  return `
    <footer class="mt-24 pt-10 border-t border-paper-200">
      <p class="font-serif text-lg text-ink-700 leading-relaxed max-w-xl mb-6">
        <span class="lang-da">Tak fordi jeg får lov at holde øje med dit setup${addressedDa}. Det her er mellem os to — ingen data rejser ud af din computer.</span>
        <span class="lang-en">Thanks for letting me keep an eye on your setup${addressedEn}. This is just between us — no data leaves your computer.</span>
      </p>
      <p class="font-serif text-base text-ink-500 mb-0.5">
        <span class="lang-da">De bedste hilsner,</span><span class="lang-en">All the best,</span>
      </p>
      <p class="font-serif italic text-base text-ink-700">
        <span class="lang-da">Din agent ${agent}</span><span class="lang-en">Your agent ${agent}</span>
      </p>
    </footer>
  `;
}

// ============================================================================
// Historik — alle kørsler
// ============================================================================

function renderHistorik(): string {
  const runs = getRecentRuns(100).filter((r: any) => r.details && r.details.trim().length > 0);
  const now = new Date();
  const dateStrDa = now.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateStrEn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const actionStrip = `
    <div class="flex items-center gap-3 mb-12 pb-4 border-b border-paper-200 text-[11px] uppercase tracking-[0.15em]">
      <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
      <span class="text-ink-500">
        <span class="lang-da">${escapeHtml(dateStrDa)}</span><span class="lang-en">${escapeHtml(dateStrEn)}</span>
      </span>
    </div>
  `;

  if (runs.length === 0) {
    return page('Mine breve', `
      ${actionStrip}
      <section>
        <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">
          <span class="lang-da">Ingen breve endnu</span><span class="lang-en">No letters yet</span>
        </h1>
        <p class="font-serif text-2xl text-ink-700 leading-snug max-w-xl">
          <span class="lang-da">Åbn Claude Code og bed mig lave den første rapport. Alle mine breve ender her.</span>
          <span class="lang-en">Open Claude Code and ask me to write the first report. All my letters land here.</span>
        </p>
      </section>
      ${letterSignature()}
    `, 'kørsler');
  }

  // Group by relative time bucket so scanning feels natural (today, yesterday,
  // this week, older). Email-client pattern adapted to letters.
  const buckets: Record<string, any[]> = { today: [], yesterday: [], week: [], older: [] };
  const nowTs = Date.now();
  for (const r of runs) {
    const ts = new Date(r.started_at).getTime();
    const hoursAgo = (nowTs - ts) / (1000 * 60 * 60);
    if (hoursAgo < 24) buckets.today.push(r);
    else if (hoursAgo < 48) buckets.yesterday.push(r);
    else if (hoursAgo < 24 * 7) buckets.week.push(r);
    else buckets.older.push(r);
  }

  const bucketLabel: Record<string, { da: string; en: string }> = {
    today: { da: 'I dag', en: 'Today' },
    yesterday: { da: 'I går', en: 'Yesterday' },
    week: { da: 'Denne uge', en: 'This week' },
    older: { da: 'Tidligere', en: 'Earlier' },
  };

  const toolLabelEn: Record<string, string> = {
    collab: 'Collaboration report',
    analyze: 'Collaboration report',
    security: 'Security check',
    health: 'System health',
    'system-health': 'System health',
    audit: 'System health',
  };

  const renderRow = (r: any): string => {
    const subjectDa = toolLabel(r.tool_name);
    const subjectEn = toolLabelEn[r.tool_name] || subjectDa;
    const hasScore = r.score !== null && r.score !== undefined;
    const color = !hasScore ? 'text-ink-300' : r.score >= 85 ? 'text-emerald-700' : r.score >= 70 ? 'text-amber-700' : 'text-rose-700';
    const dot = !hasScore ? 'bg-ink-300' : r.score >= 85 ? 'bg-emerald-600' : r.score >= 70 ? 'bg-amber-500' : 'bg-rose-600';
    return `
      <li>
        <a href="/r/${escapeHtml(r.id)}" class="block py-5 group">
          <div class="flex items-start justify-between gap-6">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
                <h3 class="font-serif text-xl text-ink-900 leading-snug group-hover:text-action-600 transition">
                  <span class="lang-da">${escapeHtml(subjectDa)}</span><span class="lang-en">${escapeHtml(subjectEn)}</span>
                </h3>
              </div>
              ${r.summary ? `<p class="text-sm text-ink-500 leading-relaxed ml-3.5 truncate">${escapeHtml(r.summary)}</p>` : ''}
            </div>
            <div class="flex-shrink-0 flex items-baseline gap-3">
              ${hasScore ? `<span class="font-serif text-3xl ${color} leading-none">${r.score}</span>` : ''}
              <span class="text-action-600 opacity-0 group-hover:opacity-100 transition text-lg">→</span>
            </div>
          </div>
        </a>
      </li>
    `;
  };

  // Featured letter — the most recent one, presented as a rich letter preview
  // with a score-arc (Probe-inspired). Adds visual weight to "my letters" so
  // it doesn't read as just a list.
  const featured = runs[0];
  const featuredSubjectDa = toolLabel(featured.tool_name);
  const featuredSubjectEn = toolLabelEn[featured.tool_name] || featuredSubjectDa;
  const fScore = featured.score;
  const fHasScore = fScore !== null && fScore !== undefined;
  const fColor = !fHasScore ? '#AE9F91' : fScore >= 85 ? '#059669' : fScore >= 70 ? '#B45309' : '#BE123C';
  const fColorClass = !fHasScore ? 'text-ink-300' : fScore >= 85 ? 'text-emerald-700' : fScore >= 70 ? 'text-amber-700' : 'text-rose-700';
  const circumference = 2 * Math.PI * 38;
  const offset = fHasScore ? circumference * (1 - fScore / 100) : circumference;
  const scoreArc = fHasScore ? `
    <div class="flex-shrink-0 relative w-[120px] h-[120px]">
      <svg viewBox="0 0 90 90" class="w-full h-full -rotate-90">
        <circle cx="45" cy="45" r="38" fill="none" stroke="var(--c-paper-200)" stroke-width="5"/>
        <circle cx="45" cy="45" r="38" fill="none" stroke="${fColor}" stroke-width="5" stroke-linecap="round"
                stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
                style="transition: stroke-dashoffset 0.8s ease;"/>
      </svg>
      <div class="absolute inset-0 flex items-center justify-center">
        <span class="font-serif text-4xl ${fColorClass} leading-none">${fScore}</span>
      </div>
    </div>
  ` : '';

  const featuredCard = `
    <a href="/r/${escapeHtml(featured.id)}" class="block mb-16 p-8 rounded-2xl border border-paper-200 bg-paper-100 hover:border-action-600 transition group">
      <div class="flex items-center gap-2 mb-6 text-[11px] uppercase tracking-[0.15em]">
        <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
        <span class="text-ink-500">
          <span class="lang-da">Seneste brev · ${escapeHtml(timeAgo(featured.started_at))}</span>
          <span class="lang-en">Latest letter · ${escapeHtml(timeAgo(featured.started_at))}</span>
        </span>
      </div>
      <div class="flex items-center gap-8">
        ${scoreArc}
        <div class="flex-1 min-w-0">
          <h2 class="font-serif text-3xl text-ink-900 leading-tight mb-2 group-hover:text-action-600 transition">
            <span class="lang-da">${escapeHtml(featuredSubjectDa)}</span><span class="lang-en">${escapeHtml(featuredSubjectEn)}</span>
          </h2>
          ${featured.summary ? `<p class="text-ink-700 leading-relaxed">${escapeHtml(featured.summary)}</p>` : ''}
          <div class="mt-5 text-sm font-medium text-action-600">
            <span class="lang-da">Læs hele brevet →</span><span class="lang-en">Read the full letter →</span>
          </div>
        </div>
      </div>
    </a>
  `;

  // Skip the featured letter in the list below so it doesn't appear twice
  const olderRuns = runs.slice(1);
  const olderBuckets: Record<string, any[]> = { today: [], yesterday: [], week: [], older: [] };
  for (const r of olderRuns) {
    const ts = new Date(r.started_at).getTime();
    const hoursAgo = (nowTs - ts) / (1000 * 60 * 60);
    if (hoursAgo < 24) olderBuckets.today.push(r);
    else if (hoursAgo < 48) olderBuckets.yesterday.push(r);
    else if (hoursAgo < 24 * 7) olderBuckets.week.push(r);
    else olderBuckets.older.push(r);
  }

  const sections = (['today', 'yesterday', 'week', 'older'] as const)
    .filter(k => olderBuckets[k].length > 0)
    .map(k => `
      <section class="mt-10 first:mt-0">
        <h2 class="mb-2 text-[11px] uppercase tracking-[0.15em] text-ink-500">
          <span class="lang-da">${bucketLabel[k].da}</span><span class="lang-en">${bucketLabel[k].en}</span>
        </h2>
        <ul class="divide-y divide-paper-200">
          ${olderBuckets[k].map(renderRow).join('')}
        </ul>
      </section>
    `).join('');

  const archiveHeader = olderRuns.length > 0 ? `
    <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-6">
      <span class="lang-da">Tidligere breve</span><span class="lang-en">Earlier letters</span>
    </h2>
  ` : '';

  return page('Mine breve', `
    ${actionStrip}
    <section>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">
        <span class="lang-da">Mine breve</span><span class="lang-en">My letters</span>
      </h1>
      <p class="font-serif text-2xl text-ink-700 leading-snug max-w-xl">
        <span class="lang-da">Hvert brev jeg har sendt dig — nyeste først.</span>
        <span class="lang-en">Every letter I've sent you — newest first.</span>
      </p>
    </section>
    <div class="mt-16">
      ${featuredCard}
      ${archiveHeader}
      ${sections}
    </div>
    ${letterSignature()}
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
      if (run.tool_name === 'collab' || run.tool_name === 'analyze') return renderAnalyzeLetter(run, parsed);
      if (run.tool_name === 'security') return renderSecurityLetter(run, parsed);
      if (run.tool_name === 'health' || run.tool_name === 'system-health' || run.tool_name === 'audit') {
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
      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">Med venlig hilsen,</p>
        <p class="text-ink-900">${signature()}</p>
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
      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">Med venlig hilsen,</p>
        <p class="text-ink-900">${signature()}</p>
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
      <h2 class="text-2xl font-semibold text-ink-900 mb-3 leading-tight">${escapeHtml(title)}</h2>
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
  // Match the visual pattern used on the home-page tiles and the other
  // letter types: colored bullet + domain label, big font-serif number
  // in the same color. No surrounding card. Verdict lives in the leadIn.
  const scoreColor = typeof score !== 'number'
    ? 'text-ink-300'
    : score >= 85 ? 'text-emerald-700'
    : score >= 70 ? 'text-amber-700'
    : 'text-rose-700';
  const dot = typeof score !== 'number'
    ? 'bg-ink-300'
    : score >= 85 ? 'bg-emerald-600'
    : score >= 70 ? 'bg-amber-500'
    : 'bg-rose-600';

  return `
    <section class="mb-12">
      <div class="mb-8">
        <div class="flex items-center gap-2 mb-4">
          <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
          <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">Samarbejde</span>
        </div>
        <div class="font-serif text-6xl ${scoreColor} leading-none">${typeof score === 'number' ? score : '—'}</div>
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
      <summary class="cursor-pointer list-none hover:bg-paper-50 rounded-lg -mx-2 px-2 py-2 transition">
        <div class="flex items-baseline gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-ink-900">${escapeHtml(explanation.label)}</span>
              <span class="text-accent-600 text-sm transition-transform group-open:rotate-90 inline-block leading-none">▸</span>
              <span class="text-xs text-accent-600 group-open:hidden"><span class="lang-da">Læs mere</span><span class="lang-en">Read more</span></span>
              <span class="text-xs text-ink-400 hidden group-open:inline"><span class="lang-da">Skjul</span><span class="lang-en">Hide</span></span>
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
  // Render as flat brev-prosa — same treatment as the top-action block
  // above. Both are curated recommendations; they should share one visual
  // grammar. Boxes were introduced to match the "Tekniske detaljer"
  // collapsibles, but those are drill-down data containers, not
  // recommendations. Different purpose → different treatment.
  return `
    <section class="mb-12">
      <p class="text-ink-500 italic mb-3">Tre små ting jeg også lagde mærke til:</p>
      <div class="space-y-8">
        ${items.slice(0, 3).map(item => `
          <div>
            <h3 class="text-lg font-semibold text-ink-900 mb-2 leading-tight">${escapeHtml(item.title)}</h3>
            ${item.summary ? `<p class="text-ink-700 leading-relaxed">${escapeHtml(item.summary)}</p>` : ''}
            ${item.benefit ? `
              <details class="mt-3 group">
                <summary class="cursor-pointer text-sm text-accent-600 hover:text-accent-500 list-none inline-flex items-center gap-1.5">
                  <span class="transition-transform group-open:rotate-90">▸</span>
                  <span>Hvad bliver bedre?</span>
                </summary>
                <p class="mt-2 text-sm text-ink-700 leading-relaxed italic">${escapeHtml(item.benefit)}</p>
              </details>
            ` : ''}
          </div>
        `).join('')}
      </div>
      <a href="/forbedringer" class="inline-block mt-6 text-sm text-accent-600 hover:text-accent-500">Se alle forslag →</a>
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
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <section class="mb-10">
        <p class="text-xl text-ink-900 font-medium mb-3" style="margin-bottom: 0.75rem">${escapeHtml(greeting())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${escapeHtml(leadIn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, securityVerdict, ceiling, 'Sikkerhed')}

      ${renderSecurityFindings(allFindings)}

      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">Med venlig hilsen,</p>
        <p class="text-ink-900">${signature()}</p>
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
  // Prose must match the score. User-facing findings = not in a same-suite
  // cluster (those are intentional product overlap, already excluded from
  // the score and from the findings list below). Closure-rate is a raw
  // graph stat — the scorer already turned it into a category score, so
  // repeating the percentage here reads as "something's wrong" when it
  // isn't. Only mention it if there are actual findings to pair it with.
  const userFindingsCount = findings.filter((f: any) => !f.suitePrefix).length;
  const leadIn = userFindingsCount === 0
    ? (typeof score === 'number' && score >= 95
        ? 'Dit setup er rent — værktøjer, schedules og data passer sammen. Der er ikke noget du skal gøre.'
        : 'Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Alt hænger sammen.')
    : `Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Jeg fandt ${userFindingsCount} ${userFindingsCount === 1 ? 'ting' : 'ting'} værd at tage fat på.`;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <header class="mb-10 not-letter">
        <div class="font-mono text-xs text-ink-300">${escapeHtml(formatLetterDate(run.started_at))}</div>
      </header>

      <section class="mb-10">
        <p class="text-xl text-ink-900 font-medium mb-3" style="margin-bottom: 0.75rem">${escapeHtml(greeting())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${escapeHtml(leadIn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, systemHealthVerdict, ceiling, 'System-sundhed')}

      ${renderSystemHealthFindings(sortedFindings)}

      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">Med venlig hilsen,</p>
        <p class="text-ink-900">${signature()}</p>
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
  _verdictFn: (s: number) => string,
  _ceiling: any,
  domainLabel: string = 'Score',
): string {
  // Match the home-page tile treatment: colored bullet + label, big
  // font-serif number in the same color, no surrounding card. Verdict
  // prose lives in the leadIn paragraph under "Kære Jarl" — showing it
  // again in a box is redundant. Ceiling-delta is implicit from the
  // per-category rows below, so we drop it too.
  const scoreColor = typeof score !== 'number'
    ? 'text-ink-300'
    : score >= 85 ? 'text-emerald-700'
    : score >= 70 ? 'text-amber-700'
    : 'text-rose-700';
  const dot = typeof score !== 'number'
    ? 'bg-ink-300'
    : score >= 85 ? 'bg-emerald-600'
    : score >= 70 ? 'bg-amber-500'
    : 'bg-rose-600';

  return `
    <section class="mb-12">
      <div class="mb-8">
        <div class="flex items-center gap-2 mb-4">
          <span class="w-1.5 h-1.5 rounded-full ${dot}"></span>
          <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">${escapeHtml(domainLabel)}</span>
        </div>
        <div class="font-serif text-6xl ${scoreColor} leading-none">${typeof score === 'number' ? score : '—'}</div>
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
            <article class="py-1">
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
        <p class="text-ink-700 leading-relaxed">Ingen ting at rydde op i. Setup\'et hænger sammen.</p>
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

  // Drop same-suite overlap findings from the user's report entirely.
  // The scorer already excludes them from penalty, and they describe
  // intentional product-family overlap the user can't meaningfully act on.
  // The agent still sees them in the JSON payload for context; the letter
  // just doesn't mention them.
  const regularFindings = findings.filter(f => !f.suitePrefix);

  if (regularFindings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed">Ingen ting at rydde op i. Setup\'et hænger sammen.</p>
      </section>
    `;
  }

  const shown = regularFindings.slice(0, 15);
  const extra = regularFindings.length - shown.length;

  return `
    <section class="mb-12">
      <h2 class="text-lg font-semibold text-ink-900 mb-4">Det jeg fandt</h2>
      <div class="space-y-4">
        ${shown.map(f => {
          const typeLabel = TYPE_LABELS[f.type] || f.type;
          return `
            <article class="py-1">
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
  reconcilePendingRecommendations();
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

// ============================================================================
// Profil — user's name, agent's name, detected archetype, preferences.
// Persona doesn't belong on the landing page (it's static once detected) —
// it lives here where you can read what "The System Architect" means and
// update your profile.
// ============================================================================

function renderProfil(): string {
  const prefs = getPreferences();
  const userName = getUserName();
  const agentName = getAgentName();
  const latest = getLatestScoresByTool();
  const analyze: any = latest.analyze;
  let report: any = null;
  if (analyze?.id) {
    try { report = getRunById(analyze.id); } catch { /* ignore */ }
  }
  const persona = report?.persona?.archetypeName || report?.persona?.detected || null;
  const personaBlurb = report?.persona?.archetypeDescription || null;

  const roleLabel: Record<string, string> = {
    coder: 'Udvikler',
    occasional: 'Blander kode og no-code',
    non_coder: 'Ikke-udvikler',
  };
  const cadenceLabel: Record<string, string> = {
    daily: 'Dagligt',
    weekly: 'Ugentligt',
    'on-demand': 'Når der er behov',
    event: 'Ved bestemte begivenheder',
  };
  const audienceLabel: Record<string, string> = {
    self: 'Mig selv',
    team: 'Mit team',
    customers: 'Mine kunder',
  };

  const row = (label: string, value: string | null | undefined, placeholder = 'Ikke sat') => `
    <div class="py-5 grid grid-cols-[180px_1fr] gap-6 border-b border-paper-200">
      <div class="text-[11px] uppercase tracking-[0.15em] text-ink-500 pt-1">${escapeHtml(label)}</div>
      <div class="text-ink-900">${value ? escapeHtml(value) : `<span class="text-ink-300 italic">${placeholder}</span>`}</div>
    </div>
  `;

  const archetypeBlock = persona ? `
    <section class="mt-16">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-4">Din arketype</h2>
      <div class="bg-paper-100 rounded-xl p-6">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
          <span class="text-[11px] uppercase tracking-[0.15em] text-action-600">Baseret på seneste rapport</span>
        </div>
        <h3 class="font-serif italic text-3xl text-ink-900 mb-3">${escapeHtml(persona)}</h3>
        ${personaBlurb ? `<p class="text-ink-700 leading-relaxed max-w-xl">${escapeHtml(personaBlurb)}</p>` : ''}
      </div>
    </section>
  ` : `
    <section class="mt-16">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-4">Din arketype</h2>
      <div class="bg-paper-100 rounded-xl p-6">
        <p class="text-ink-500 leading-relaxed">Jeg har ikke nok til at kende dig endnu. Bed mig om en <span class="italic">samarbejds-rapport</span>, så finder jeg din arketype.</p>
      </div>
    </section>
  `;

  return page('Profil', `
    <section>
      <p class="text-[11px] uppercase tracking-[0.15em] text-ink-400 mb-6">Profil</p>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">Dig og mig</h1>
      <p class="font-serif text-xl text-ink-700 leading-snug max-w-xl">Her er hvad jeg ved om dig, og hvordan vi arbejder sammen. Ret den i din <span class="italic">config.json</span> eller kør onboarding igen.</p>
    </section>

    <section class="mt-14">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-2">Hvem vi er</h2>
      <div>
        ${row('Dit navn', userName)}
        ${row('Mit navn', agentName)}
      </div>
    </section>

    ${archetypeBlock}

    <section class="mt-16">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-2">Hvordan du arbejder</h2>
      <div>
        ${row('Rolle', prefs.role ? roleLabel[prefs.role] : null)}
        ${row('Kadence', prefs.cadence ? cadenceLabel[prefs.cadence] : null)}
        ${row('Arbejder for', prefs.audience ? audienceLabel[prefs.audience] : null)}
        ${row('Stack', prefs.stack && prefs.stack.length > 0 ? prefs.stack.join(', ') : null)}
      </div>
    </section>

    ${letterSignature()}
  `, 'profil');
}

export function createApp(): Hono {
  const app = new Hono();

  app.get('/', (c) => c.html(renderLanding()));
  app.get('/historik', (c) => c.html(renderHistorik()));
  app.get('/forbedringer', (c) => c.html(renderForbedringer()));
  app.get('/profil', (c) => c.html(renderProfil()));
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
