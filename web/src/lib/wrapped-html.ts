// Shared Wrapped HTML renderer — single source of truth for the pretty
// web version of Dear User Wrapped.
//
// Consumed by:
//   - web/src/components/WrappedCard.astro (dearuser.ai/r/<token> share page)
//   - mcp/src/dashboard.ts (localhost:7700 Letters tab)
//
// The two surfaces differ only in their outer layout chrome. The inner
// Wrapped card visual must be identical, hence this shared module.
//
// Returns a single HTML fragment string that includes its own scoped
// <style> block. Callers drop it inside whatever layout they use. No
// framework imports — pure string concatenation so both Astro (Vite) and
// Hono (esbuild) can consume it without special config.

export interface WrappedHtmlInput {
  score: number | null;
  year: number;
  projectName?: string;
  /** Data directly from report.wrapped (AnalysisReport.wrapped). */
  wrapped: {
    headlineStat?: { value?: string; label?: string };
    topLesson?: { quote?: string; context?: string } | null;
    autonomySplit?: { doSelf?: number; askFirst?: number; suggest?: number };
    archetype?: { name?: string; traits?: string[]; description?: string };
    systemGrid?: { hooks?: number; skills?: number; scheduled?: number; rules?: number };
    shareCard?: {
      corrections?: number;
      memories?: number;
      projects?: number;
      prohibitionRatio?: string;
    };
    moments?: Array<{
      id?: string;
      value?: string;
      label?: string;
      narrative?: string;
      detail?: string;
    }>;
    percentile?: {
      score?: number;
      percentile?: number;
      topPercent?: number;
      corpusSize?: number;
    } | null;
    contrast?: {
      strongest?: { key?: string; name?: string; score?: number };
      weakest?: { key?: string; name?: string; score?: number };
    };
  };
  /** Setup archetype name (from report.archetype.nameEn) — optional. */
  setupArchetypeName?: string | null;
  /** If set, renders the "Share yours at dearuser.ai" CTA at the bottom. */
  showShareCta?: boolean;
}

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Render the Wrapped card as a self-contained HTML fragment. Scoped via a
 * root `.du-wrapped` class so the styles don't leak. Both surfaces drop it
 * into their own outer layout.
 */
