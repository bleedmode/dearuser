// Shared Wrapped SLIDES renderer — single source of truth for the scroll-
// through Spotify-Wrapped-style experience.
//
// Consumed by:
//   - web/src/pages/demo.astro (dearuser.ai/demo sample)
//   - web/src/components/WrappedCard.astro (dearuser.ai/r/<token> share page)
//   - mcp/src/dashboard.ts (localhost:7700/wrapped)
//
// All three surfaces share the same 10-12 slide deck: intro → hero → archetype
// → autonomy split → moments (percentile, corrections, dead skill, longest
// rule) → system grid → lesson → outro. Missing data = skipped slide.
//
// Returns a self-contained HTML fragment with scoped <style> + <script>.
// Outer layout stays with each surface; the slides render inline.

import { renderArchetypePair, ARCHETYPE_PAIR_CSS } from './archetype-pair.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WrappedMomentInput {
  id?: string;
  value?: string;
  label?: string;
  narrative?: string;
  detail?: string;
}

export interface WrappedDataInput {
  headlineStat?: { value?: string; label?: string };
  topLesson?: { quote?: string; context?: string } | null;
  autonomySplit?: { doSelf?: number; askFirst?: number; suggest?: number };
  /** Agent archetype display (Creative Executor, System Architect, ...).
   *  Derived from the MCP's persona-detector via mapPersonaToAgentArchetype
   *  and passed through here so slides don't have to know the mapping. */
  archetype?: { name?: string; traits?: string[]; description?: string };
  /** User archetype from onboarding (Venture Builder, Vibe Coder, ...).
   *  Rendered alongside the agent archetype in the "You and me" slide. */
  userArchetype?: { name?: string; description?: string } | null;
  systemGrid?: { hooks?: number; skills?: number; scheduled?: number; rules?: number };
  shareCard?: {
    corrections?: number;
    memories?: number;
    projects?: number;
    prohibitionRatio?: string;
  };
  moments?: WrappedMomentInput[];
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
}

