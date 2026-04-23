// archetype-pair — shared renderer for the "You and me" archetype card pair.
//
// Single source of truth used by all four surfaces that display the two
// archetypes:
//   - Dashboard profile page         (mcp/src/dashboard.ts renderProfil)
//   - Collab letter                  (mcp/src/dashboard.ts renderAnalyzeLetter)
//   - Public share page              (web/src/pages/r/[token].astro)
//   - Wrapped slides                 (web/src/lib/wrapped-slides.ts)
//
// Returns { html, css } as strings. Each surface wraps the output in its own
// layout and injects the CSS once. CSS is scoped via `.du-archetype-*`
// classnames so it can't collide with surrounding page styles.
//
// Canonical visual: the dashboard profile. All surfaces match it.

export interface ArchetypeCardInput {
  /** Archetype display name — e.g. "Venture Builder", "System Architect". */
  name: string | null;
  /** Description paragraph. Optional but recommended. */
  description?: string | null;
  /** Optional "with traits of X" runner-up display name. */
  runnerUpName?: string | null;
  /** Optional source eyebrow ("From your answers" / "From the latest report"). */
  sourceLabel?: { da: string; en: string } | null;
  /** Copy shown when `name` is null (empty state). */
  emptyState: { da: string; en: string };
}

export interface ArchetypePairInput {
  /** Section heading. Defaults to "Archetypes" / "Arketyper". */
  heading?: { da: string; en: string };
  /** Show a bilingual heading row above the cards. Defaults to true. */
  showHeading?: boolean;
  you: ArchetypeCardInput;
  me: ArchetypeCardInput;
  /** Render variant. "default" = dashboard/share. "slide" = larger for Wrapped. */
  variant?: 'default' | 'slide';
  /** Language the output should render in. Defaults to bilingual (both langs
   *  wrapped in .lang-da / .lang-en spans for CSS-toggled pages). If set to
   *  'en' or 'da', only that language is emitted — used by the public share
   *  page which is English-only. */
  lang?: 'bi' | 'da' | 'en';
}

export interface ArchetypePairOutput {
  html: string;
  css: string;
}

// ============================================================================
// HTML escape
// ============================================================================

function h(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a bilingual string. In 'bi' mode returns both languages wrapped in
 * `.lang-da` / `.lang-en` spans; the host page toggles display via CSS. In
 * single-language mode returns only the requested string.
 */
function bi(s: { da: string; en: string }, lang: 'bi' | 'da' | 'en'): string {
  if (lang === 'da') return h(s.da);
  if (lang === 'en') return h(s.en);
  return `<span class="lang-da">${h(s.da)}</span><span class="lang-en">${h(s.en)}</span>`;
}

// ============================================================================
// Card renderer
// ============================================================================

function renderCard(
  sideLabel: { da: string; en: string },
  card: ArchetypeCardInput,
  lang: 'bi' | 'da' | 'en',
): string {
  if (!card.name) {
    return `
      <div class="du-archetype-card du-archetype-card--empty">
        <div class="du-archetype-side">${bi(sideLabel, lang)}</div>
        <p class="du-archetype-empty">${bi(card.emptyState, lang)}</p>
      </div>
    `.trim();
  }

  const source = card.sourceLabel
    ? `
      <div class="du-archetype-source">
        <span class="du-archetype-source-dot" aria-hidden="true"></span>
        <span class="du-archetype-source-label">${bi(card.sourceLabel, lang)}</span>
      </div>
    `.trim()
    : '';

  const runnerUp = card.runnerUpName
    ? `<p class="du-archetype-runner-up">${bi({ da: `Med træk af ${card.runnerUpName}`, en: `With traits of ${card.runnerUpName}` }, lang)}</p>`
    : '';

  const desc = card.description
    ? `<p class="du-archetype-desc">${h(card.description)}</p>`
    : '';

  return `
    <div class="du-archetype-card">
      <div class="du-archetype-side">${bi(sideLabel, lang)}</div>
      ${source}
      <h4 class="du-archetype-name">${h(card.name)}</h4>
      ${runnerUp}
      ${desc}
    </div>
  `.trim();
}

// ============================================================================
// Public API
// ============================================================================

export function renderArchetypePair(input: ArchetypePairInput): ArchetypePairOutput {
  const {
    heading = { da: 'Arketyper', en: 'Archetypes' },
    showHeading = true,
    you,
    me,
    variant = 'default',
    lang = 'bi',
  } = input;

  const headingHtml = showHeading
    ? `<h3 class="du-archetype-heading">${bi(heading, lang)}</h3>`
    : '';

  const html = `
    <section class="du-archetype-pair du-archetype-pair--${variant}">
      ${headingHtml}
      <div class="du-archetype-grid">
        ${renderCard({ da: 'Dig', en: 'You' }, you, lang)}
        ${renderCard({ da: 'Mig', en: 'Me' }, me, lang)}
      </div>
    </section>
  `.trim();

  return { html, css: ARCHETYPE_PAIR_CSS };
}

// ============================================================================
// Styles — canonical is the dashboard profile. `.du-archetype-pair--slide`
// scales up for Wrapped. Colors reference CSS variables defined by each host
// page (--c-paper-100 / --c-ink-500 / --c-action-600) with safe fallbacks.
// ============================================================================

export const ARCHETYPE_PAIR_CSS = `
.du-archetype-pair {
  margin: 32px 0;
}
.du-archetype-heading {
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--c-ink-500, #72655b);
  margin: 0 0 16px;
  font-family: 'Geist', system-ui, sans-serif;
  font-weight: 500;
}
.du-archetype-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
@media (max-width: 640px) {
  .du-archetype-grid { grid-template-columns: 1fr; }
}
.du-archetype-card {
  padding: 24px;
  background: var(--c-paper-100, #f6efe0);
  border-radius: 12px;
  text-align: left;
}
.du-archetype-card--empty {
  background: var(--c-paper-50, #fdfbf6);
  border: 1px dashed var(--c-paper-200, #efe4cf);
}
.du-archetype-side {
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--c-ink-500, #72655b);
  margin-bottom: 12px;
  font-family: 'Geist', system-ui, sans-serif;
}
.du-archetype-source {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.du-archetype-source-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-action-600, #ec5329);
  display: inline-block;
}
.du-archetype-source-label {
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--c-action-600, #ec5329);
  font-family: 'Geist', system-ui, sans-serif;
}
.du-archetype-name {
  font-family: 'Fraunces', Georgia, serif;
  font-style: italic;
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--c-ink-900, #1f1a14);
  margin: 0 0 10px;
  font-weight: 500;
}
.du-archetype-runner-up {
  font-size: 13px;
  color: var(--c-ink-500, #72655b);
  font-style: italic;
  margin: 0 0 12px;
}
.du-archetype-desc {
  font-size: 14px;
  line-height: 1.55;
  color: var(--c-ink-700, #3e352a);
  margin: 0;
}
.du-archetype-empty {
  font-size: 14px;
  line-height: 1.55;
  color: var(--c-ink-500, #72655b);
  margin: 0;
}

/* Slide variant — bigger type for Wrapped presentation. */
.du-archetype-pair--slide {
  margin: 0;
  width: 100%;
  max-width: 720px;
}
.du-archetype-pair--slide .du-archetype-card {
  padding: 28px;
  background: rgba(236, 83, 41, 0.06);
  border: 1px solid rgba(236, 83, 41, 0.18);
  border-radius: 14px;
}
.du-archetype-pair--slide .du-archetype-name {
  font-size: clamp(28px, 4vw, 40px);
}
.du-archetype-pair--slide .du-archetype-desc {
  font-size: 15px;
}
`;