export function renderWrappedHtml(input: WrappedHtmlInput): string {
  const score = input.score;
  const year = input.year;
  const w = input.wrapped || {};
  const headline = w.headlineStat?.label || '';
  const archetype = w.archetype || {};
  const split = w.autonomySplit || {};
  const grid = w.systemGrid || {};
  const sc = w.shareCard || {};
  const lesson = w.topLesson || null;
  const setupArchetype = input.setupArchetypeName || '';

  const splitRows = [
    { label: 'Do yourself', pct: pct(split.doSelf) },
    { label: 'Ask first', pct: pct(split.askFirst) },
    { label: 'Suggest only', pct: pct(split.suggest) },
  ].sort((a, b) => b.pct - a.pct);

  const gridCells = [
    { value: grid.skills ?? 0, label: 'Skills' },
    { value: grid.hooks ?? 0, label: 'Hooks' },
    { value: grid.scheduled ?? 0, label: 'Scheduled' },
    { value: grid.rules ?? 0, label: 'Rules' },
  ];

  const byNumbers: Array<{ value: string | number; label: string }> = [];
  if (typeof sc.corrections === 'number') byNumbers.push({ value: sc.corrections, label: 'course-corrections remembered' });
  if (typeof sc.memories === 'number') byNumbers.push({ value: sc.memories, label: 'memories built up' });
  if (typeof sc.projects === 'number') byNumbers.push({ value: sc.projects, label: 'projects managed' });
  if (sc.prohibitionRatio) byNumbers.push({ value: sc.prohibitionRatio, label: "of your rules are DON'Ts" });

  const splitHtml = splitRows.map(r => `
    <div class="du-wrapped-split-row">
      <span class="du-wrapped-split-label">${h(r.label)}</span>
      <span class="du-wrapped-split-bar"><span class="du-wrapped-split-fill" style="width: ${r.pct}%"></span></span>
      <span class="du-wrapped-split-pct">${r.pct}%</span>
    </div>
  `).join('');

  const gridHtml = gridCells.map(c => `
    <div class="du-wrapped-grid-cell">
      <div class="du-wrapped-grid-value">${h(c.value)}</div>
      <div class="du-wrapped-grid-label">${h(c.label)}</div>
    </div>
  `).join('');

  const numbersHtml = byNumbers.length
    ? `<section class="du-wrapped-section">
         <h2 class="du-wrapped-h2">By the numbers</h2>
         <div class="du-wrapped-numbers">
           ${byNumbers.map(n => `
             <div class="du-wrapped-num-row">
               <div class="du-wrapped-num-value">${h(n.value)}</div>
               <div class="du-wrapped-num-label">${h(n.label)}</div>
             </div>
           `).join('')}
         </div>
       </section>`
    : '';

  const moments = Array.isArray(w.moments) ? w.moments.filter(m => m && (m.value || m.narrative)) : [];
  const momentsHtml = moments.length
    ? `<section class="du-wrapped-section du-wrapped-moments-section">
         <h2 class="du-wrapped-h2">Your year in moments</h2>
         <div class="du-wrapped-moments">
           ${moments.map(m => `
             <article class="du-wrapped-moment">
               <div class="du-wrapped-moment-head">
                 <div class="du-wrapped-moment-value">${h(m.value || '')}</div>
                 <div class="du-wrapped-moment-label">${h(m.label || '')}</div>
               </div>
               ${m.narrative ? `<p class="du-wrapped-moment-narrative">${h(m.narrative)}</p>` : ''}
               ${m.detail ? `<p class="du-wrapped-moment-detail">${h(m.detail)}</p>` : ''}
             </article>
           `).join('')}
         </div>
       </section>`
    : '';

  const lessonHtml = lesson && lesson.quote
    ? `<section class="du-wrapped-section du-wrapped-lesson">
         <div class="du-wrapped-lesson-eyebrow">Most repeated lesson</div>
         <blockquote class="du-wrapped-lesson-quote">${h(lesson.quote)}</blockquote>
         ${lesson.context ? `<div class="du-wrapped-lesson-context">${h(lesson.context)}</div>` : ''}
       </section>`
    : '';

  const archetypeHtml = archetype.name
    ? `<section class="du-wrapped-archetype">
         <div class="du-wrapped-archetype-label">Agent archetype</div>
         <div class="du-wrapped-archetype-name">${h(archetype.name)}</div>
         ${Array.isArray(archetype.traits) && archetype.traits.length > 0
           ? `<div class="du-wrapped-archetype-traits">
                ${archetype.traits.slice(0, 4).map((tr) =>
                  `<span class="du-wrapped-trait">${h(tr)}</span>`
                ).join('')}
              </div>`
           : ''}
         ${setupArchetype ? `<div class="du-wrapped-archetype-setup">Setup style · <span>${h(setupArchetype)}</span></div>` : ''}
       </section>`
    : '';

  const ctaHtml = input.showShareCta
    ? `<div class="du-wrapped-cta">
         <a class="du-wrapped-cta-btn" href="https://dearuser.ai/">Share yours at dearuser.ai →</a>
       </div>`
    : '';

  const projectLineHtml = input.projectName
    ? `<div class="du-wrapped-project"><span class="du-wrapped-project-label">Setup</span><span class="du-wrapped-project-name">${h(input.projectName)}</span></div>`
    : '';

  return `
<style>
${WRAPPED_CSS}
</style>
<section class="du-wrapped">
  <div class="du-wrapped-eyebrow">
    <span class="du-wrapped-eyebrow-brand">Dear User · Wrapped</span>
    <span class="du-wrapped-eyebrow-sep">·</span>
    <span>${h(year)}</span>
  </div>

  <div class="du-wrapped-hero">
    <div class="du-wrapped-hero-score">${score !== null && score !== undefined ? h(score) : '—'}</div>
    <div class="du-wrapped-hero-sub">OUT OF 100</div>
    ${headline ? `<div class="du-wrapped-hero-headline">${h(headline)}</div>` : ''}
  </div>

  ${projectLineHtml}
  ${archetypeHtml}

  <section class="du-wrapped-section">
    <h2 class="du-wrapped-h2">How you split the work</h2>
    <div class="du-wrapped-split">${splitHtml}</div>
  </section>

  <section class="du-wrapped-section">
    <h2 class="du-wrapped-h2">The system you built</h2>
    <div class="du-wrapped-grid">${gridHtml}</div>
  </section>

  ${numbersHtml}
  ${momentsHtml}
  ${lessonHtml}
  ${ctaHtml}
</section>
  `.trim();
}