export interface WrappedSlidesInput {
  score: number | null;
  year: number;
  /** First name — "Jarl", "Alex" — used in greeting slides. */
  userName?: string;
  projectName?: string;
  wrapped: WrappedDataInput;
  /** Moments (mined in mcp/src/engine/wrapped-moments.ts). Falls back to wrapped.moments. */
  moments?: WrappedMomentInput[];
  setupArchetypeName?: string | null;
  showShareCta?: boolean;
  /** Copy variant for the outro CTA — 'live' (dashboard), 'sample' (demo), 'shared' (/r/). */
  mode?: 'live' | 'sample' | 'shared';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampPct(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function findMoment(moments: WrappedMomentInput[], id: string): WrappedMomentInput | null {
  for (const m of moments) {
    if (m && m.id === id) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public renderer
// ---------------------------------------------------------------------------

export function renderWrappedSlides(input: WrappedSlidesInput): string {
  const {
    score,
    year,
    userName,
    wrapped: w,
    setupArchetypeName,
    mode = 'live',
  } = input;

  const moments: WrappedMomentInput[] = (
    Array.isArray(input.moments) && input.moments.length > 0
      ? input.moments
      : Array.isArray(w.moments) ? w.moments : []
  ).filter((m): m is WrappedMomentInput => Boolean(m && (m.value || m.narrative)));

  const archetype = w.archetype || {};
  const userArchetype = w.userArchetype || null;
  const split = w.autonomySplit || {};
  const grid = w.systemGrid || {};
  const lesson = w.topLesson || null;

  const percentileMoment = findMoment(moments, 'percentile');
  const correctionsMoment = findMoment(moments, 'corrections');
  const deadSkillMoment = findMoment(moments, 'dead-skills');
  const biggestRuleMoment = findMoment(moments, 'biggest-rule');

  const splits = [
    { labelEn: 'Do it yourself', labelDa: 'Gør det selv', pct: clampPct(split.doSelf), cls: 'terracotta' },
    { labelEn: 'Ask first', labelDa: 'Spørg først', pct: clampPct(split.askFirst), cls: 'warm' },
    { labelEn: 'Suggest only', labelDa: 'Kun foreslå', pct: clampPct(split.suggest), cls: 'ink' },
  ];

  const gridCells = [
    { value: grid.skills ?? 0, labelEn: 'Skills', labelDa: 'Skills' },
    { value: grid.hooks ?? 0, labelEn: 'Hooks', labelDa: 'Hooks' },
    { value: grid.scheduled ?? 0, labelEn: 'Scheduled', labelDa: 'Planlagte' },
    { value: grid.rules ?? 0, labelEn: 'Rules', labelDa: 'Regler' },
  ];

  // ------------------------------------------------------------------
  // Slides
  // ------------------------------------------------------------------
  const slides: string[] = [];

  // Slide 1 — Intro
  const greetingEn = userName ? `In numbers, ${h(userName)}` : 'In numbers, from a <span class="du-slide-accent">friend</span>';
  const greetingDa = userName ? `I tal, ${h(userName)}` : 'I tal, fra en <span class="du-slide-accent">ven</span>';
  slides.push(`
    <section class="du-slide du-slide-intro visible" data-du-slide>
      <div class="du-slide-eyebrow">
        <span class="lang-da">Dit AI-samarbejde · ${h(year)}</span><span class="lang-en">Your AI collaboration · ${h(year)}</span>
      </div>
      <h1 class="du-slide-h1">
        <span class="lang-da">${greetingDa}.</span>
        <span class="lang-en">${greetingEn}.</span>
      </h1>
      <p class="du-slide-subtitle">
        <span class="lang-da">En scrolltur gennem et halvt års arbejde med din agent.</span>
        <span class="lang-en">A scroll-through of six months of work with your agent.</span>
      </p>
      <div class="du-scroll-hint">
        <span class="lang-da">Scroll ↓</span><span class="lang-en">Scroll ↓</span>
      </div>
    </section>
  `);

  // Slide 2 — Hero score
  // Note: we deliberately do NOT render w.headlineStat.label here. That text
  // belongs to the corrections stat and has its own slide via correctionsMoment.
  // Dumping it under the score produced a misleading "95 / out of 100 / times
  // your agent was corrected" read, where the caption looked like it described
  // the 95.
  if (score !== null && score !== undefined) {
    slides.push(`
      <section class="du-slide du-slide-score" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Din score</span><span class="lang-en">Your score</span>
        </div>
        <div class="du-slide-big-number" data-du-count="${h(score)}">0</div>
        <div class="du-slide-score-sub">
          <span class="lang-da">ud af 100</span><span class="lang-en">out of 100</span>
        </div>
      </section>
    `);
  }

  // Slide 3 — "You and me" archetype pair. Uses the shared renderer so all
  // four surfaces (profile / letter / share / wrapped) render identical
  // markup; Wrapped just requests the 'slide' variant for larger type.
  if (userArchetype?.name || archetype.name) {
    const pairHtml = renderArchetypePair({
      showHeading: false,
      variant: 'slide',
      you: {
        name: userArchetype?.name || null,
        description: userArchetype?.description || null,
        emptyState: { da: 'Ikke placeret endnu.', en: 'Not placed yet.' },
      },
      me: {
        name: archetype.name || null,
        description: archetype.description || null,
        emptyState: { da: 'Stadig lærende.', en: 'Still learning.' },
      },
    }).html;
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Dig og mig</span><span class="lang-en">You and me</span>
        </div>
        ${pairHtml}
        ${setupArchetypeName ? `<div class="du-slide-setup-style"><span class="lang-da">Setup-stil</span><span class="lang-en">Setup style</span> · ${h(setupArchetypeName)}</div>` : ''}
      </section>
    `);
  }

  // Slide 4 — Autonomy split
  const splitTotal = splits.reduce((a, b) => a + b.pct, 0);
  if (splitTotal > 0) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Autonomi-fordeling</span><span class="lang-en">Autonomy split</span>
        </div>
        <p class="du-slide-big-label" style="margin-top:0;">
          <span class="lang-da">Hvor meget frihed har din agent?</span>
          <span class="lang-en">How much freedom does your agent have?</span>
        </p>
        <div class="du-slide-bars">
          ${splits.map(s => `
            <div class="du-slide-bar-row">
              <div class="du-slide-bar-head">
                <span>
                  <span class="lang-da">${h(s.labelDa)}</span><span class="lang-en">${h(s.labelEn)}</span>
                </span>
                <span class="du-slide-bar-pct">${s.pct} %</span>
              </div>
              <div class="du-slide-bar-track"><div class="du-slide-bar-fill ${s.cls}" data-du-width="${s.pct}"></div></div>
            </div>
          `).join('')}
        </div>
      </section>
    `);
  }

  // Slide 5 — Percentile moment
  if (percentileMoment) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Hvor du står</span><span class="lang-en">Where you rank</span>
        </div>
        <div class="du-slide-big-number good">${h(percentileMoment.value || '')}</div>
        <p class="du-slide-big-label">${h(percentileMoment.narrative || '')}</p>
        ${percentileMoment.detail ? `<p class="du-slide-detail">${h(percentileMoment.detail)}</p>` : ''}
      </section>
    `);
  }

  // Slide 6 — Corrections moment
  if (correctionsMoment) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow muted">
          <span class="lang-da">Rettelser</span><span class="lang-en">Corrections</span>
        </div>
        <div class="du-slide-big-number" data-du-count="${h(correctionsMoment.value || '0')}">0</div>
        <p class="du-slide-big-label">${h(correctionsMoment.narrative || '')}</p>
      </section>
    `);
  }

  // Slide 7 — Dead skill moment
  if (deadSkillMoment) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow muted">
          <span class="lang-da">Ubrugte skills</span><span class="lang-en">Dead skills</span>
        </div>
        <div class="du-slide-big-number bad" data-du-count="${h(deadSkillMoment.value || '0')}">0</div>
        <p class="du-slide-big-label">${h(deadSkillMoment.narrative || '')}</p>
        ${deadSkillMoment.detail ? `<p class="du-slide-detail">${h(deadSkillMoment.detail)}</p>` : ''}
      </section>
    `);
  }

  // Slide 8 — Longest rule moment
  if (biggestRuleMoment) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Din længste regel</span><span class="lang-en">Your longest rule</span>
        </div>
        <div class="du-slide-big-number ink">${h(biggestRuleMoment.value || '')}</div>
        <p class="du-slide-big-label">${h(biggestRuleMoment.narrative || '')}</p>
        ${biggestRuleMoment.detail ? `<p class="du-slide-detail">${h(biggestRuleMoment.detail)}</p>` : ''}
      </section>
    `);
  }

  // Slide 9 — System grid
  const hasSystem = gridCells.some(c => Number(c.value) > 0);
  if (hasSystem) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Systemet du har bygget</span><span class="lang-en">The system you built</span>
        </div>
        <p class="du-slide-big-label" style="margin-top:0;">
          <span class="lang-da">Din agent eksekverer ikke bare — den kører et lille OS.</span>
          <span class="lang-en">Your agent doesn't just execute — it runs a small OS.</span>
        </p>
        <div class="du-slide-system-grid">
          ${gridCells.map(c => `
            <div class="du-slide-system-card">
              <div class="du-slide-system-num" data-du-count="${h(c.value)}">0</div>
              <div class="du-slide-system-label">
                <span class="lang-da">${h(c.labelDa)}</span><span class="lang-en">${h(c.labelEn)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    `);
  }

  // Slide 10 — Top lesson
  if (lesson && lesson.quote) {
    slides.push(`
      <section class="du-slide" data-du-slide>
        <div class="du-slide-eyebrow">
          <span class="lang-da">Din agents største lære</span>
          <span class="lang-en">Your agent's #1 lesson</span>
        </div>
        <div class="du-slide-quote">${h(lesson.quote)}</div>
        ${lesson.context ? `<div class="du-slide-quote-attr">— ${h(lesson.context)}</div>` : ''}
      </section>
    `);
  }

  // Slide 11 — Outro / Share CTA
  const ctaEn =
    mode === 'sample' ? 'Want yours? Run it in 30 seconds.' :
    mode === 'shared' ? 'Want yours? Run it in 30 seconds.' :
    'Share yours at dearuser.ai';
  const ctaDa =
    mode === 'sample' ? 'Vil du have dit eget? Kør det på 30 sekunder.' :
    mode === 'shared' ? 'Vil du have dit eget? Kør det på 30 sekunder.' :
    'Del dit eget på dearuser.ai';
  const ctaLink = input.showShareCta !== false;
  slides.push(`
    <section class="du-slide du-slide-outro" data-du-slide>
      <div class="du-slide-eyebrow">
        <span class="lang-da">Tak for i år</span><span class="lang-en">That's your year</span>
      </div>
      <h2 class="du-slide-outro-h2">
        <span class="lang-da">${h(ctaDa)}</span>
        <span class="lang-en">${h(ctaEn)}</span>
      </h2>
      ${ctaLink ? `
        <a class="du-slide-cta-btn" href="https://dearuser.ai/">
          <span class="lang-da">Audit dit eget setup →</span>
          <span class="lang-en">Audit your own setup →</span>
        </a>
      ` : ''}
      <div class="du-slide-end-cta">
        <span class="du-slide-prompt">$</span>
        <span>claude mcp add dearuser -- npx dearuser-mcp</span>
      </div>
    </section>
  `);

  const slidesHtml = slides.join('\n');

  return `
<style>${WRAPPED_SLIDES_CSS}${ARCHETYPE_PAIR_CSS}</style>
<div class="du-slides-stage">
${slidesHtml}
</div>
<script>${WRAPPED_SLIDES_SCRIPT}</script>
  `.trim();
}

