// Analytics for Dear User website — dearuser.ai only.
// NEVER instrument mcp/ or dashboard. Those run on the user's machine and
// tracking them would break the product's local-only value proposition.
// Only 4 events. Only page-level signal. No user identity. No session replay.
// Cookieless: persistence='memory' + disable_cookie — no ePrivacy banner
// required. When PUBLIC_POSTHOG_KEY is unset, this module is a no-op.

// We import posthog-js lazily so the bundle stays tiny on pages that never
// initialize it (and so a missing key truly costs nothing at runtime).
type PostHog = {
  init: (key: string, config: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
};

let ph: PostHog | null = null;
let initPromise: Promise<void> | null = null;
let listenersBound = false;

const POSTHOG_HOST = 'https://eu.i.posthog.com';

function getKey(): string | undefined {
  // Astro exposes PUBLIC_* env vars on import.meta.env in the browser bundle.
  const key = (import.meta.env as Record<string, string | undefined>).PUBLIC_POSTHOG_KEY;
  return key && key.trim().length > 0 ? key.trim() : undefined;
}

async function ensureInit(): Promise<void> {
  if (ph) return;
  if (initPromise) return initPromise;
  const key = getKey();
  if (!key) return;

  initPromise = (async () => {
    try {
      const mod: any = await import('posthog-js');
      const client = (mod.default || mod) as PostHog;
      client.init(key, {
        api_host: POSTHOG_HOST,
        person_profiles: 'identified_only',
        capture_pageview: false,
        disable_session_recording: true,
        disable_surveys: true,
        ip: false,
        // Autocapture is broad and often catches user-entered text in inputs.
        // We keep it off and fire exactly the events we list in analytics.ts.
        autocapture: false,
        // Cookieless mode — no cookie, no localStorage, no distinct_id reuse.
        // Aligns with local-only VP and removes the need for a cookie-consent
        // banner under ePrivacy/GDPR. Events still fire aggregated.
        persistence: 'memory',
        disable_persistence: true,
        disable_cookie: true,
      });
      ph = client;
    } catch {
      // Swallow — analytics must never break the site.
      ph = null;
    }
  })();
  return initPromise;
}

function capture(event: string, properties?: Record<string, unknown>): void {
  // Fire-and-forget; initialization races are fine — if PostHog isn't ready
  // yet the event is dropped. We accept that tradeoff for a tiny footprint.
  ensureInit().then(() => {
    if (!ph) return;
    try {
      ph.capture(event, properties);
    } catch {
      /* noop */
    }
  });
}

function getUtmParams(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const v = params.get(k);
      if (v) out[k] = v;
    }
  } catch {
    /* noop */
  }
  return out;
}

// ---------- Public event helpers ----------

export function trackLandingViewed(): void {
  if (!getKey()) return;
  const path = window.location.pathname || '/';
  if (path !== '/' && path !== '/index' && path !== '/index.html') return;
  capture('landing_viewed', {
    referrer: document.referrer || null,
    ...getUtmParams(),
  });
}

export function trackInstallCommandCopied(): void {
  if (!getKey()) return;
  capture('install_command_copied');
}

export function trackShareViewed(params: {
  reportType?: string | null;
  token?: string | null;
}): void {
  if (!getKey()) return;
  const reportType = params.reportType || 'unknown';
  const tokenLength = typeof params.token === 'string' ? params.token.length : 0;
  capture('share_viewed', {
    report_type: reportType,
    token_length: tokenLength,
  });
}

export function trackFeedbackSubmitted(params: {
  source?: string;
  hasRating?: boolean;
  hasEmail?: boolean;
}): void {
  if (!getKey()) return;
  capture('feedback_submitted', {
    source: params.source || 'unknown',
    has_rating: !!params.hasRating,
    has_email: !!params.hasEmail,
  });
}

// ---------- Auto-wiring ----------
// Bind delegated listeners once per page. We keep these inside analytics.ts
// so page markup stays clean — the landing agent adds data-analytics
// attributes, we do the rest.
function bindDelegatedListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  document.addEventListener(
    'click',
    (ev) => {
      const target = ev.target as Element | null;
      if (!target) return;
      const el = target.closest('[data-analytics]');
      if (!el) return;
      const kind = el.getAttribute('data-analytics');
      if (kind === 'install-copy') trackInstallCommandCopied();
    },
    { capture: true },
  );

  document.addEventListener('dearuser:feedback-submitted', ((ev: CustomEvent) => {
    const d = ev.detail || {};
    trackFeedbackSubmitted({
      source: d.source,
      hasRating: !!d.hasRating,
      hasEmail: !!d.hasEmail,
    });
  }) as EventListener);
}

export function initAnalytics(): void {
  if (!getKey()) return;
  // Kick off lazy init; safe to call early.
  ensureInit();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDelegatedListeners, { once: true });
  } else {
    bindDelegatedListeners();
  }
}