// Single source of truth for Wrapped styling. Scoped under .du-wrapped.
// Token names match the brand palette. When tokens are missing (e.g. the
// dashboard's stylesheet defines --color-* instead of --c-*), we provide
// literal fallbacks so the card still looks right.
const WRAPPED_CSS = `
  .du-wrapped {
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 24px 80px;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif;
  }

  .du-wrapped-eyebrow {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--c-ink-400, #999);
    margin-bottom: 20px;
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .du-wrapped-eyebrow-brand { color: var(--c-action-600, #ec5329); font-weight: 600; }
  .du-wrapped-eyebrow-sep { color: var(--c-ink-400, #999); }

  .du-wrapped-hero {
    background: linear-gradient(135deg, var(--c-action-600, #ec5329) 0%, #c8401f 100%);
    color: var(--c-paper-50, #faf8f4);
    border-radius: 20px;
    padding: 48px 32px 40px;
    text-align: center;
    margin-bottom: 28px;
    box-shadow: 0 12px 48px rgba(236, 83, 41, 0.22);
  }
  .du-wrapped-hero-score {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 600;
    font-size: clamp(96px, 18vw, 160px);
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--c-paper-50, #faf8f4);
  }
  .du-wrapped-hero-sub {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.18em;
    opacity: 0.85;
    margin-top: 8px;
    text-transform: uppercase;
  }
  .du-wrapped-hero-headline {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-size: clamp(16px, 2.4vw, 19px);
    margin-top: 18px;
    opacity: 0.95;
  }

  .du-wrapped-project {
    display: flex;
    gap: 10px;
    font-size: 13px;
    color: var(--c-ink-500, #666);
    margin-bottom: 24px;
  }
  .du-wrapped-project-label { font-family: 'Geist Mono', ui-monospace, monospace; letter-spacing: 0.12em; text-transform: uppercase; }
  .du-wrapped-project-name { color: var(--c-ink-900, #222); font-weight: 500; }

  .du-wrapped-archetype {
    margin: 0 0 32px;
  }
  .du-wrapped-archetype-label {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--c-ink-500, #666);
    margin-bottom: 8px;
  }
  .du-wrapped-archetype-name {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 24px;
    color: var(--c-ink-900, #222);
    margin-bottom: 10px;
  }
  .du-wrapped-archetype-traits {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .du-wrapped-trait {
    font-size: 12px;
    padding: 3px 9px;
    background: var(--c-paper-100, #f5f2ec);
    border: 1px solid var(--c-paper-200, #e7e2d9);
    border-radius: 4px;
    color: var(--c-ink-700, #444);
  }
  .du-wrapped-archetype-setup {
    margin-top: 10px;
    font-size: 13px;
    color: var(--c-ink-500, #666);
  }
  .du-wrapped-archetype-setup span { color: var(--c-ink-900, #222); font-weight: 500; }

  .du-wrapped-section { margin: 0 0 32px; }
  .du-wrapped-h2 {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--c-ink-500, #666);
    margin: 0 0 16px;
  }

  .du-wrapped-split {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .du-wrapped-split-row {
    display: grid;
    grid-template-columns: 120px 1fr 48px;
    gap: 12px;
    align-items: center;
  }
  .du-wrapped-split-label {
    font-size: 14px;
    color: var(--c-ink-700, #444);
  }
  .du-wrapped-split-bar {
    display: block;
    height: 10px;
    background: var(--c-paper-200, #e7e2d9);
    border-radius: 5px;
    overflow: hidden;
  }
  .du-wrapped-split-fill {
    display: block;
    height: 100%;
    background: var(--c-action-600, #ec5329);
    transition: width 0.3s ease;
  }
  .du-wrapped-split-pct {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 13px;
    text-align: right;
    color: var(--c-ink-900, #222);
  }

  .du-wrapped-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }
  @media (max-width: 600px) { .du-wrapped-grid { grid-template-columns: repeat(2, 1fr); } }
  .du-wrapped-grid-cell {
    background: var(--c-paper-50, #faf8f4);
    border: 1px solid var(--c-paper-200, #e7e2d9);
    border-radius: 12px;
    padding: 20px 12px;
    text-align: center;
  }
  .du-wrapped-grid-value {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 600;
    font-size: 36px;
    color: var(--c-ink-900, #222);
    line-height: 1;
  }
  .du-wrapped-grid-label {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--c-ink-500, #666);
    margin-top: 6px;
  }

  .du-wrapped-numbers {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .du-wrapped-num-row {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 16px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--c-paper-200, #e7e2d9);
    align-items: baseline;
  }
  .du-wrapped-num-value {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 600;
    font-size: 26px;
    color: var(--c-ink-900, #222);
  }
  .du-wrapped-num-label {
    font-size: 14px;
    color: var(--c-ink-700, #444);
  }

  .du-wrapped-moments {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .du-wrapped-moment {
    background: var(--c-paper-50, #faf8f4);
    border: 1px solid var(--c-paper-200, #e7e2d9);
    border-radius: 14px;
    padding: 20px 22px;
  }
  .du-wrapped-moment-head {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .du-wrapped-moment-value {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 600;
    font-size: 28px;
    color: var(--c-action-600, #ec5329);
    line-height: 1;
  }
  .du-wrapped-moment-label {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--c-ink-500, #666);
  }
  .du-wrapped-moment-narrative {
    font-size: 15px;
    line-height: 1.5;
    color: var(--c-ink-900, #222);
    margin: 0 0 6px;
  }
  .du-wrapped-moment-detail {
    font-size: 13px;
    color: var(--c-ink-500, #666);
    margin: 0;
    font-style: italic;
  }

  .du-wrapped-lesson {
    background: var(--c-paper-50, #faf8f4);
    border: 1px solid var(--c-paper-200, #e7e2d9);
    border-radius: 16px;
    padding: 24px 28px;
  }
  .du-wrapped-lesson-eyebrow {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--c-ink-500, #666);
    margin-bottom: 12px;
  }
  .du-wrapped-lesson-quote {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-size: 20px;
    color: var(--c-ink-900, #222);
    margin: 0 0 8px;
    line-height: 1.35;
    border-left: 2px solid var(--c-action-600, #ec5329);
    padding-left: 16px;
  }
  .du-wrapped-lesson-context {
    font-size: 13px;
    color: var(--c-ink-500, #666);
    padding-left: 16px;
  }

  .du-wrapped-cta {
    margin-top: 40px;
    text-align: center;
  }
  .du-wrapped-cta-btn {
    display: inline-block;
    background: var(--c-action-600, #ec5329);
    color: var(--c-paper-50, #faf8f4);
    padding: 12px 22px;
    border-radius: 10px;
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;
    box-shadow: 0 6px 18px rgba(236, 83, 41, 0.18);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .du-wrapped-cta-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 8px 22px rgba(236, 83, 41, 0.25);
  }
`;