// ---------------------------------------------------------------------------
// CSS (scoped under .du-slides-stage / .du-slide)
// ---------------------------------------------------------------------------

const WRAPPED_SLIDES_CSS = `
  .du-slides-stage { width: 100%; }
  .du-slide {
    min-height: calc(100vh - 66px);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    padding: 72px 24px;
    position: relative;
    opacity: 0;
    transform: translateY(28px);
    transition: opacity 0.7s ease, transform 0.7s ease;
  }
  .du-slide.visible { opacity: 1; transform: translateY(0); }

  .du-slide-eyebrow {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--c-action-600, #ec5329);
    margin-bottom: 22px;
  }
  .du-slide-eyebrow.muted { color: var(--c-ink-400, #a69989); }

  .du-slide-intro {
    background: radial-gradient(ellipse at 50% 78%,
      color-mix(in srgb, var(--c-action-600, #ec5329) 18%, transparent) 0%,
      transparent 62%);
  }
  .du-slide-h1 {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-weight: 400;
    font-size: clamp(44px, 9vw, 104px);
    line-height: 1.04;
    letter-spacing: -0.025em;
    color: var(--c-ink-900, #1f1a14);
    margin: 0;
    max-width: 860px;
  }
  .du-slide-accent { color: var(--c-action-600, #ec5329); font-style: italic; }
  .du-slide-subtitle {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(18px, 2.2vw, 22px);
    color: var(--c-ink-700, #3e352a);
    margin-top: 26px;
    max-width: 560px;
    line-height: 1.5;
  }

  .du-scroll-hint {
    position: absolute;
    bottom: 36px;
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--c-ink-400, #a69989);
    animation: du-scroll-bounce 2.2s infinite;
  }
  @keyframes du-scroll-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(8px); }
  }

  .du-slide-big-number {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: clamp(88px, 20vw, 192px);
    line-height: 0.95;
    letter-spacing: -0.04em;
    color: var(--c-action-600, #ec5329);
  }
  .du-slide-big-number.ink { color: var(--c-ink-900, #1f1a14); }
  .du-slide-big-number.good { color: var(--c-good, #059669); }
  .du-slide-big-number.warn { color: var(--c-warn, #fbbf24); }
  .du-slide-big-number.bad { color: var(--c-bad, #be123c); }

  .du-slide-score-sub {
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--c-ink-400, #a69989);
    margin-top: 14px;
  }
  .du-slide-headline {
    font-style: italic;
  }

  .du-slide-big-label {
    font-family: 'Fraunces', Georgia, serif;
    font-size: clamp(18px, 2.3vw, 23px);
    color: var(--c-ink-700, #3e352a);
    margin-top: 26px;
    max-width: 620px;
    line-height: 1.5;
  }
  .du-slide-detail {
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 13px;
    color: var(--c-ink-500, #72655b);
    margin-top: 12px;
    max-width: 540px;
  }

  .du-slide-quote {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-size: clamp(26px, 4.2vw, 44px);
    line-height: 1.3;
    letter-spacing: -0.015em;
    color: var(--c-ink-900, #1f1a14);
    max-width: 780px;
    padding-left: 28px;
    border-left: 4px solid var(--c-action-600, #ec5329);
    text-align: left;
  }
  .du-slide-quote-attr {
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 13px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--c-ink-500, #72655b);
    margin-top: 28px;
    max-width: 780px;
    text-align: left;
    padding-left: 28px;
  }

  .du-slide-bars {
    max-width: 560px;
    width: 100%;
    margin-top: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    text-align: left;
  }
  .du-slide-bar-head {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    color: var(--c-ink-700, #3e352a);
    margin-bottom: 8px;
    font-family: 'Geist', system-ui, sans-serif;
  }
  .du-slide-bar-pct { color: var(--c-ink-900, #1f1a14); font-weight: 600; }
  .du-slide-bar-track {
    height: 8px;
    background: var(--c-paper-200, #efe4cf);
    border-radius: 999px;
    overflow: hidden;
  }
  .du-slide-bar-fill {
    height: 100%;
    width: 0;
    border-radius: 999px;
    transition: width 1.1s cubic-bezier(.2,.7,.2,1);
  }
  .du-slide-bar-fill.terracotta { background: var(--c-action-600, #ec5329); }
  .du-slide-bar-fill.warm { background: var(--c-accent-500, #d77356); }
  .du-slide-bar-fill.ink { background: var(--c-ink-500, #72655b); }

  /* Archetype pair styles now come from the shared renderer (injected
   * into the same <style> block below). The legacy .du-slide-archetype-*
   * classes are kept only for backwards compatibility with any cached
   * share pages still rendering old wrapped markup. */

  .du-slide-archetype-name {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-size: clamp(36px, 5.5vw, 60px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--c-action-600, #ec5329);
    margin: 10px 0 20px;
    max-width: 760px;
  }
  .du-slide-archetype-desc {
    font-family: 'Fraunces', Georgia, serif;
    font-size: 18px;
    color: var(--c-ink-700, #3e352a);
    max-width: 580px;
    line-height: 1.55;
    margin: 0 0 28px;
  }
  .du-slide-traits {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    max-width: 620px;
  }
  .du-slide-trait-pill {
    font-size: 12px;
    padding: 6px 12px;
    background: var(--c-paper-100, #f8f2e7);
    border: 1px solid var(--c-paper-200, #efe4cf);
    border-radius: 999px;
    color: var(--c-ink-700, #3e352a);
  }
  .du-slide-setup-style {
    margin-top: 20px;
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--c-ink-500, #72655b);
  }

  .du-slide-system-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    max-width: 640px;
    width: 100%;
    margin-top: 30px;
  }
  @media (max-width: 560px) {
    .du-slide-system-grid { grid-template-columns: repeat(2, 1fr); }
  }
  .du-slide-system-card {
    padding: 22px 16px;
    background: var(--c-paper-100, #f8f2e7);
    border: 1px solid var(--c-paper-200, #efe4cf);
    border-radius: 12px;
    text-align: center;
  }
  .du-slide-system-num {
    font-family: 'Fraunces', Georgia, serif;
    font-weight: 500;
    font-size: 40px;
    line-height: 1;
    color: var(--c-action-600, #ec5329);
    letter-spacing: -0.02em;
  }
  .du-slide-system-label {
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--c-ink-500, #72655b);
    margin-top: 10px;
    font-family: 'Geist', system-ui, sans-serif;
  }

  .du-slide-outro {
    background:
      radial-gradient(ellipse at 25% 80%, color-mix(in srgb, var(--c-action-600, #ec5329) 12%, transparent) 0%, transparent 55%),
      radial-gradient(ellipse at 75% 20%, color-mix(in srgb, var(--c-accent-500, #d77356) 10%, transparent) 0%, transparent 55%);
  }
  .du-slide-outro-h2 {
    font-family: 'Fraunces', Georgia, serif;
    font-style: italic;
    font-weight: 500;
    font-size: clamp(32px, 5vw, 52px);
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--c-ink-900, #1f1a14);
    margin: 0 0 32px;
    max-width: 760px;
  }
  .du-slide-cta-btn {
    display: inline-block;
    background: var(--c-action-600, #ec5329);
    color: var(--c-paper-50, #fdfbf6);
    padding: 14px 26px;
    border-radius: 10px;
    text-decoration: none;
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.02em;
    box-shadow: 0 6px 18px rgba(236, 83, 41, 0.22);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .du-slide-cta-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 24px rgba(236, 83, 41, 0.28);
  }
  .du-slide-end-cta {
    margin-top: 36px;
    padding: 14px 22px;
    background: var(--c-paper-100, #f8f2e7);
    border: 1px solid var(--c-paper-200, #efe4cf);
    border-radius: 10px;
    font-family: 'Geist Mono', ui-monospace, monospace;
    font-size: 13px;
    color: var(--c-ink-900, #1f1a14);
  }
  .du-slide-prompt { color: var(--c-ink-400, #a69989); margin-right: 8px; }
`;

