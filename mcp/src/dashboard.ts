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
import { getFindingByHash } from './engine/findings-ledger.js';
import { getUserName, getPreferences, updatePreferences } from './engine/user-preferences.js';
import { detectUserArchetype, getUserArchetypeDefinition } from './engine/user-archetype-detector.js';
import { mapPersonaToAgentArchetype } from './engine/agent-archetype-map.js';
import { renderArchetypePair, ARCHETYPE_PAIR_CSS } from '../../web/src/lib/archetype-pair.ts';
import { friendlyLabel } from './engine/friendly-labels.js';
import type { LocalizedString } from './engine/friendly-labels.js';
import { renderWrappedSlides } from '../../web/src/lib/wrapped-slides.ts';
import { CATEGORY_EXPLANATIONS, overallVerdict, securityVerdict, systemHealthVerdict } from './engine/category-explanations.js';
import { runOnboard } from './tools/onboard.js';
import type { OnboardResult } from './tools/onboard.js';
import { runShareReport } from './tools/share.js';

const DEFAULT_PORT = 7700;
const MAX_PORT_ATTEMPTS = 10;

// ============================================================================
// Tool-name labels — friendly Danish for the Lovable audience
// ============================================================================

const TOOL_LABELS: Record<string, { da: string; en: string }> = {
  collab: { da: 'Samarbejde', en: 'Collaboration' },
  analyze: { da: 'Samarbejde', en: 'Collaboration' }, // legacy
  health: { da: 'System-sundhed', en: 'System health' },
  'system-health': { da: 'System-sundhed', en: 'System health' }, // legacy
  audit: { da: 'System-sundhed', en: 'System health' }, // legacy
  security: { da: 'Sikkerhedstjek', en: 'Security check' },
  wrapped: { da: 'Samarbejdet i tal', en: 'Collaboration in numbers' },
  onboard: { da: 'Opstart', en: 'Onboarding' },
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName]?.da || toolName;
}

function toolLabelEn(toolName: string): string {
  return TOOL_LABELS[toolName]?.en || toolName;
}