// ---------------------------------------------------------------------------
// Script — animates counters and bars on scroll. IntersectionObserver-based.
// Guarded by a global flag so multiple slide decks on the same page don't
// register duplicate observers (edge case: dashboard + preview).
// ---------------------------------------------------------------------------

const WRAPPED_SLIDES_SCRIPT = `
(function () {
  if (window.__duSlidesInit) {
    // Still need to pick up any newly-rendered slides (hot-reload).
    window.__duSlidesBind && window.__duSlidesBind();
    return;
  }
  window.__duSlidesInit = true;

  function bind() {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');

        var counters = entry.target.querySelectorAll('[data-du-count]');
        counters.forEach(function (counter) {
          if (counter.dataset.animated) return;
          counter.dataset.animated = 'true';
          var raw = counter.dataset.duCount || '0';
          // If it's not a pure integer (e.g. "Top 5%", "48 words"), write as-is.
          if (!/^[0-9]+$/.test(raw)) {
            counter.textContent = raw;
            return;
          }
          var target = parseInt(raw, 10);
          var start = performance.now();
          var duration = 1400;
          function step(now) {
            var p = Math.min((now - start) / duration, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            counter.textContent = Math.round(target * eased);
            if (p < 1) requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        });

        var bars = entry.target.querySelectorAll('[data-du-width]');
        bars.forEach(function (bar) {
          if (bar.dataset.animated) return;
          bar.dataset.animated = 'true';
          setTimeout(function () {
            bar.style.width = bar.dataset.duWidth + '%';
          }, 250);
        });
      });
    }, { threshold: 0.25 });

    document.querySelectorAll('[data-du-slide]').forEach(function (el) {
      observer.observe(el);
    });
  }

  window.__duSlidesBind = bind;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
`;