function toolLabelBi(toolName: string): { da: string; en: string } {
  return TOOL_LABELS[toolName] || { da: toolName, en: toolName };
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

function timeAgoEn(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

function formatLetterDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLetterDateEn(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================================================
// Greeting — "Kære &lt;name&gt;" when we know the name, else "Kære bruger"
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

/**
 * Profile link — lives in the utility cluster next to lang/theme toggles,
 * not in the primary text nav. A generic person icon rather than a user
 * initial, because the profile page is "You and me" (user + agent), not
 * a self-portrait of just the user.
 */
function renderProfileAvatar(activeNav: string): string {
  const active = activeNav === 'profil';
  return `<a href="/profil" aria-label="Profile"
    class="inline-flex items-center justify-center w-6 h-6 rounded-full ${active ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    </a>`;
}

function page(title: string, body: string, activeNav: 'oversigt' | 'kørsler' | 'forbedringer' | 'profil' | 'wrapped' = 'oversigt'): string {
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
  /* Score colors — fixed palette across light/dark modes.
     html prefix bumps specificity above Tailwind Play CDN's runtime-injected
     utilities (which are plain .class selectors); without this the CDN wins. */
  html .text-emerald-700 { color: #059669; }
  html .bg-emerald-600 { background-color: #059669; }
  html .text-amber-700 { color: #FBBF24; }
  html .bg-amber-500 { background-color: #FBBF24; }
  html .text-rose-700 { color: #BE123C; }
  html .bg-rose-600 { background-color: #BE123C; }
  html[data-theme="dark"] .text-emerald-700 { color: #34D399; }
  html[data-theme="dark"] .bg-emerald-600 { background-color: #34D399; }
  html[data-theme="dark"] .text-amber-700 { color: #FBBF24; }
  html[data-theme="dark"] .bg-amber-500 { background-color: #FBBF24; }
  html[data-theme="dark"] .text-rose-700 { color: #F87171; }
  html[data-theme="dark"] .bg-rose-600 { background-color: #F87171; }
  body {
    font-family: 'Geist', system-ui, sans-serif;
    font-feature-settings: 'ss01';
  }
  /* Language toggle — hide the non-active version */
  [data-lang="da"] .lang-en { display: none; }
  [data-lang="en"] .lang-da { display: none; }
  main, header { position: relative; z-index: 1; }
  .letter-prose h1, .letter-prose h2, .letter-prose h3 { font-family: var(--font-serif, Georgia, 'Times New Roman', serif); font-weight: 500; color: var(--c-ink-900); letter-spacing: -0.01em; }
  .letter-prose h1 { font-size: 1.75rem; margin: 1.5rem 0 0.75rem; line-height: 1.25; }
  .letter-prose h2 { font-size: 1.4rem; margin: 1.75rem 0 0.5rem; line-height: 1.3; }
  .letter-prose h3 { font-size: 1.15rem; margin: 1.25rem 0 0.4rem; line-height: 1.35; }
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
  ${ARCHETYPE_PAIR_CSS}
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
          <span class="lang-da">Breve</span><span class="lang-en">Letters</span>
        </a>
        <a href="/forbedringer" class="${activeNav === 'forbedringer' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
          <span class="lang-da">Anbefalinger</span><span class="lang-en">Recommendations</span>
        </a>
        <a href="/wrapped" class="${activeNav === 'wrapped' ? 'text-ink-900' : 'text-ink-400 hover:text-ink-900'} transition">
          <span class="lang-da">Wrapped</span><span class="lang-en">Wrapped</span>
        </a>
        <span class="w-px h-4 bg-paper-200"></span>
        <button id="lang-toggle" aria-label="Switch language" class="text-ink-400 hover:text-ink-900 transition">
          <span id="lang-label">EN</span>
        </button>
        <button id="theme-toggle" aria-label="Toggle theme" class="text-ink-400 hover:text-ink-900 transition flex items-center">
          <svg id="sun-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg id="moon-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
        ${renderProfileAvatar(activeNav)}
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

// Bilingual helper — emits both language variants; CSS hides the inactive one.
// Inputs are HTML-escaped before rendering, so callers pass plain text.
function t(da: string, en: string): string {
  return `<span class="lang-da">${escapeHtml(da)}</span><span class="lang-en">${escapeHtml(en)}</span>`;
}

// Same as `t()` but for callers that want to embed pre-escaped/HTML content.
function tHtml(da: string, en: string): string {
  return `<span class="lang-da">${da}</span><span class="lang-en">${en}</span>`;
}

// Coerce a string-or-LocalizedString into bilingual form. Strings become
// `{da: v, en: v}` which is fine for identifiers and user-submitted text.
function asBi(v: string | LocalizedString | null | undefined): LocalizedString | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string') return { da: v, en: v };
  return v;
}

// Emit a bilingual HTML span from a string-or-LocalizedString.
function tBi(v: string | LocalizedString | null | undefined): string {
  const bi = asBi(v);
  return bi ? t(bi.da, bi.en) : '';
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
 * one combined headline number, keeping the "Kære &lt;name&gt;" letter tone in the
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
                <div class="font-serif text-xl text-ink-900 leading-snug mb-1 pl-3.5 -indent-3.5">
                  <span class="inline-block w-1.5 h-1.5 rounded-full bg-action-600 align-middle relative top-[-0.18em] mr-2"></span>${t(f.title.da, f.title.en)}
                </div>
                ${f.summary ? `<div class="text-sm text-ink-500 leading-relaxed ml-3.5">${t(f.summary.da, f.summary.en)}</div>` : ''}
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
  const user = getUserName();
  const addressedDa = user ? `, ${escapeHtml(user)}` : '';
  const addressedEn = user ? `, ${escapeHtml(user)}` : '';
  return `
    <footer class="mt-24">
      <p class="font-serif text-lg text-ink-700 leading-relaxed max-w-xl mb-8">
        <span class="lang-da">Tak fordi jeg får lov at holde øje med dit setup${addressedDa}. Det her er mellem os to — ingen data rejser ud af din computer.</span>
        <span class="lang-en">Thanks for letting me keep an eye on your setup${addressedEn}. This is just between us — no data leaves your computer.</span>
      </p>
      <p class="text-ink-700 italic mb-3">
        <span class="lang-da">Med venlig hilsen,</span><span class="lang-en">Yours,</span>
      </p>
      <p class="text-ink-900">${signature()}</p>
    </footer>
  `;
}

// ============================================================================
// Historik — alle kørsler
// ============================================================================

/**
 * Dated header strip used at the top of every list-page (Mine breve,
 * Forslag, Profil). Orange bullet + today's date, separator rule. Ties
 * the three pages together as one brev-collection.
 */
function pageDateStrip(): string {
  const now = new Date();
  const dateStrDa = now.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
  const dateStrEn = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `
    <div class="flex items-center gap-3 mb-12 pb-4 border-b border-paper-200 text-[11px] uppercase tracking-[0.15em]">
      <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
      <span class="text-ink-500">
        <span class="lang-da">${escapeHtml(dateStrDa)}</span><span class="lang-en">${escapeHtml(dateStrEn)}</span>
      </span>
    </div>
  `;
}

function renderHistorik(): string {
  // Wrapped is its own nav-level feature (see /wrapped), not a diagnostic
  // letter like collab/security/health. Filter it out of the Letters list.
  const runs = getRecentRuns(100).filter((r: any) =>
    r.details && r.details.trim().length > 0 && r.tool_name !== 'wrapped'
  );
  const actionStrip = pageDateStrip();

  if (runs.length === 0) {
    return page('My letters', `
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
  const fColor = !fHasScore ? '#AE9F91' : fScore >= 85 ? '#059669' : fScore >= 70 ? '#FBBF24' : '#BE123C';
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
    <div class="relative mb-16">
      <div aria-hidden="true" class="absolute inset-0 translate-x-3 translate-y-6 rotate-2 rounded-2xl border border-paper-200 bg-paper-50 shadow-sm"></div>
      <a href="/r/${escapeHtml(featured.id)}" class="relative block px-8 py-12 rounded-2xl border border-paper-200 bg-paper-100 shadow-md hover:border-action-600 hover:shadow-lg transition group">
      <div class="flex items-center gap-2 pb-6 mb-8 border-b border-dashed border-paper-300 text-[11px] uppercase tracking-[0.15em]">
        <span class="w-1.5 h-1.5 rounded-full bg-action-600"></span>
        <span class="text-ink-500">
          <span class="lang-da">Seneste brev · ${escapeHtml(timeAgo(featured.started_at))}</span>
          <span class="lang-en">Latest letter · ${escapeHtml(timeAgoEn(featured.started_at))}</span>
        </span>
      </div>
      <div class="flex items-center gap-8">
        ${scoreArc}
        <div class="flex-1 min-w-0">
          <h2 class="font-serif text-3xl text-ink-900 leading-tight mb-2 group-hover:text-action-600 transition">
            <span class="lang-da">${escapeHtml(featuredSubjectDa)}</span><span class="lang-en">${escapeHtml(featuredSubjectEn)}</span>
          </h2>
          <div class="mt-5 text-sm font-medium text-action-600">
            <span class="lang-da">Læs hele brevet →</span><span class="lang-en">Read the full letter →</span>
          </div>
        </div>
      </div>
    </a>
    </div>
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

  return page('Letters', `
    ${actionStrip}
    <section>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">
        <span class="lang-da">Breve</span><span class="lang-en">Letters</span>
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
    return page('Report not found', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">${t('Det her brev findes ikke', "This letter doesn't exist")}</h1>
        <p class="text-ink-500 mb-6">${t('Måske blev det slettet, eller linket er forkert.', 'It may have been deleted, or the link is wrong.')}</p>
        <a href="/" class="text-accent-600 hover:text-accent-500 transition">${t('Gå tilbage til forsiden', 'Go back to the home page')}</a>
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
      if (run.tool_name === 'wrapped') return renderWrappedLetter(run, parsed);
    } catch { /* fall through to markdown */ }
  }
  return renderMarkdownFallback(run);
}

// Shared "Share publicly" button + inline script for all three letters
// (collab / security / health). Identical to the Wrapped share button in
// look, feel, and failure modes — just points at /r/:id/share so the
// endpoint can pick the right report_type from the run's tool_name. One
// button per page, so the DOM ids are unambiguous without a suffix.
//
// Split in two so the button can sit in the letter header (top-right next
// to the date, matching Wrapped) while the script goes at the end of the
// page. Keep the shared label strings in one place — renderLetterShareScript
// is the only caller that reads them at runtime.
const LETTER_SHARE_LABELS = {
  idleDa: 'Del offentligt',
  idleEn: 'Share publicly',
  loadingDa: 'Genererer link…',
  loadingEn: 'Generating link…',
  copiedDa: 'Link kopieret til udklipsholder',
  copiedEn: 'Link copied to clipboard',
  openDa: 'Åbner i ny fane',
  openEn: 'Opening in new tab',
  errorConfigDa: 'Offentlig deling er ikke sat op på denne maskine. Sæt DEARUSER_SUPABASE_URL og DEARUSER_SUPABASE_SERVICE_KEY for at aktivere.',
  errorConfigEn: 'Public sharing is not set up on this machine. Set DEARUSER_SUPABASE_URL and DEARUSER_SUPABASE_SERVICE_KEY to enable it.',
  errorGenericDa: 'Kunne ikke oprette link',
  errorGenericEn: 'Could not create link',
};

function renderLetterShareControls(): string {
  const L = LETTER_SHARE_LABELS;
  return `
    <div class="flex flex-col items-end gap-2">
      <button id="share-letter-btn" data-state="idle" class="text-[11px] uppercase tracking-[0.15em] text-ink-500 hover:text-accent-600 transition border border-paper-200 rounded-md px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
        <span class="lang-da">${L.idleDa}</span><span class="lang-en">${L.idleEn}</span>
      </button>
      <div id="share-letter-feedback" class="text-[11px] text-ink-500 max-w-xs text-right hidden"></div>
    </div>
  `;
}

function renderLetterShareScript(runId: string): string {
  const endpoint = `/r/${encodeURIComponent(runId)}/share`;
  return `
    <script>
      (function() {
        var btn = document.getElementById('share-letter-btn');
        var feedback = document.getElementById('share-letter-feedback');
        if (!btn) return;
        var L = ${JSON.stringify(LETTER_SHARE_LABELS)};
        var endpoint = ${JSON.stringify(endpoint)};

        function setBtnLabel(da, en) {
          btn.innerHTML =
            '<span class="lang-da">' + da + '</span>' +
            '<span class="lang-en">' + en + '</span>';
        }
        function showFeedback(da, en, isError) {
          feedback.classList.remove('hidden');
          feedback.innerHTML =
            '<span class="lang-da">' + da + '</span>' +
            '<span class="lang-en">' + en + '</span>';
          feedback.className = 'text-[11px] max-w-xs text-right ' + (isError ? 'text-red-600' : 'text-ink-500');
        }
        function hideFeedback() {
          feedback.classList.add('hidden');
          feedback.innerHTML = '';
        }

        btn.addEventListener('click', async function() {
          if (btn.disabled) return;
          btn.disabled = true;
          hideFeedback();
          setBtnLabel(L.loadingDa, L.loadingEn);

          try {
            var res = await fetch(endpoint, { method: 'POST' });
            var data = null;
            try { data = await res.json(); } catch (_) {}

            if (!res.ok || !data || !data.url) {
              var msgDa = (data && data.errorDa) || L.errorGenericDa;
              var msgEn = (data && data.errorEn) || L.errorGenericEn;
              showFeedback(msgDa, msgEn, true);
              setBtnLabel(L.idleDa, L.idleEn);
              btn.disabled = false;
              return;
            }

            var url = data.url;
            window.open(url, '_blank', 'noopener,noreferrer');
            var copied = false;
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
                copied = true;
              }
            } catch (_) { /* non-fatal */ }

            showFeedback(
              (copied ? L.copiedDa : L.openDa) + ': ' + url,
              (copied ? L.copiedEn : L.openEn) + ': ' + url,
              false
            );
            setBtnLabel(L.idleDa, L.idleEn);
            btn.disabled = false;
          } catch (err) {
            showFeedback(L.errorGenericDa, L.errorGenericEn, true);
            setBtnLabel(L.idleDa, L.idleEn);
            btn.disabled = false;
          }
        });
      })();
    </script>
  `;
}

function stripAgentOnlyNoise(body: string): string {
  return body
    // "Hvad vil du gøre nu?" menu — agent-only chat flow
    .replace(/\n*---\n*## Hvad vil du gøre nu\?[\s\S]*?(?=\n---|\s*$)/m, '')
    // [AGENT INSTRUCTION: ...] blocks — directives to the agent, not the user
    .replace(/\[AGENT INSTRUCTION:[\s\S]*?\]\s*/g, '')
    // Trailing whitespace after strip
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderWrappedLetter(run: any, report: any): string {
  // Wrapped is its own top-level page — deep links to individual wrapped
  // runs just forward to the canonical /wrapped page (which always shows
  // the latest). No letter chrome.
  return page('Wrapped', `
    <meta http-equiv="refresh" content="0;url=/wrapped">
    <p class="text-ink-500 text-sm">Redirecting to <a href="/wrapped" class="text-accent-600">Wrapped</a>…</p>
  `, 'wrapped');
}

function renderMarkdownFallback(run: any): string {
  const body = run.details || run.summary || '_(Brevet indeholder ingen tekst.)_';
  const stripped = stripAgentOnlyNoise(body);
  const rendered = renderMarkdown(stripped);
  return page(`${toolLabelEn(run.tool_name)}`, `
    <article class="max-w-2xl mx-auto">
      <header class="mb-8">
        <div class="text-xs uppercase tracking-wider text-ink-500 mb-2">${tBi(toolLabelBi(run.tool_name))}</div>
        <div class="font-mono text-xs text-ink-300">${t(formatLetterDate(run.started_at), formatLetterDateEn(run.started_at))}</div>
      </header>
      <p class="font-serif text-2xl text-ink-900 mb-1">${t(greeting(), greetingEn())},</p>
      <p class="text-ink-500 mb-8 leading-relaxed">${t('Her er hvad jeg fandt.', 'Here is what I found.')}</p>
      <div class="letter-prose">${rendered}</div>
      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">${t('Med venlig hilsen,', 'Yours,')}</p>
        <p class="text-ink-900">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">${t('← Se alle mine breve', '← See all letters')}</a>
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

  // Two archetypes — profile-style pair card, same layout everywhere.
  // User archetype from onboarding answers; agent archetype mapped from
  // persona-detector onto the agent-side taxonomy.
  //
  // Fallback: if the stored report predates userArchetype (old report_json),
  // run the detector live against current preferences. Profile page does the
  // same — keeps old letters consistent with new profile without a backfill.
  const userArch: any = report.userArchetype || detectUserArchetype(getPreferences());
  const agentPersona: any = report.persona || null;
  const mappedAgent = agentPersona?.detected
    ? mapPersonaToAgentArchetype(agentPersona.detected)
    : null;
  const agentRunnerUpName = agentPersona?.runnerUp && mappedAgent
    ? (() => {
        const ru = mapPersonaToAgentArchetype(agentPersona.runnerUp);
        return ru.id !== mappedAgent.id ? ru.name : null;
      })()
    : null;
  const userRunnerUpName = userArch?.runnerUp
    ? getUserArchetypeDefinition(userArch.runnerUp).name
    : null;
  const archetypeBlock = renderArchetypePair({
    you: {
      name: userArch?.archetypeName || null,
      description: userArch?.archetypeDescription || null,
      runnerUpName: userRunnerUpName,
      sourceLabel: { da: 'Fra dine svar', en: 'From your answers' },
      emptyState: {
        da: 'Vi har ikke nok fra onboarding endnu.',
        en: "I don't have enough from onboarding yet.",
      },
    },
    me: {
      name: mappedAgent?.name || null,
      description: mappedAgent?.description || null,
      runnerUpName: agentRunnerUpName,
      sourceLabel: { da: 'Fra denne rapport', en: 'From this report' },
      emptyState: {
        da: 'Jeg er stadig lærende.',
        en: 'I am still learning.',
      },
    },
  }).html;

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

  // Collab suggestions and strengths are rendered by renderWhatISaw
  // (strengths only) and renderCollabSuggestions (risks + patterns +
  // topAction + smallThings). Both use the same row layout; the latter
  // adds a "Try this" action line.

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <!-- Header -->
      <header class="mb-10 not-letter flex items-start justify-between gap-4">
        <div class="font-mono text-xs text-ink-300 pt-2">${t(formatLetterDate(run.started_at), formatLetterDateEn(run.started_at))}</div>
        ${renderLetterShareControls()}
      </header>

      <!-- Greeting — short addressee, then the You+Me archetype pair -->
      <section class="mb-10">
        <p class="font-serif text-2xl text-ink-900 mb-3" style="margin-bottom: 0.75rem">${t(greeting(), greetingEn())},</p>
      </section>

      <!-- "You and me" archetype pair — same component as profile/share/wrapped -->
      ${archetypeBlock}

      <!-- Combined: overall score + per-category bars, one section, one glance -->
      ${renderScoreAndCategories(score, catEntries, report)}

      ${renderWhatISaw(report)}

      ${renderCollabSuggestions(report, topAction, smallThings)}

      <!-- Sign-off -->
      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">${t('Med venlig hilsen,', 'Yours,')}</p>
        <p class="text-ink-900">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">${t('← Se alle mine breve', '← See all letters')}</a>
    </div>
    ${renderLetterShareScript(run.id)}
  `;

  return page(`${toolLabelEn(run.tool_name)}`, body, 'oversigt');
}

// "What I saw" narrative layer — STRENGTHS ONLY. Risks, patterns, and
// recommendations all live in renderCollabSuggestions below so the letter
// has one place for "here's what's working" and one place for "here's what
// to try" — no risk expressed twice in two different sections.
export function renderWhatISaw(report: any): string {
  const findings: Array<{ tag?: string; title?: string; body?: string }> =
    Array.isArray(report?.findings) ? report.findings : [];
  const strengths = findings.filter(f => f.tag === 'win');
  if (strengths.length === 0) return '';

  const items = strengths.slice(0, 6).map((f, i) => {
    const num = String(i + 1).padStart(2, '0');
    return renderSuggestionRow({
      num,
      pillCls: 'bg-green-100 text-green-800',
      pillLabel: { da: 'Styrke', en: 'Strength' },
      title: f.title || '',
      body: f.body || '',
    });
  }).join('');

  return `
    <section class="mb-12">
      <h2>${t('Det jeg så', 'What I saw')}</h2>
      <div class="not-letter">${items}</div>
    </section>
  `;
}

// "Here's what I'd suggest" — the ONE place risks, patterns, and
// recommendations live. Same row layout as renderWhatISaw so the letter
// reads as one visual voice. Each row is: number + pill + title + body +
// optional "Try this" action line. Actions come from the recommendation's
// practiceStep; risks/patterns without a paired action just show the
// observation (no Try-this line).
export function renderCollabSuggestions(
  report: any,
  topAction: any | null,
  smallThings: Array<{ title: LocalizedString; summary?: LocalizedString; benefit?: LocalizedString }>,
): string {
  const findings: Array<{ tag?: string; title?: string; body?: string }> =
    Array.isArray(report?.findings) ? report.findings : [];

  type Row = {
    pillCls: string;
    pillLabel: LocalizedString;
    title: string;
    body: string;
    action?: string;
    actionLabel?: LocalizedString;
  };

  const rows: Row[] = [];

  // Risks first — they're the strongest signal
  for (const f of findings.filter(f => f.tag === 'risk')) {
    rows.push({
      pillCls: 'bg-rose-100 text-rose-800',
      pillLabel: { da: 'Risiko', en: 'Risk' },
      title: f.title || '',
      body: f.body || '',
    });
  }

  // Top recommendation — the strongest actionable suggestion from the rec pipeline
  if (topAction) {
    const fl = friendlyLabel(topAction.title || '');
    const title = bi(fl.title) || String(topAction.title || t('Det vigtigste', 'The most important thing'));
    const body = bi(fl.benefit) || bi(asBi(topAction.why)) || bi(asBi(topAction.description)) || '';
    const action = String(topAction.practiceStep || topAction.howItLooks || topAction.recommendation || topAction.fix || '');
    rows.push({
      pillCls: 'bg-amber-100 text-amber-800',
      pillLabel: { da: 'Forslag', en: 'Suggestion' },
      title,
      body,
      action,
      actionLabel: { da: 'Prøv det næste gang', en: 'Try this next time' },
    });
  }

  // Patterns — neutral observations worth noticing
  for (const f of findings.filter(f => f.tag === 'pattern')) {
    rows.push({
      pillCls: 'bg-blue-100 text-blue-800',
      pillLabel: { da: 'Mønster', en: 'Pattern' },
      title: f.title || '',
      body: f.body || '',
    });
  }

  // Remaining recommendations (small things)
  for (const s of smallThings) {
    const title = bi(s.title) || '';
    const body = bi(s.summary) || '';
    const benefit = bi(s.benefit) || '';
    rows.push({
      pillCls: 'bg-amber-100 text-amber-800',
      pillLabel: { da: 'Forslag', en: 'Suggestion' },
      title,
      body,
      action: benefit,
      actionLabel: { da: 'Hvad bliver bedre?', en: 'What gets better?' },
    });
  }

  if (rows.length === 0) return '';

  const items = rows.slice(0, 8).map((r, i) => renderSuggestionRow({
    num: String(i + 1).padStart(2, '0'),
    pillCls: r.pillCls,
    pillLabel: r.pillLabel,
    title: r.title,
    body: r.body,
    action: r.action,
    actionLabel: r.actionLabel,
  })).join('');

  return `
    <section class="mb-12">
      <h2>${t('Her er hvad jeg vil foreslå', "Here's what I'd suggest")}</h2>
      <div class="not-letter">${items}</div>
      <a href="/forbedringer" class="inline-block mt-6 text-sm text-accent-600 hover:text-accent-500">${t('Se alle anbefalinger →', 'See all recommendations →')}</a>
    </section>
  `;
}

// Shared row renderer for "What I saw" (strengths) and "Here's what I'd
// suggest" (risks/patterns/recommendations). Same layout, different pill +
// optional action line keeps the letter visually coherent.
function renderSuggestionRow(opts: {
  num: string;
  pillCls: string;
  pillLabel: LocalizedString;
  title: string;
  body: string;
  action?: string;
  actionLabel?: LocalizedString;
}): string {
  const { num, pillCls, pillLabel, title, body, action, actionLabel } = opts;
  const actionBlock = action && actionLabel ? `
    <p class="text-sm text-ink-700 mt-3 mb-0 leading-relaxed">
      <span class="text-[10px] uppercase tracking-wider font-semibold text-accent-600">${t(actionLabel.da, actionLabel.en)}</span>
      <span class="block mt-1">${escapeHtml(action)}</span>
    </p>
  ` : '';
  return `
    <div class="flex gap-4 py-4 border-b border-paper-200 last:border-b-0 items-baseline">
      <div class="font-mono text-xs text-ink-400 shrink-0">${num}</div>
      <div class="flex-1">
        <h3 class="flex items-baseline gap-2 text-ink-900 font-medium flex-wrap" style="margin: 0; font-size: 1.15rem; line-height: 1.35">
          <span class="inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${pillCls}">${t(pillLabel.da, pillLabel.en)}</span>
          <span>${escapeHtml(title)}</span>
        </h3>
        ${body ? `<p class="text-ink-700 text-sm leading-relaxed mt-2 mb-0">${escapeHtml(body)}</p>` : ''}
        ${actionBlock}
      </div>
    </div>
  `;
}

// Extract the English copy from a LocalizedString or return the string as-is.
// Handles legacy shapes where some fields are already strings rather than
// { da, en } objects.
function bi(v: any): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return v.en || v.da || '';
  return '';
}

// Map the top-action rec + the 3 small things into the unified finding shape
// (description/practiceStep/example + severity). Top action goes first.
function collabFindingsFromRecs(
  topAction: any | null,
  smallThings: Array<{ title: LocalizedString; summary?: LocalizedString; benefit?: LocalizedString }>,
): any[] {
  const items: any[] = [];

  if (topAction) {
    const f = friendlyLabel(topAction.title || '');
    items.push({
      severity: topAction.priority === 'critical' ? 'critical' : 'recommended',
      title: f.title || (topAction.title ? { da: topAction.title, en: topAction.title } : { da: 'Den vigtigste ting', en: 'The most important thing' }),
      description: f.benefit || asBi(topAction.why) || asBi(topAction.description) || '',
      example: topAction.howItLooks || '',
      practiceStep: topAction.practiceStep || '',
    });
  }

  for (const s of smallThings) {
    items.push({
      severity: 'recommended',
      title: s.title,
      description: s.summary || '',
      // Small things use "Hvad bliver bedre?" benefit as the practice step —
      // that's what the old UI folded away behind a disclosure triangle.
      practiceStep: s.benefit || '',
    });
  }

  return items;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}

// ----- Combined score + categories — one section, one glance.
//
// Hero-tal stays at the top, then each of the 7 categories flows directly
// underneath as a row with: name + plain-language line (always visible) +
// bar + score. Clicking the row expands "what's pulling this up/down" and
// "what your score means" — details are progressive, not demanded.

function renderScoreAndCategories(score: number | null, catEntries: Array<{ key: string; score: number }>, report: any): string {
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
          <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">${t('Samarbejde', 'Collaboration')}</span>
        </div>
        <div class="font-serif text-6xl ${scoreColor} leading-none">${typeof score === 'number' ? score : '—'}</div>
        ${renderSubScoreNote(report)}
      </div>

      <!-- Per-category rows, sorted high→low -->
      <div class="divide-y divide-paper-200 border-t border-paper-200">
        ${catEntries.map(c => renderCategoryRow(c.key, c.score)).join('')}
      </div>
    </section>
  `;
}

// R1 sub-score surfacing: when substrate is empty (no hooks/skills/memory),
// the blended 7-category score is depressed by things the user hasn't set up
// yet. Show the CLAUDE.md-only sub-score alongside so fresh-install users see
// both numbers and understand the gap. Mirrors formatSubScore() in analyze.ts.
export function renderSubScoreNote(report: any): string {
  if (!report?.substrateEmpty) return '';
  const sub = report.claudeMdSubScore;
  const blended = report.collaborationScore;
  if (typeof sub !== 'number' || sub === blended) return '';

  const subColor = sub >= 85 ? 'text-emerald-700'
    : sub >= 70 ? 'text-amber-700'
    : 'text-rose-700';
  const grade = report.subScoreGrade;
  const gradeSuffix = grade?.letter
    ? `${t('Karakter', 'Grade')} ${escapeHtml(grade.letter)}${grade.percentileLabel ? ` (${escapeHtml(grade.percentileLabel)})` : ''}`
    : '';

  return `
    <div class="mt-6 p-4 rounded-lg border border-paper-200 bg-paper-50">
      <div class="flex items-baseline gap-3 flex-wrap">
        <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">${t('Agent-kontrakt alene', 'Agent contract only')}</span>
        <span class="font-serif text-2xl ${subColor} leading-none">${sub}</span>
        ${gradeSuffix ? `<span class="text-xs text-ink-500">${gradeSuffix}</span>` : ''}
      </div>
      <p class="text-xs text-ink-600 mt-2 leading-relaxed mb-0">
        ${t(
          'Sub-scoren ser bort fra memory, hooks og skills — brug den mens du stadig bygger dit setup op. Den samlede score stiger automatisk, når du tilføjer disse.',
          "The sub-score ignores memory, hooks, and skills — use it while you're still building your setup. The blended score rises automatically as you add those.",
        )}
      </p>
    </div>
  `;
}

function renderCategoryRow(key: string, score: number): string {
  const explanation = CATEGORY_EXPLANATIONS[key];
  if (!explanation) return '';

  const pct = Math.max(0, Math.min(100, score));
  const barColor = pct >= 85 ? 'bg-emerald-600' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-600';
  const verdict = explanation.verdict(pct);

  return `
    <details class="group py-3">
      <summary class="cursor-pointer list-none hover:bg-paper-50 rounded-lg -mx-2 px-2 py-2 transition">
        <div class="flex items-baseline gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-medium text-ink-900">${t(explanation.label.da, explanation.label.en)}</span>
              <span class="text-accent-600 text-sm transition-transform group-open:rotate-90 inline-block leading-none">▸</span>
              <span class="text-xs text-accent-600 group-open:hidden">${t('Læs mere', 'Read more')}</span>
              <span class="text-xs text-ink-400 hidden group-open:inline">${t('Skjul', 'Hide')}</span>
            </div>
            <div class="text-sm text-ink-500 mt-0.5 leading-snug">${t(explanation.summary.da, explanation.summary.en)}</div>
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
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">${t('Hvad betyder din score', 'What your score means')}</div>
          <p class="text-ink-700 italic">${t(verdict.da, verdict.en)}</p>
        </div>
        <div>
          <div class="text-xs uppercase tracking-wider text-ink-500 mb-1">${t('Hvad trækker scoren op eller ned', 'What pulls the score up or down')}</div>
          <p class="text-ink-700">${t(explanation.whatMatters.da, explanation.whatMatters.en)}</p>
        </div>
      </div>
    </details>
  `;
}

// ----- Collapsed sections -----

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
            <div class="font-medium text-ink-900">${t('Din daglige brug', 'Your daily usage')}</div>
            <div class="text-sm text-ink-500 mt-0.5">${t(
              `${activeSessions} sessioner sidste 7 dage · ${totalRules} regler · ${memoryFiles} memory-filer`,
              `${activeSessions} sessions in the last 7 days · ${totalRules} rules · ${memoryFiles} memory files`,
            )}</div>
          </div>
          <span class="text-ink-300 transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div class="px-5 pb-5 pt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">${t('Regler i alt', 'Total rules')}</div>
            <div class="font-mono text-lg text-ink-800">${totalRules}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">${t('Memory-filer', 'Memory files')}</div>
            <div class="font-mono text-lg text-ink-800">${memoryFiles}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">${t('Sessioner sidste 7 dage', 'Sessions in the last 7 days')}</div>
            <div class="font-mono text-lg text-ink-800">${activeSessions}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-500">${t('Rettelser du har givet', 'Corrections you\'ve given')}</div>
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
            <div class="font-medium text-ink-900">${t('Hvad er der sket siden sidst', "What's happened since last time")}</div>
            <div class="text-sm text-ink-500 mt-0.5">${t(
              `${implemented} implementeret · ${pending} venter · ${total} i alt`,
              `${implemented} implemented · ${pending} waiting · ${total} total`,
            )}</div>
          </div>
          <span class="text-ink-300 transition-transform group-open:rotate-90">▸</span>
        </summary>
        <div class="px-5 pb-5 pt-2 text-sm text-ink-600 leading-relaxed">
          ${tHtml(
            'Jeg holder styr på hvilke anbefalinger du har taget imod og hvilke der stadig venter. Se detaljerne på <a href="/forbedringer" class="text-accent-600 hover:text-accent-500">Anbefalinger-siden</a>.',
            'I keep track of which recommendations you\'ve acted on and which are still waiting. See the details on the <a href="/forbedringer" class="text-accent-600 hover:text-accent-500">Recommendations page</a>.',
          )}
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
  const leadInDa = allFindings.length === 0
    ? 'Jeg har gennemgået dit setup for leaks, injection-overflader, regel-konflikter og eksterne advisors. Alt ser rent ud.'
    : `Jeg har gennemgået dit setup for leaks, injection-overflader, regel-konflikter og eksterne advisors. Jeg fandt ${allFindings.length} ${allFindings.length === 1 ? 'ting' : 'ting'} værd at kigge på.`;
  const leadInEn = allFindings.length === 0
    ? "I've reviewed your setup for leaks, injection surfaces, rule conflicts and external advisors. Everything looks clean."
    : `I've reviewed your setup for leaks, injection surfaces, rule conflicts and external advisors. I found ${allFindings.length} ${allFindings.length === 1 ? 'thing' : 'things'} worth looking at.`;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <header class="mb-10 not-letter flex items-start justify-between gap-4">
        <div class="font-mono text-xs text-ink-300 pt-2">${t(formatLetterDate(run.started_at), formatLetterDateEn(run.started_at))}</div>
        ${renderLetterShareControls()}
      </header>

      <section class="mb-10">
        <p class="font-serif text-2xl text-ink-900 mb-3" style="margin-bottom: 0.75rem">${t(greeting(), greetingEn())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${t(leadInDa, leadInEn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, securityVerdict, ceiling, { da: 'Sikkerhed', en: 'Security' })}

      ${renderSecurityFindings(allFindings)}

      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">${t('Med venlig hilsen,', 'Yours,')}</p>
        <p class="text-ink-900">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">${t('← Se alle mine breve', '← See all letters')}</a>
    </div>
    ${renderLetterShareScript(run.id)}
  `;

  return page(`${toolLabelEn(run.tool_name)}`, body, 'oversigt');
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
  const leadInDa = userFindingsCount === 0
    ? (typeof score === 'number' && score >= 95
        ? 'Dit setup er rent — værktøjer, schedules og data passer sammen. Der er ikke noget du skal gøre.'
        : 'Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Alt hænger sammen.')
    : `Jeg har kigget dit setup igennem for orphan jobs, døde schedules, overlap og substrat-problemer. Jeg fandt ${userFindingsCount} ${userFindingsCount === 1 ? 'ting' : 'ting'} værd at tage fat på.`;
  const leadInEn = userFindingsCount === 0
    ? (typeof score === 'number' && score >= 95
        ? 'Your setup is clean — tools, schedules and data fit together. There is nothing you need to do.'
        : "I've looked through your setup for orphan jobs, dead schedules, overlap and substrate issues. Everything hangs together.")
    : `I've looked through your setup for orphan jobs, dead schedules, overlap and substrate issues. I found ${userFindingsCount} ${userFindingsCount === 1 ? 'thing' : 'things'} worth tackling.`;

  const body = `
    <article class="max-w-2xl mx-auto letter-prose">
      <header class="mb-10 not-letter flex items-start justify-between gap-4">
        <div class="font-mono text-xs text-ink-300 pt-2">${t(formatLetterDate(run.started_at), formatLetterDateEn(run.started_at))}</div>
        ${renderLetterShareControls()}
      </header>

      <section class="mb-10">
        <p class="font-serif text-2xl text-ink-900 mb-3" style="margin-bottom: 0.75rem">${t(greeting(), greetingEn())},</p>
        <p class="text-ink-700 leading-relaxed" style="margin: 0">${t(leadInDa, leadInEn)}</p>
      </section>

      ${renderDomainScoreAndCategories(score, catEntries, systemHealthVerdict, ceiling, { da: 'System-sundhed', en: 'System health' })}

      ${renderSystemHealthFindings(sortedFindings)}

      <footer class="mt-10">
        <p class="text-ink-700 italic mb-3">${t('Med venlig hilsen,', 'Yours,')}</p>
        <p class="text-ink-900">${signature()}</p>
      </footer>
    </article>
    <div class="mt-8 max-w-2xl mx-auto">
      <a href="/historik" class="text-sm text-ink-500 hover:text-accent-600 transition">${t('← Se alle mine breve', '← See all letters')}</a>
    </div>
    ${renderLetterShareScript(run.id)}
  `;

  return page(`${toolLabelEn(run.tool_name)}`, body, 'oversigt');
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
  _verdictFn: (s: number) => { da: string; en: string } | string,
  _ceiling: any,
  domainLabel: { da: string; en: string } = { da: 'Score', en: 'Score' },
): string {
  // Match the home-page tile treatment: colored bullet + label, big
  // font-serif number in the same color, no surrounding card. Verdict
  // prose lives in the leadIn paragraph under "Kære &lt;name&gt;" — showing it
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
          <span class="text-[11px] uppercase tracking-[0.15em] text-ink-500">${t(domainLabel.da, domainLabel.en)}</span>
        </div>
        <div class="font-serif text-6xl ${scoreColor} leading-none">${typeof score === 'number' ? score : '—'}</div>
      </div>

      <div class="divide-y divide-paper-200 border-t border-paper-200">
        ${catEntries.map(c => renderCategoryRow(c.key, c.score)).join('')}
      </div>
    </section>
  `;
}

// ----- Unified finding renderer --------------------------------------------
//
// One visual grammar for every "here is a thing I found" across health,
// security, and collab. Flat brev-prose — no chips, no TYPE badges, no kind
// labels. A single red dot marks critical items; everything else relies on
// typography and order to carry emphasis.
//
// Inputs it knows how to read:
//   severity:        'critical' | 'recommended' | 'nice_to_have' — only 'critical' shows a dot
//   title            — plain title (required)
//   description      — body prose (system-health, collab small-things)
//   summary / why    — alt body prose (collab, system-health italic)
//   howItLooks       — optional collapsed example block (collab top-action)
//   example          — alt collapsed example block
//   recommendation   — closing action paragraph → "Fix: …"
//   fix              — alt closing action paragraph
//   practiceStep     — collab-style closing action → "Prøv det næste gang: …"
//
// The `practiceStep` field takes precedence and changes the label. Otherwise
// whichever of recommendation/fix is non-empty wins.
// Shared severity chrome — used on both the Anbefalinger page and inside
// every letter type so findings look identical everywhere.
const severityRank: Record<string, number> = { critical: 0, recommended: 1, nice_to_have: 2 };
const severityMeta: Record<string, { color: string; label: LocalizedString }> = {
  critical:     { color: 'bg-rose-600', label: { da: 'Kritisk', en: 'Critical' } },
  recommended:  { color: 'bg-amber-500', label: { da: 'Vigtigt', en: 'Important' } },
  nice_to_have: { color: 'bg-ink-300',   label: { da: 'Idé', en: 'Idea' } },
};

function renderAnbefalingCard(params: {
  title: string | LocalizedString;
  severity?: string;
  body?: string | LocalizedString;
  action?: string | LocalizedString;
  actionLabel?: string | LocalizedString;
  dropHref?: string;
  timestamp?: string;
  source?: string | LocalizedString;
  /** Small status line — e.g. "Open for 3 days", "Returned after being gone".
   *  Rendered subtly under the title when present. */
  meta?: string | LocalizedString | null;
}): string {
  const sev = severityMeta[params.severity || 'recommended'] || severityMeta.recommended;
  const dropForm = params.dropHref ? `
    <form method="POST" action="${params.dropHref}" class="ml-3 shrink-0">
      <button type="submit"
        class="text-xs text-ink-500 hover:text-bad-fg border border-paper-300 hover:border-bad-fg rounded-full px-3 py-1 transition">
        ${t('Drop', 'Dismiss')}
      </button>
    </form>
  ` : '';
  const body = asBi(params.body);
  const action = asBi(params.action);
  const actionLabel = asBi(params.actionLabel) || { da: 'Hvad skal du gøre?', en: 'What should you do?' };
  return `
    <article class="border border-paper-300 rounded-lg px-6 py-5">
      <div class="flex items-start justify-between gap-3 pb-4 mb-5 border-b border-dashed border-paper-300">
        <div class="min-w-0 flex-1">
          <h3 class="font-serif text-xl text-ink-900 leading-snug pl-6 -indent-6" style="margin:0" title="${escapeHtml(sev.label.da)}">
            <span class="inline-block w-2.5 h-2.5 rounded-full ${sev.color} align-middle relative top-[-0.15em] mr-3"></span>${tBi(params.title)}
          </h3>
          ${params.source ? `<div class="text-[10px] uppercase tracking-[0.15em] text-ink-400 mt-1 pl-6">${tBi(params.source)}</div>` : ''}
          ${params.meta ? `<div class="text-[11px] text-ink-400 mt-1 pl-6 italic">${tBi(params.meta)}</div>` : ''}
        </div>
        ${dropForm}
      </div>
      <div class="space-y-4">
        ${body ? `
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-300 mb-1">${t('Hvad er det?', 'What is this?')}</div>
            <div class="text-sm text-ink-700 leading-relaxed whitespace-pre-line">${tBi(body)}</div>
          </div>
        ` : ''}
        ${action ? `
          <div>
            <div class="text-xs uppercase tracking-wider text-ink-300 mb-1">${tBi(actionLabel)}</div>
            <div class="text-sm text-ink-700 leading-relaxed whitespace-pre-line">${tBi(action)}</div>
          </div>
        ` : ''}
        ${params.timestamp ? `<div class="font-mono text-xs text-ink-300 pt-1">${params.timestamp}</div>` : ''}
      </div>
    </article>
  `;
}

function renderLetterFinding(f: any): string {
  const title = f.title || f.category || f._kind || '';
  const body = f.description || f.summary || f.why || '';
  const practiceStep = f.practiceStep || '';
  const action = practiceStep || f.recommendation || f.fix || '';
  const actionLabel: LocalizedString = practiceStep
    ? { da: 'Prøv det næste gang', en: 'Try this next time' }
    : { da: 'Hvad skal du gøre?', en: 'What should you do?' };
  return renderAnbefalingCard({
    title,
    severity: f.severity,
    body,
    action,
    actionLabel,
    meta: findingMetaFromLedger(f),
  });
}

/**
 * Pulls ledger info for a finding (if it carries a findingHash) and returns
 * a short human-language status line — "seen for 3 days", "returned after
 * being fixed", "dismissed". Old reports (pre-ledger) return null.
 */
function findingMetaFromLedger(f: any): LocalizedString | null {
  if (!f || !f.findingHash) return null;
  try {
    const row = getFindingByHash(f.findingHash);
    if (!row) return null;
    const now = Date.now();
    const ageMs = now - row.first_seen_at;
    const ageDays = Math.max(1, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
    const reopenNote = row.reopened_count > 0
      ? {
          da: row.reopened_count === 1
            ? ' — vendt tilbage efter at have været væk'
            : ` — er vendt tilbage ${row.reopened_count} gange`,
          en: row.reopened_count === 1
            ? ' — returned after being gone'
            : ` — has returned ${row.reopened_count} times`,
        }
      : { da: '', en: '' };
    if (row.state === 'dismissed') {
      return {
        da: `Droppet ${row.dismiss_reason ? `(${row.dismiss_reason})` : ''}`.trim(),
        en: `Dismissed ${row.dismiss_reason ? `(${row.dismiss_reason})` : ''}`.trim(),
      };
    }
    if (row.state === 'closed') {
      return { da: 'Lukket — scan ser den ikke længere', en: 'Closed — scan no longer sees it' };
    }
    // Open
    if (ageDays <= 1) {
      return {
        da: `Ny i dag${reopenNote.da}`,
        en: `New today${reopenNote.en}`,
      };
    }
    return {
      da: `Åben i ${ageDays} dage${reopenNote.da}`,
      en: `Open for ${ageDays} days${reopenNote.en}`,
    };
  } catch {
    return null;
  }
}

function severityBadge(severity: string): string {
  if (severity === 'critical') return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700"><span class="w-1.5 h-1.5 rounded-full bg-rose-600"></span>${t('Kritisk', 'Critical')}</span>`;
  if (severity === 'recommended') return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>${t('Anbefalet', 'Recommended')}</span>`;
  return `<span class="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500"><span class="w-1.5 h-1.5 rounded-full bg-ink-300"></span>${t('Idé', 'Idea')}</span>`;
}

function renderSecurityFindings(findings: any[]): string {
  if (findings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed italic">${t('Ingen fund i dag. Kom tilbage efter næste scan.', 'No findings today. Come back after the next scan.')}</p>
      </section>
    `;
  }

  // Extract a distinguishing subject (table name, file path) so we can group
  // findings that share a title but affect different artifacts.
  const backtickOther = (s: string, skip?: string): string | null => {
    if (!s) return null;
    const matches = [...s.matchAll(/`([^`]+)`/g)].map(m => m[1]);
    return matches.find(m => m !== skip) || null;
  };
  const subjectOf = (f: any): string => {
    const fromDetail = backtickOther(f.detail || '', f.projectName);
    if (fromDetail) return fromDetail;
    const fromRec = backtickOther(f.recommendation || '', f.projectName);
    if (fromRec) return fromRec;
    return f.location || f.artifactPath || f.conflictingPath || f.projectName || '';
  };

  // Group by title
  type Group = { first: any; subjects: string[]; count: number };
  const groups = new Map<string, Group>();
  for (const f of findings) {
    const title = f.title || f.category || f._kind || '';
    if (!title) continue;
    const subject = subjectOf(f);
    const g = groups.get(title);
    if (g) {
      g.count++;
      if (subject && !g.subjects.includes(subject)) g.subjects.push(subject);
    } else {
      groups.set(title, { first: f, subjects: subject ? [subject] : [], count: 1 });
    }
  }

  const groupItems = [...groups.values()];
  const shown = groupItems.slice(0, 15);
  const extra = groupItems.length - shown.length;

  // Each rendered item: title (from first), body with count + affected list
  // (if >1) or plain Sted: <where> (if 1), recommendation once.
  const enriched = shown.map(g => {
    const f = g.first;
    const projectPrefix = f.projectName ? `${f.projectName}: ` : '';
    let description: LocalizedString;
    if (g.count > 1) {
      const preview = g.subjects.slice(0, 5).join(', ');
      const moreDa = g.subjects.length > 5 ? ` +${g.subjects.length - 5} mere` : '';
      const moreEn = g.subjects.length > 5 ? ` +${g.subjects.length - 5} more` : '';
      description = {
        da: `${g.count} tilfælde${projectPrefix ? ` i ${f.projectName}` : ''}: ${preview}${moreDa}`,
        en: `${g.count} cases${projectPrefix ? ` in ${f.projectName}` : ''}: ${preview}${moreEn}`,
      };
    } else {
      const where = g.subjects[0] || f.location || f.artifactPath || f.conflictingPath || f.projectName || '';
      const body = f.description || f.why || '';
      description = {
        da: where ? (body ? `${body}\n\nSted: ${where}` : `Sted: ${where}`) : body,
        en: where ? (body ? `${body}\n\nLocation: ${where}` : `Location: ${where}`) : body,
      };
    }
    return { ...f, title: f.title || f.category || f._kind, description };
  });

  return `
    <section class="mb-12">
      <h2>${t('Det jeg fandt', 'What I found')}</h2>
      <div class="space-y-6">
        ${enriched.map(renderLetterFinding).join('')}
      </div>
      ${extra > 0 ? `<p class="text-sm text-ink-500 mt-4 italic">${t(`…og ${extra} typer til. Kør med format="detailed" for alle.`, `…and ${extra} more types. Run with format="detailed" for all of them.`)}</p>` : ''}
    </section>
  `;
}

function renderSystemHealthFindings(findings: any[]): string {
  if (findings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed">${t('Ingen ting at rydde op i. Setup\'et hænger sammen.', 'Nothing to clean up. Your setup holds together.')}</p>
      </section>
    `;
  }

  // Drop same-suite overlap findings from the user's report entirely.
  // The scorer already excludes them from penalty, and they describe
  // intentional product-family overlap the user can't meaningfully act on.
  // The agent still sees them in the JSON payload for context; the letter
  // just doesn't mention them.
  const regularFindings = findings.filter(f => !f.suitePrefix);

  if (regularFindings.length === 0) {
    return `
      <section class="mb-12">
        <p class="text-ink-700 leading-relaxed">${t('Ingen ting at rydde op i. Setup\'et hænger sammen.', 'Nothing to clean up. Your setup holds together.')}</p>
      </section>
    `;
  }

  const shown = regularFindings.slice(0, 15);
  const extra = regularFindings.length - shown.length;

  return `
    <section class="mb-12">
      <h2>${t('Det jeg fandt', 'What I found')}</h2>
      <div class="space-y-6">
        ${shown.map(renderLetterFinding).join('')}
      </div>
      ${extra > 0 ? `<p class="text-sm text-ink-500 mt-4 italic">${t(`…og ${extra} fund til.`, `…and ${extra} more findings.`)}</p>` : ''}
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
): Array<{ title: LocalizedString; summary?: LocalizedString; benefit?: LocalizedString }> {
  const out: Array<{ title: LocalizedString; summary?: LocalizedString; benefit?: LocalizedString }> = [];
  const seenTitles = new Set<string>();
  if (topAction?.title) seenTitles.add(topAction.title);

  // 1-2 user-facing recommendations (not the top one)
  for (const r of recs) {
    if (out.length >= 2) break;
    if (!r.title || seenTitles.has(r.title)) continue;
    if (r === topAction) continue;
    if (r.priority === 'critical') continue;
    const f = friendlyLabel(r.title);
    out.push({
      title: f.title,
      summary: f.summary || asBi(r.description) || undefined,
      benefit: f.benefit,
    });
    seenTitles.add(r.title);
  }

  // 1-2 tool recommendations
  for (const tr of toolRecs) {
    if (out.length >= 3) break;
    if (!tr.name || seenTitles.has(tr.name)) continue;
    const f = friendlyLabel(tr.name);
    out.push({
      title: f.title,
      summary: f.summary || asBi(tr.userFriendlyDescription) || asBi(tr.description) || undefined,
      benefit: f.benefit,
    });
    seenTitles.add(tr.name);
  }

  return out.slice(0, 3);
}

// ============================================================================
// Forbedringer — recommendations, cleaned of jargon
// ============================================================================

function sourceLabel(toolName?: string | null): LocalizedString | undefined {
  if (!toolName) return undefined;
  if (toolName === 'collab' || toolName === 'analyze') return { da: 'Samarbejde', en: 'Collaboration' };
  if (toolName === 'security') return { da: 'Sikkerhed', en: 'Security' };
  if (toolName === 'health' || toolName === 'audit') return { da: 'System-sundhed', en: 'System health' };
  return undefined;
}

function renderForbedringer(): string {
  reconcilePendingRecommendations();
  const pending = getRecommendations('pending');
  const implemented = getRecommendations('implemented');
  const dismissed = getRecommendations('dismissed');

  const renderList = (items: any[], canDrop: boolean) => {
    if (items.length === 0) return `<p class="text-ink-500 text-sm">${t('Ingen lige nu.', 'None right now.')}</p>`;
    const sorted = [...items].sort((a, b) => {
      const sa = severityRank[a.severity] ?? 1;
      const sb = severityRank[b.severity] ?? 1;
      if (sa !== sb) return sa - sb;
      return (b.given_at || 0) - (a.given_at || 0);
    });
    return `
      <div class="space-y-3">
        ${sorted.map(r => {
          const f = friendlyLabel(r.title);
          const body = f.summary || (r.text_snippet ? r.text_snippet.toString() : '');
          const action = r.action_data || '';
          const tsBi = r.given_at ? tHtml(timeAgo(r.given_at), timeAgoEn(r.given_at)) : '';
          return renderAnbefalingCard({
            title: f.title,
            severity: r.severity,
            body,
            action,
            source: sourceLabel(r.source_tool),
            dropHref: canDrop ? `/forbedringer/${escapeHtml(r.id)}/dismiss` : undefined,
            timestamp: tsBi,
          });
        }).join('')}
      </div>
    `;
  };

  if (pending.length === 0 && implemented.length === 0) {
    return page('Recommendations', `
      <section class="py-12 text-center">
        <div class="text-5xl mb-4">💌</div>
        <h1 class="text-2xl font-semibold mb-3">${t('Ingen anbefalinger endnu', 'No recommendations yet')}</h1>
        <p class="text-ink-500 max-w-md mx-auto">
          ${t(
            'Når jeg har lavet min første rapport for dig, samler jeg anbefalinger her — ting du kan ændre for at få mere ud af din assistent.',
            "Once I've written my first report for you, I'll gather recommendations here — things you can change to get more out of your assistant.",
          )}
        </p>
      </section>
    `, 'forbedringer');
  }

  return page('Recommendations', `
    ${pageDateStrip()}
    <section>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">${t('Anbefalinger', 'Recommendations')}</h1>
      <p class="font-serif text-2xl text-ink-700 leading-snug max-w-xl">${t('Ting jeg har lagt mærke til — de vigtigste øverst.', 'Things I\'ve noticed — the most important first.')}</p>
    </section>

    <div class="mt-16">
      <div class="mb-10">
        <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-3">${t(`Venter på dig (${pending.length})`, `Waiting on you (${pending.length})`)}</h2>
        ${renderList(pending, true)}
      </div>

      ${implemented.length > 0 ? `
        <div class="mb-10">
          <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-3">${t(`Allerede gjort (${implemented.length})`, `Already done (${implemented.length})`)}</h2>
          ${renderList(implemented, false)}
        </div>
      ` : ''}

      ${dismissed.length > 0 ? `
        <div>
          <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-3">${t(`Droppet (${dismissed.length})`, `Dismissed (${dismissed.length})`)}</h2>
          ${renderList(dismissed, false)}
        </div>
      ` : ''}
    </div>
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

function renderOnboardForm(result: OnboardResult, error?: LocalizedString): string {
  const totalSteps = 5; // v4: name, outcome, autonomy, cadence, audience
  const isWelcome = result.step === 'welcome';
  const stepNo = result.done ? totalSteps : Math.max(1, Math.min(stepNumberFromResult(result), totalSteps));
  const progress = Math.round((stepNo / totalSteps) * 100);

  // Welcome = pure letter screen. Render it separately so the layout can
  // breathe (no progress bar, no input, single "Ready" button).
  if (isWelcome) {
    return renderOnboardWelcome(result);
  }

  const teaching = result.teaching
    ? `<div class="font-serif text-xl md:text-2xl text-ink-700 leading-snug mb-10 max-w-xl whitespace-pre-wrap">${t(result.teaching.da, result.teaching.en)}</div>`
    : '';

  // Chips are multi-select by default — toggle on click, append value to
  // textarea (comma-separated). Handles multiple "I want X and Y" goals,
  // multiple audiences, etc. Single-choice parsers (autonomy, cadence)
  // still match fine because they regex-scan the combined string.
  const optionsChips = result.options.length > 0
    ? `
      <div id="du-chips" class="mb-8 flex flex-wrap gap-2">
        ${result.options.map(opt => `
          <button type="button"
            data-opt-da="${escapeHtml(opt.da)}"
            data-opt-en="${escapeHtml(opt.en)}"
            data-selected="false"
            class="du-chip text-sm bg-paper-100 border border-paper-300 rounded-full px-3 py-1 text-ink-700 transition hover:bg-accent-100 hover:border-accent-600">
            ${t(opt.da, opt.en)}
          </button>
        `).join('')}
      </div>
      <script>
        (function() {
          var chips = document.querySelectorAll('#du-chips .du-chip');
          var el = document.getElementById('answer');
          if (!chips.length || !el) return;
          var currentLang = function() { return document.documentElement.getAttribute('data-lang') || 'da'; };
          var fireInput = function() { el.dispatchEvent(new Event('input', { bubbles: true })); };
          var syncValue = function() {
            var lang = currentLang();
            var selected = [];
            chips.forEach(function(chip) {
              if (chip.dataset.selected === 'true') {
                selected.push(chip.getAttribute('data-opt-' + lang) || '');
              }
            });
            el.value = selected.join(', ');
            fireInput();
          };
          chips.forEach(function(chip) {
            chip.addEventListener('click', function() {
              var isOn = chip.dataset.selected === 'true';
              chip.dataset.selected = isOn ? 'false' : 'true';
              chip.classList.toggle('bg-accent-100', !isOn);
              chip.classList.toggle('border-accent-600', !isOn);
              chip.classList.toggle('text-ink-900', !isOn);
              syncValue();
              el.focus();
            });
          });
          // Language toggle should re-sync labels in the textarea.
          new MutationObserver(syncValue).observe(document.documentElement, {
            attributes: true, attributeFilter: ['data-lang']
          });
        })();
      </script>
    `
    : '';

  const errorBlock = error
    ? `<div class="bg-bad-bg border border-bad-fg/30 text-bad-fg rounded-lg px-4 py-3 mb-6 text-sm">${t(error.da, error.en)}</div>`
    : '';

  const body = `
    <section class="max-w-2xl mx-auto">
      <div class="mb-12">
        <div class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-2">${t(`Spørgsmål ${stepNo} af ${totalSteps}`, `Question ${stepNo} of ${totalSteps}`)}</div>
        <div class="h-px bg-paper-200 overflow-hidden">
          <div class="h-full bg-accent-600 transition-all" style="width: ${progress}%"></div>
        </div>
      </div>

      ${teaching}
      ${errorBlock}

      <form method="POST" action="/onboard">
        <input type="hidden" name="step" value="${escapeHtml(result.nextStep || 'greet')}">
        <input type="hidden" name="state" value="${escapeHtml(result.state)}">

        <label for="answer" class="block font-serif text-xl md:text-2xl text-ink-900 leading-snug mb-5 whitespace-pre-wrap">${result.question ? t(result.question.da, result.question.en) : ''}</label>

        ${optionsChips}

        <div class="letter-lines-wrap">
          <textarea
            id="answer"
            name="answer"
            rows="1"
            autocomplete="off"
            autocorrect="on"
            spellcheck="true"
            class="letter-lines"
            data-ph-da="skriv her"
            data-ph-en="write here"
            placeholder=""
            autofocus
          ></textarea>
        </div>
        <script>
          (function() {
            var el = document.getElementById('answer');
            if (!el) return;
            // Keep placeholder in sync with active language.
            var applyPh = function() {
              var lang = document.documentElement.getAttribute('data-lang') || 'da';
              el.setAttribute('placeholder', el.getAttribute('data-ph-' + lang) || '');
            };
            applyPh();
            document.addEventListener('DOMContentLoaded', applyPh);
            var obs = new MutationObserver(applyPh);
            obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang'] });

            // Auto-grow: as the user writes, new ruled lines appear beneath.
            var grow = function() {
              el.style.height = 'auto';
              el.style.height = el.scrollHeight + 'px';
            };
            el.addEventListener('input', grow);
            // Also grow when an option-chip pre-fills the value programmatically.
            var onFocus = function() { setTimeout(grow, 0); };
            el.addEventListener('focus', onFocus);
            // Initial sizing after the browser has laid out the textarea.
            requestAnimationFrame(grow);
            // Ctrl/Cmd+Enter submits; plain Enter makes a newline.
            el.addEventListener('keydown', function(e) {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (el.form) el.form.requestSubmit();
              }
            });
          })();
        </script>
        <style>
          .letter-lines-wrap {
            position: relative;
            margin-bottom: 4px;
          }
          /* Ruled-paper effect: a dashed horizontal line sits at the bottom
             of every line-height stripe. The SVG is stretched to fill each
             stripe (preserveAspectRatio=none), placing its line just above
             the next line's start — so each line of text gets its own rule
             as the textarea grows. */
          .letter-lines {
            display: block;
            width: 100%;
            min-height: 2.9rem;
            background: transparent;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='42' preserveAspectRatio='none'><line x1='0' y1='40' x2='40' y2='40' stroke='rgb(150,150,150)' stroke-width='1.5' stroke-dasharray='6 4' stroke-opacity='0.65'/></svg>");
            background-size: 40px 2.9rem;
            background-repeat: repeat;
            background-position: 0 0.15rem;
            border: 0;
            outline: none;
            resize: none;
            overflow: hidden;
            padding: 0;
            font-family: var(--font-serif, Georgia, 'Times New Roman', serif);
            font-style: italic;
            font-size: 1.75rem;
            line-height: 2.9rem;
            color: var(--c-ink-900, inherit);
            caret-color: var(--c-accent-600, #EC5329);
            transition: background-image 150ms ease;
          }
          .letter-lines::placeholder {
            color: var(--c-ink-400, rgba(150,150,150,0.45));
            font-style: italic;
          }
          .letter-lines:focus {
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='42' preserveAspectRatio='none'><line x1='0' y1='40' x2='40' y2='40' stroke='rgb(236,83,41)' stroke-width='2' stroke-dasharray='6 4'/></svg>");
          }
        </style>

        <div class="flex items-center justify-end pt-10">
          <button type="submit"
            class="bg-accent-600 hover:bg-accent-500 text-white font-medium px-6 py-2.5 rounded-lg transition">
            ${t('Næste →', 'Next →')}
          </button>
        </div>
      </form>
    </section>
  `;

  return page('Onboarding', body, 'oversigt');
}

// ----------------------------------------------------------------------------
// Welcome screen — pure letter, no question, no input, single "Ready" button.
// The POST carries a hidden answer="ready" so the server's empty-answer guard
// doesn't fire and stepWelcome advances to the name question.
// ----------------------------------------------------------------------------
function renderOnboardWelcome(result: OnboardResult): string {
  // Split the teaching text on the first paragraph break so we can render
  // the opening sentence in the brand action colour — it's the line the
  // whole letter hangs off ("this year you'll spend more hours with your
  // agent than with most people in your life") and deserves to stand out.
  const splitTeaching = (full: string): { headline: string; rest: string } => {
    const idx = full.indexOf('\n\n');
    if (idx === -1) return { headline: full, rest: '' };
    return { headline: full.slice(0, idx), rest: full.slice(idx + 2) };
  };

  const teaching = result.teaching
    ? (() => {
        const da = splitTeaching(result.teaching.da);
        const en = splitTeaching(result.teaching.en);
        // No whitespace-pre-wrap on the headline — single sentence, the
        // leading newlines/indentation from the template would become
        // visible text otherwise. Rest keeps pre-wrap for paragraph breaks.
        return `<p class="font-serif text-2xl md:text-3xl text-action-600 leading-snug mb-8 text-left">${t(da.headline.trim(), en.headline.trim())}</p>${da.rest || en.rest
          ? `<div class="font-serif text-xl md:text-2xl text-ink-700 leading-relaxed mb-10 whitespace-pre-wrap text-left">${t(da.rest, en.rest)}</div>`
          : ''}`;
      })()
    : '';

  const body = `
    <section class="max-w-2xl mx-auto">
      <p class="font-serif italic text-5xl md:text-6xl text-ink-900 leading-tight mb-10 text-left">
        ${t('Dear User', 'Dear User')}
      </p>

      ${teaching}

      <form method="POST" action="/onboard">
        <input type="hidden" name="step" value="welcome">
        <input type="hidden" name="state" value="${escapeHtml(result.state)}">
        <input type="hidden" name="answer" value="ready">

        <div class="flex items-center justify-end pt-4">
          <button type="submit"
            class="bg-accent-600 hover:bg-accent-500 text-white font-medium px-6 py-2.5 rounded-lg transition">
            ${t('Klar →', 'Ready →')}
          </button>
        </div>
      </form>
    </section>
  `;

  return page('Onboarding', body, 'oversigt');
}

function stepNumberFromResult(result: OnboardResult): number {
  // v4 flow: welcome → greet (name, Q1) → outcome (Q2) → autonomy (Q3)
  // → cadence (Q4) → audience (Q5) → plan. Legacy names (intro/work/data/
  // stack/pains/substrate) route to the closest v4 step server-side so the
  // counter still lines up if older clients pass old step names.
  const map: Record<string, number> = {
    welcome: 1, greet: 1,
    outcome: 2, intro: 2, work: 2, goals: 2, role: 2,
    autonomy: 3, data: 3, stack: 3, pains: 3, 'stack-pains': 3,
    cadence: 4, substrate: 4,
    audience: 5,
    plan: 5,
  };
  if (result.nextStep && result.nextStep !== result.step && result.nextStep !== 'plan') {
    return map[result.nextStep] || 1;
  }
  return map[result.step] || 1;
}

function renderOnboardDone(result: OnboardResult): string {
  const name = (result.state && (() => {
    try {
      const s = JSON.parse(Buffer.from(result.state, 'base64').toString('utf-8'));
      return s?.name || null;
    } catch { return null; }
  })()) as string | null;

  const greetingName = name ? `, ${name}` : '';

  const step = (s: { ok: boolean; title: { da: string; en: string }; detail?: string }) => {
    const icon = s.ok
      ? `<span class="text-emerald-500 font-bold mr-2" aria-hidden="true">✓</span>`
      : `<span class="text-amber-500 font-bold mr-2" aria-hidden="true">⚠</span>`;
    const detail = !s.ok && s.detail
      ? `<span class="text-ink-500 text-sm block mt-1 pl-6">${escapeHtml(s.detail)}</span>`
      : '';
    return `<li class="flex items-start">${icon}<span>${t(s.title.da, s.title.en)}</span>${detail}</li>`;
  };

  const installList = (result.installSteps && result.installSteps.length > 0)
    ? `
      <div class="mb-12">
        <h2 class="font-serif text-xl text-ink-900 mb-4">${t('Hvad jeg har ordnet', 'What I took care of')}</h2>
        <ul class="space-y-2 text-ink-700 text-lg leading-relaxed">
          ${result.installSteps.map(step).join('')}
        </ul>
      </div>
    `
    : '';

  // Clipboard-copy block for a single prompt.
  const copyBlock = (promptDa: string, promptEn: string, labelDa: string, labelEn: string) => `
    <div class="mb-4">
      <p class="text-sm text-ink-500 mb-2">${t(labelDa, labelEn)}</p>
      <div class="flex items-stretch gap-2">
        <pre class="flex-1 font-serif italic text-base leading-relaxed text-ink-900 bg-paper-100 border border-paper-200 rounded-lg p-3 whitespace-pre-wrap">${t(promptDa, promptEn)}</pre>
        <button type="button"
          onclick="(function(btn){ var lang = document.documentElement.getAttribute('data-lang') || 'da'; var txt = btn.getAttribute('data-txt-' + lang); navigator.clipboard.writeText(txt).then(function(){ btn.textContent = btn.getAttribute('data-done-' + lang); setTimeout(function(){ btn.textContent = btn.getAttribute('data-copy-' + lang); }, 1500); }); })(this);"
          data-txt-da="${escapeHtml(promptDa)}"
          data-txt-en="${escapeHtml(promptEn)}"
          data-copy-da="Kopiér"
          data-copy-en="Copy"
          data-done-da="Kopieret"
          data-done-en="Copied"
          class="bg-accent-600 hover:bg-accent-500 text-white font-medium text-sm px-4 rounded-lg transition">Kopiér</button>
      </div>
    </div>
  `;

  const needsSetup = (result.platformStatus || []).filter(p => p.state === 'needs-setup');
  const connected = (result.platformStatus || []).filter(p => p.state === 'connected');

  const platformBlock = (result.platformStatus && result.platformStatus.length > 0)
    ? `
      <div class="mb-12">
        <h2 class="font-serif text-xl text-ink-900 mb-2">${t('Jeg fandt også disse i dine projekter', 'I also found these in your projects')}</h2>
        <p class="text-ink-500 text-sm mb-5">${t('Kopiér sætningen og send til din agent — den ordner resten.', 'Copy the sentence and send it to your agent — it takes care of the rest.')}</p>
        ${connected.length > 0 ? `
          <ul class="space-y-1 text-ink-700 mb-4">
            ${connected.map(p => `<li class="flex items-start"><span class="text-emerald-500 font-bold mr-2" aria-hidden="true">✓</span><span>${escapeHtml(p.label)} — ${t('forbundet', 'connected')}</span></li>`).join('')}
          </ul>
        ` : ''}
        ${needsSetup.map(p => p.prompt ? `
          <div class="mb-5">
            <p class="text-ink-900 font-medium mb-2">${escapeHtml(p.label)}</p>
            ${copyBlock(p.prompt.da, p.prompt.en, 'Send til din agent:', 'Send to your agent:')}
          </div>
        ` : '').join('')}
      </div>
    `
    : '';

  const scheduledBlock = result.scheduledPrompt
    ? `
      <div class="mb-12">
        <h2 class="font-serif text-xl text-ink-900 mb-2">${t('Din rutine', 'Your routine')}</h2>
        <p class="text-ink-500 text-sm mb-4">${t('Så du får automatiske breve i den rytme du ønskede.', 'So you get automatic letters at the rhythm you wanted.')}</p>
        ${copyBlock(result.scheduledPrompt.da, result.scheduledPrompt.en, 'Send til din agent:', 'Send to your agent:')}
      </div>
    `
    : '';

  const body = `
    <section class="max-w-2xl mx-auto">
      <p class="font-serif italic text-5xl md:text-6xl text-ink-900 leading-tight mb-8">
        ${t(`Tak${greetingName}`, `Thank you${greetingName}`)}
      </p>

      <div class="font-serif text-xl md:text-2xl text-ink-700 leading-relaxed mb-12 whitespace-pre-wrap">
        ${t(
          'Jeg har sat det grundlæggende op for dig. Jeg lærer dig bedre at kende efterhånden — de første breve er generelle, efter et par uger begynder de at ramme mere præcist.',
          'I\'ve taken care of the basics. I\'ll get to know you better over time — the first letters are general, after a few weeks they\'ll start landing more precisely.',
        )}
      </div>

      ${installList}
      ${platformBlock}
      ${scheduledBlock}

      <div class="mb-12">
        <h2 class="font-serif text-xl text-ink-900 mb-3">${t('Næste skridt', 'Next step')}</h2>
        <p class="text-ink-700 text-lg leading-relaxed mb-4">
          ${t(
            'Åbn Claude Code og skriv <code class="font-mono text-base bg-paper-100 px-1.5 py-0.5 rounded">/dearuser-collab</code>. Så sender jeg mit første brev om hvordan du og din agent arbejder sammen.',
            'Open Claude Code and type <code class="font-mono text-base bg-paper-100 px-1.5 py-0.5 rounded">/dearuser-collab</code>. Then I\'ll send my first letter about how you and your agent are working together.',
          )}
        </p>
      </div>

      <div class="flex justify-between items-center pt-8 border-t border-paper-200">
        <a href="/" class="text-ink-500 hover:text-ink-900 transition">${t('← Forsiden', '← Home')}</a>
        <div class="opacity-80">${signature()}</div>
      </div>
    </section>
  `;

  return page('Onboarding complete', body, 'oversigt');
}

// ============================================================================
// Hono app + server
// ============================================================================

// ============================================================================
// Wrapped — top-level viral snapshot page. Not a letter, not a diagnostic.
// Always shows the latest wrapped run, full-bleed, with the same visual as
// the public share page (dearuser.ai/r/<token>). Empty state nudges the
// user to run `dearuser wrapped` from their terminal.
// ============================================================================

function renderWrappedPage(): string {
  const latest = getRecentRuns(100).find((r: any) => r.tool_name === 'wrapped' && r.report_json);

  if (!latest) {
    return page('Wrapped', `
      <section class="max-w-xl mx-auto text-center py-16">
        <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-6">
          <span class="lang-da">Intet Wrapped endnu</span><span class="lang-en">No Wrapped yet</span>
        </h1>
        <p class="font-serif text-xl text-ink-700 leading-snug mb-8">
          <span class="lang-da">Åbn Claude Code og bed mig lave dit første Wrapped — et delbart snapshot af din collaboration.</span>
          <span class="lang-en">Open Claude Code and ask me to make your first Wrapped — a shareable snapshot of your collaboration.</span>
        </p>
        <code class="inline-block bg-paper-100 border border-paper-200 rounded-lg px-4 py-3 font-mono text-sm text-ink-900">dearuser wrapped</code>
      </section>
    `, 'wrapped');
  }

  let report: any = null;
  try {
    report = JSON.parse(latest.report_json);
  } catch {
    return page('Wrapped', `
      <section class="max-w-xl mx-auto text-center py-16">
        <p class="text-ink-500"><span class="lang-da">Kunne ikke læse dit seneste Wrapped.</span><span class="lang-en">Could not read your latest Wrapped.</span></p>
      </section>
    `, 'wrapped');
  }

  const score = typeof report?.collaborationScore === 'number' ? report.collaborationScore : null;
  const year = new Date(latest.started_at || Date.now()).getFullYear();

  // userArchetype fallback — if the stored wrapped data predates the
  // userArchetype field (old report_json), run the detector live against
  // current preferences. Mirrors the letter/profile fallback so all three
  // surfaces render identically even for older runs.
  const wrappedData = report?.wrapped || {};
  if (!wrappedData.userArchetype) {
    const live = detectUserArchetype(getPreferences());
    if (live) {
      wrappedData.userArchetype = {
        name: live.archetypeName,
        description: live.archetypeDescription,
      };
    }
  }

  const wrappedHtml = renderWrappedSlides({
    score,
    year,
    wrapped: wrappedData,
    moments: Array.isArray(report?.wrapped?.moments) ? report.wrapped.moments : undefined,
    setupArchetypeName: report?.archetype?.nameEn || null,
    userName: getUserName() || undefined,
    showShareCta: false, // private dashboard — share button is a separate action
    mode: 'live',
  });

  // Localized strings for the share flow — emitted into the page script as
  // JSON so the client can switch copy without a round-trip. Keeping them
  // server-rendered means the share button works even if the dashboard
  // bilingual toggle is using the currently-hidden class variant.
  const shareLabels = {
    idleDa: 'Del offentligt',
    idleEn: 'Share publicly',
    loadingDa: 'Genererer link…',
    loadingEn: 'Generating link…',
    copiedDa: 'Link kopieret til udklipsholder',
    copiedEn: 'Link copied to clipboard',
    openDa: 'Åbner i ny fane',
    openEn: 'Opening in new tab',
    errorConfigDa: 'Offentlig deling er ikke sat op på denne maskine. Sæt DEARUSER_SUPABASE_URL og DEARUSER_SUPABASE_SERVICE_KEY for at aktivere.',
    errorConfigEn: 'Public sharing is not set up on this machine. Set DEARUSER_SUPABASE_URL and DEARUSER_SUPABASE_SERVICE_KEY to enable it.',
    errorNoReportDa: 'Dit seneste Wrapped har ingen rapport-data — kør `dearuser wrapped` igen.',
    errorNoReportEn: 'Your latest Wrapped has no report data — run `dearuser wrapped` again.',
    errorGenericDa: 'Kunne ikke oprette link',
    errorGenericEn: 'Could not create link',
  };

  return page('Wrapped', `
    <div class="mb-6 flex items-center justify-between">
      <div class="font-mono text-xs uppercase tracking-wider text-ink-400">${t('Seneste Wrapped', 'Latest Wrapped')} · ${t(formatLetterDate(latest.started_at), formatLetterDateEn(latest.started_at))}</div>
      <div class="flex flex-col items-end gap-2">
        <button id="share-wrapped-btn" data-state="idle" class="text-[11px] uppercase tracking-[0.15em] text-ink-500 hover:text-accent-600 transition border border-paper-200 rounded-md px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed">
          <span class="lang-da">${shareLabels.idleDa}</span><span class="lang-en">${shareLabels.idleEn}</span>
        </button>
        <div id="share-wrapped-feedback" class="text-[11px] text-ink-500 max-w-xs text-right hidden"></div>
      </div>
    </div>
    <div class="du-wrapped-fullbleed">${wrappedHtml}</div>
    <style>
      /* Break out of the dashboard's max-w-2xl constraint so slides go full-bleed
         while the header/nav above stays constrained. */
      .du-wrapped-fullbleed {
        margin-left: calc(50% - 50vw);
        margin-right: calc(50% - 50vw);
        width: 100vw;
      }
    </style>
    ${''}
    <script>
      (function() {
        var btn = document.getElementById('share-wrapped-btn');
        var feedback = document.getElementById('share-wrapped-feedback');
        if (!btn) return;
        var L = ${JSON.stringify(shareLabels)};
        var isDanish = document.documentElement.lang !== 'en';

        function setBtnLabel(da, en) {
          btn.innerHTML =
            '<span class="lang-da">' + da + '</span>' +
            '<span class="lang-en">' + en + '</span>';
        }
        function showFeedback(da, en, isError) {
          feedback.classList.remove('hidden');
          feedback.innerHTML =
            '<span class="lang-da">' + da + '</span>' +
            '<span class="lang-en">' + en + '</span>';
          feedback.className = 'text-[11px] max-w-xs text-right ' + (isError ? 'text-red-600' : 'text-ink-500');
        }
        function hideFeedback() {
          feedback.classList.add('hidden');
          feedback.innerHTML = '';
        }

        btn.addEventListener('click', async function() {
          if (btn.disabled) return;
          btn.disabled = true;
          hideFeedback();
          setBtnLabel(L.loadingDa, L.loadingEn);

          try {
            var res = await fetch('/wrapped/share', { method: 'POST' });
            var data = null;
            try { data = await res.json(); } catch (_) {}

            if (!res.ok || !data || !data.url) {
              var msgDa = (data && data.errorDa) || L.errorGenericDa;
              var msgEn = (data && data.errorEn) || L.errorGenericEn;
              showFeedback(msgDa, msgEn, true);
              setBtnLabel(L.idleDa, L.idleEn);
              btn.disabled = false;
              return;
            }

            var url = data.url;
            // Open in new tab + copy to clipboard. Clipboard may reject on
            // non-secure contexts (http://localhost is fine in modern
            // browsers, but fall through silently if it fails).
            window.open(url, '_blank', 'noopener,noreferrer');
            var copied = false;
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
                copied = true;
              }
            } catch (_) { /* non-fatal */ }

            showFeedback(
              (copied ? L.copiedDa : L.openDa) + ': ' + url,
              (copied ? L.copiedEn : L.openEn) + ': ' + url,
              false
            );
            setBtnLabel(L.idleDa, L.idleEn);
            btn.disabled = false;
          } catch (err) {
            showFeedback(L.errorGenericDa, L.errorGenericEn, true);
            setBtnLabel(L.idleDa, L.idleEn);
            btn.disabled = false;
          }
        });
      })();
    </script>
  `, 'wrapped');
}

// ============================================================================
// Profil — user's name, agent's name, detected archetype, preferences.
// Persona doesn't belong on the landing page (it's static once detected) —
// it lives here where you can read what "The System Architect" means and
// update your profile.
// ============================================================================

function renderProfil(): string {
  const prefs = getPreferences();
  const userName = getUserName();
  const latest = getLatestScoresByTool();
  const analyze: any = latest.analyze;
  // Parse the stored report JSON — the row's `report_json` column holds the
  // full AnalysisReport (persona, archetype, categories). Without parsing,
  // `report.persona` is undefined and the archetype tile says "I don't know
  // you yet" even after 30+ collab runs.
  let report: any = null;
  if (analyze?.id) {
    try {
      const row: any = getRunById(analyze.id);
      if (row?.report_json) {
        report = JSON.parse(row.report_json);
      }
    } catch { /* ignore */ }
  }

  // Two archetypes — different taxonomies for You and Me so they read as
  // complementary roles rather than overlapping boxes.
  //
  //   You  — UserArchetypeResult (Venture Builder / Vibe Coder / Indie
  //          Hacker / Craftsman / Team Lead / Explorer). Derived from
  //          onboarding answers. Cached in each report; live-detected as
  //          fallback for users who haven't run collab yet.
  //   Me   — Agent archetype (System Architect / Creative Executor /
  //          Precision Partner / Orchestrator / Research Companion /
  //          Apprentice). Derived from the latest report's persona
  //          detection + mapped onto the agent-side taxonomy.
  const userArch: any = report?.userArchetype || detectUserArchetype(prefs);
  const agentPersona: any = report?.persona || null;
  const agentArch = agentPersona
    ? (() => {
        const mapped = mapPersonaToAgentArchetype(agentPersona.detected);
        const runnerUpMapped = agentPersona.runnerUp
          ? mapPersonaToAgentArchetype(agentPersona.runnerUp)
          : null;
        return {
          archetypeName: mapped.name,
          archetypeDescription: mapped.description,
          // Suppress runner-up when it maps to the same display archetype
          // (e.g. vibe_coder + indie_hacker both map to Creative Executor —
          // don't tell the user "with traits of yourself").
          runnerUpName: runnerUpMapped && runnerUpMapped.id !== mapped.id
            ? runnerUpMapped.name
            : null,
        };
      })()
    : null;

  const cadenceLabel: Record<string, LocalizedString> = {
    daily: { da: 'Hver dag', en: 'Every day' },
    weekly: { da: 'Hver uge', en: 'Every week' },
    'on-demand': { da: 'Når jeg beder om det', en: 'When I ask' },
    event: { da: 'Når der sker noget', en: 'When something happens' },
  };
  const audienceLabel: Record<string, LocalizedString> = {
    self: { da: 'Kun mig selv', en: 'Just me' },
    team: { da: 'Mit team', en: 'My team' },
    customers: { da: 'Mine kunder', en: 'My customers' },
  };
  const autonomyLabel: Record<string, LocalizedString> = {
    auto: { da: 'Arbejd selv', en: 'Work on your own' },
    'ask-risky': { da: 'Spørg ved store eller risikable ting', en: 'Ask on big or risky things' },
    'ask-all': { da: 'Spørg før hver handling', en: 'Ask before every action' },
  };

  const row = (
    label: LocalizedString,
    value: string | LocalizedString | null | undefined,
  ) => {
    const placeholder = `<span class="text-ink-300 italic">${t('Ikke sat', 'Not set')}</span>`;
    const valueHtml = value
      ? (typeof value === 'string' ? escapeHtml(value) : tBi(value))
      : placeholder;
    return `
    <div class="py-5 grid grid-cols-[180px_1fr] gap-6 border-b border-paper-200">
      <div class="text-[11px] uppercase tracking-[0.15em] text-ink-500 pt-1">${tBi(label)}</div>
      <div class="text-ink-900">${valueHtml}</div>
    </div>
  `;
  };

  const userRunnerUpName = userArch?.runnerUp
    ? getUserArchetypeDefinition(userArch.runnerUp).name
    : null;

  const archetypeBlock = renderArchetypePair({
    you: {
      name: userArch?.archetypeName || null,
      description: userArch?.archetypeDescription || null,
      runnerUpName: userRunnerUpName,
      sourceLabel: { da: 'Fra dine svar', en: 'From your answers' },
      emptyState: {
        da: 'Jeg har ikke nok svar endnu. Kør onboarding og fortæl mig hvad du vil opnå, så kan jeg placere dig.',
        en: "I don't have enough answers yet. Run onboarding and tell me what you want to achieve — then I can place you.",
      },
    },
    me: {
      name: agentArch?.archetypeName || null,
      description: agentArch?.archetypeDescription || null,
      runnerUpName: agentArch?.runnerUpName || null,
      sourceLabel: { da: 'Fra seneste rapport', en: 'From the latest report' },
      emptyState: {
        da: 'Jeg kender ikke min egen arketype endnu. Bed mig om en samarbejds-rapport — så kan jeg se mønstre i hvordan jeg er sat op.',
        en: "I don't know my own archetype yet. Ask me for a collaboration report — then I can see patterns in how I'm set up.",
      },
    },
  }).html;

  return page('Profile', `
    ${pageDateStrip()}
    <section>
      <h1 class="font-serif italic text-5xl text-ink-900 leading-tight mb-8">${t('Dig og mig', 'You and me')}</h1>
      <p class="font-serif text-xl text-ink-700 leading-snug max-w-xl">${t(
        'Her er hvad jeg ved om dig, og hvordan vi arbejder sammen. Ret den i din config.json eller kør onboarding igen.',
        'Here is what I know about you, and how we work together. Edit it in your config.json or run onboarding again.',
      )}</p>
    </section>

    <section class="mt-14">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-2">${t('Hvem vi er', 'Who we are')}</h2>
      <div>
        ${row({ da: 'Dit navn', en: 'Your name' }, userName)}
      </div>
    </section>

    ${archetypeBlock}

    <section class="mt-16">
      <h2 class="text-[11px] uppercase tracking-[0.15em] text-ink-500 mb-2">${t('Sådan vil du arbejde', 'How you want to work')}</h2>
      <div>
        ${row({ da: 'Hvad du vil opnå', en: 'What you want to achieve' }, prefs.outcome || prefs.work)}
        ${row({ da: 'Hvor selv skal jeg arbejde', en: 'How independent should I be' }, prefs.autonomy ? autonomyLabel[prefs.autonomy] : null)}
        ${row({ da: 'Hvor ofte skal jeg arbejde', en: 'How often should I work' }, prefs.cadence ? cadenceLabel[prefs.cadence] : null)}
        ${row({ da: 'Hvem ser resultaterne', en: 'Who sees the results' }, prefs.audience ? audienceLabel[prefs.audience] : null)}
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
  app.get('/wrapped', (c) => c.html(renderWrappedPage()));
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
      return c.html(renderOnboardForm(current, { da: 'Skriv dit svar før du går videre.', en: 'Write your answer before you continue.' }));
    }

    try {
      const result = runOnboard({ step, answer, state });
      if (result.done) {
        // runOnboard's stepPlan handles all filesystem writes (config,
        // skills, CLAUDE.md, hooks, shell env) and attaches structured
        // results to the OnboardResult so the done screen can render them.
        return c.html(renderOnboardDone(result));
      }
      return c.html(renderOnboardForm(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reset = runOnboard({});
      return c.html(renderOnboardForm(reset, {
        da: `Noget gik galt: ${msg}. Vi starter forfra.`,
        en: `Something went wrong: ${msg}. Starting over.`,
      }));
    }
  });

  // Share a letter (collab / security / health) publicly. Reads the run by
  // id from the local DB, derives report_type from tool_name, anonymizes via
  // runShareReport (same pipeline as /wrapped/share). Returns { url, token }
  // on success; { errorDa, errorEn } on failure so the button can render a
  // localized message. Never echoes the service key.
  app.post('/r/:id/share', async (c) => {
    const id = c.req.param('id');
    const run = getRunById(id);
    if (!run || !run.report_json) {
      return c.json({
        errorDa: 'Denne rapport findes ikke eller har ingen data at dele.',
        errorEn: 'This report does not exist or has no data to share.',
      }, 404);
    }

    const tool = (run.tool_name || '').toString();
    const reportType: 'collab' | 'security' | 'health' | null =
      tool === 'collab' || tool === 'analyze' ? 'collab'
      : tool === 'security' ? 'security'
      : tool === 'health' || tool === 'system-health' || tool === 'audit' ? 'health'
      : null;
    if (!reportType) {
      return c.json({
        errorDa: 'Denne rapport-type kan ikke deles endnu.',
        errorEn: 'This report type cannot be shared yet.',
      }, 422);
    }

    let report: any = null;
    try {
      report = JSON.parse(run.report_json);
    } catch {
      return c.json({
        errorDa: 'Rapporten har ingen læsbar data.',
        errorEn: 'The report has no readable data.',
      }, 422);
    }
    if (!report || typeof report !== 'object') {
      return c.json({
        errorDa: 'Rapporten har ingen data.',
        errorEn: 'The report has no data.',
      }, 422);
    }

    // Env/config check — same resolution order as /wrapped/share so the
    // banner only fires when both process.env and ~/.dearuser/config.json
    // are empty.
    const hasEnv =
      (process.env.DEARUSER_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.DEARUSER_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
    let hasConfig = false;
    if (!hasEnv) {
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        const p = path.join(os.homedir(), '.dearuser', 'config.json');
        if (fs.existsSync(p)) {
          const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
          hasConfig = !!(cfg?.tokens?.supabase_url && cfg?.tokens?.supabase_service_key);
        }
      } catch { /* ignore */ }
    }
    if (!hasEnv && !hasConfig) {
      return c.json({
        errorDa: 'Offentlig deling er ikke sat op på denne maskine. Sæt DEARUSER_SUPABASE_URL og DEARUSER_SUPABASE_SERVICE_KEY for at aktivere.',
        errorEn: 'Public sharing is not set up on this machine. Set DEARUSER_SUPABASE_URL and DEARUSER_SUPABASE_SERVICE_KEY to enable it.',
      }, 503);
    }

    try {
      const result = await runShareReport({
        report_type: reportType,
        report_json: report,
      });
      return c.json({ url: result.url, token: result.token });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const safeMsg = msg
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/apikey[\s=:]+\S+/gi, 'apikey [redacted]')
        .slice(0, 240);
      console.error(`[dashboard] /r/${id}/share failed:`, safeMsg);
      return c.json({
        errorDa: 'Kunne ikke oprette offentligt link. Prøv igen eller tjek serverlog.',
        errorEn: 'Could not create public link. Try again or check the server log.',
      }, 502);
    }
  });

  // Share the latest Wrapped publicly. Reads the most recent wrapped run
  // from the local DB, runs it through the anonymizer, and uploads to the
  // shared Supabase. Returns { url, token } on success; { errorDa, errorEn }
  // on failure so the button can render a localized message.
  //
  // Never echoes the service key — we only surface env-missing vs upload
  // failure vs no-report. If the key is malformed, the Supabase REST call
  // throws with its own (non-secret) body, which we pass through truncated.
  app.post('/wrapped/share', async (c) => {
    const latest = getRecentRuns(100).find((r: any) => r.tool_name === 'wrapped' && r.report_json);
    if (!latest) {
      return c.json({
        errorDa: 'Intet Wrapped at dele — kør `dearuser wrapped` først.',
        errorEn: 'No Wrapped to share — run `dearuser wrapped` first.',
      }, 404);
    }

    let report: any = null;
    try {
      report = JSON.parse(latest.report_json);
    } catch {
      return c.json({
        errorDa: 'Dit seneste Wrapped har ingen læsbar rapport-data.',
        errorEn: 'Your latest Wrapped has no readable report data.',
      }, 422);
    }
    if (!report || typeof report !== 'object') {
      return c.json({
        errorDa: 'Dit seneste Wrapped har ingen rapport-data.',
        errorEn: 'Your latest Wrapped has no report data.',
      }, 422);
    }

    // Env-missing → 503 with friendly message. Checks both process.env and
    // ~/.dearuser/config.json (same resolution order as share.ts) so the
    // banner only fires when BOTH paths are truly empty.
    const hasEnv =
      (process.env.DEARUSER_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.DEARUSER_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
    let hasConfig = false;
    if (!hasEnv) {
      try {
        const fs = require('node:fs');
        const path = require('node:path');
        const os = require('node:os');
        const p = path.join(os.homedir(), '.dearuser', 'config.json');
        if (fs.existsSync(p)) {
          const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));
          hasConfig = !!(cfg?.tokens?.supabase_url && cfg?.tokens?.supabase_service_key);
        }
      } catch { /* ignore */ }
    }
    if (!hasEnv && !hasConfig) {
      return c.json({
        errorDa: 'Offentlig deling er ikke sat op på denne maskine. Sæt DEARUSER_SUPABASE_URL og DEARUSER_SUPABASE_SERVICE_KEY for at aktivere.',
        errorEn: 'Public sharing is not set up on this machine. Set DEARUSER_SUPABASE_URL and DEARUSER_SUPABASE_SERVICE_KEY to enable it.',
      }, 503);
    }

    try {
      const result = await runShareReport({
        report_type: 'wrapped',
        report_json: report,
      });
      return c.json({ url: result.url, token: result.token });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Don't leak the service key shape — err.message from insertSharedReport
      // already truncates Supabase body to 200 chars and never includes the
      // Authorization header. We still scrub any stray sk_ / Bearer prefix
      // defensively.
      const safeMsg = msg
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/apikey[\s=:]+\S+/gi, 'apikey [redacted]')
        .slice(0, 240);
      console.error('[dashboard] /wrapped/share failed:', safeMsg);
      return c.json({
        errorDa: 'Kunne ikke oprette offentligt link. Prøv igen eller tjek serverlog.',
        errorEn: 'Could not create public link. Try again or check the server log.',
      }, 502);
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
