// /r/[token]/opengraph-image.png — dynamic social card.
//
// Uses @vercel/og to render a 1200x630 PNG at request time. The card shows
// the score + project archetype + Dear User brand so Twitter / LinkedIn /
// Slack previews look rich.
//
// Request-scoped: runs as a serverless function via the Vercel adapter.
// Falls back to a pre-rendered "brand-only" card if the report is missing
// — we still want something nice in the preview for a not-found URL.

export const prerender = false;

import type { APIRoute } from 'astro';
import { ImageResponse } from '@vercel/og';
import { loadSharedReport } from '../../../lib/shared-report';

// Tailwind-style brand palette (matches the site's CSS custom properties).
const C = {
  paper50: '#FDFBF6',
  paper100: '#F8F2E7',
  paper200: '#EFE4CF',
  ink900: '#1F1A14',
  ink700: '#3E352A',
  ink500: '#72655B',
  action600: '#EC5329',
  good: '#059669',
  warn: '#FBBF24',
  bad: '#BE123C',
};

function toneColor(score: number | null): string {
  if (score === null || !Number.isFinite(score)) return C.ink500;
  if (score >= 80) return C.good;
  if (score >= 60) return C.warn;
  return C.bad;
}

function toneLabel(score: number | null): string {
  if (score === null) return 'Dear User audit';
  if (score >= 80) return 'Strong collaboration';
  if (score >= 60) return 'Room to improve';
  return 'Needs attention';
}

const REPORT_LABEL: Record<string, string> = {
  collab: 'Collaboration report',
  security: 'Security report',
  health: 'System health report',
  wrapped: 'Wrapped',
};

// Tiny JSX-less helper — @vercel/og accepts satori-style element trees, and
// the {type, props} shape is what React.createElement would produce. This
// keeps us off the JSX build pipeline while still using the full layout
// engine inside ImageResponse.
function el(
  type: string,
  props: Record<string, any> = {},
  ...children: any[]
): any {
  return {
    type,
    props: {
      ...props,
      children: children.length === 0
        ? undefined
        : children.length === 1 ? children[0] : children,
    },
  };
}

// ---------------------------------------------------------------------------
// Wrapped-type OG card — Spotify Wrapped visual language.
// ---------------------------------------------------------------------------
//
// The standard share card (below) is a "audit score on paper" layout — muted
// palette, score tone based on value, all other report types use it. Wrapped
// is different: it's a viral shareable stat, not a diagnosis. So we give it
// its own language:
//   - Bold terracotta wash so it reads as branded at thumbnail size
//   - Hero number at ~200pt (the score) with tiny "out of 100" beneath
//   - 1-2 supporting stats in ranked-list form
//   - "YEAR" as a visual anchor, Spotify-style
//
// Keeps the standard layout intact for collab/security/health.
function renderWrappedCard(
  row: any,
  project: string,
  score: number | null,
): Response {
  const w = (row?.report_json as any)?.wrapped || {};
  const archetype =
    (row?.report_json as any)?.persona?.archetypeName ||
    w?.archetype?.name ||
    '';
  const headline =
    typeof w?.headlineStat?.label === 'string' ? w.headlineStat.label : '';
  const year = row?.created_at
    ? new Date(row.created_at).getFullYear()
    : new Date().getFullYear();

  // Pick two supporting stats for the ranked-list row — the numbers most
  // people will want to screenshot. Skip gracefully when the wrapped blob
  // isn't populated (share from a different report type or mock).
  const sc = w?.shareCard || {};
  const supporting: Array<{ value: string | number; label: string }> = [];
  if (typeof sc.corrections === 'number') {
    supporting.push({ value: sc.corrections, label: 'corrections remembered' });
  }
  if (typeof sc.memories === 'number') {
    supporting.push({ value: sc.memories, label: 'memories built' });
  }
  if (supporting.length < 2 && typeof sc.projects === 'number') {
    supporting.push({ value: sc.projects, label: 'projects managed' });
  }

  return new ImageResponse(
    el(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          // Terracotta gradient — brand action color washing down to a darker
          // corner so the card has depth without clashing with ink.
          backgroundImage: `linear-gradient(135deg, ${C.action600} 0%, #c8401f 100%)`,
          padding: '64px 80px',
          fontFamily: 'sans-serif',
          color: C.paper50,
        },
      },
      // Brand row — small, top-left.
      el(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          },
        },
        el(
          'div',
          {
            style: {
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: C.paper50,
              color: C.action600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              lineHeight: 1,
            },
          },
          '☺',
        ),
        el(
          'div',
          {
            style: {
              fontSize: 24,
              fontStyle: 'italic',
              fontWeight: 500,
              color: C.paper50,
            },
          },
          'Dear User',
        ),
        el(
          'div',
          {
            style: {
              marginLeft: 'auto',
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: C.paper50,
              opacity: 0.85,
              display: 'flex',
            },
          },
          `Wrapped · ${year}`,
        ),
      ),
      // Hero block — centered, score at 240px so it dominates the thumbnail.
      el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 12,
          },
        },
        el(
          'div',
          {
            style: {
              fontSize: 240,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: '-0.04em',
              color: C.paper50,
              display: 'flex',
            },
          },
          score !== null ? String(score) : '—',
        ),
        el(
          'div',
          {
            style: {
              fontSize: 22,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: C.paper50,
              opacity: 0.85,
              marginTop: 4,
              display: 'flex',
            },
          },
          'out of 100',
        ),
      ),
      // Headline / archetype strip
      el(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: 24,
            maxWidth: 980,
            alignSelf: 'center',
          },
        },
        archetype
          ? el(
              'div',
              {
                style: {
                  fontSize: 42,
                  fontWeight: 500,
                  color: C.paper50,
                  textAlign: 'center',
                  display: 'flex',
                },
              },
              archetype,
            )
          : el('div', { style: { display: 'flex' } }, ''),
        headline
          ? el(
              'div',
              {
                style: {
                  fontSize: 22,
                  color: C.paper50,
                  opacity: 0.85,
                  marginTop: 10,
                  textAlign: 'center',
                  maxWidth: 900,
                  display: 'flex',
                },
              },
              headline.length > 110 ? headline.slice(0, 107) + '…' : headline,
            )
          : el('div', { style: { display: 'flex' } }, ''),
      ),
      // Footer — supporting stats ranked-list + CTA
      el(
        'div',
        {
          style: {
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            paddingTop: 20,
            borderTop: `1px solid rgba(253, 251, 246, 0.25)`,
          },
        },
        supporting.length > 0
          ? el(
              'div',
              {
                style: {
                  display: 'flex',
                  gap: 36,
                },
              },
              ...supporting.slice(0, 2).map((s) =>
                el(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    },
                  },
                  el(
                    'div',
                    {
                      style: {
                        fontSize: 44,
                        fontWeight: 600,
                        lineHeight: 1,
                        color: C.paper50,
                      },
                    },
                    String(s.value),
                  ),
                  el(
                    'div',
                    {
                      style: {
                        fontSize: 16,
                        color: C.paper50,
                        opacity: 0.8,
                      },
                    },
                    s.label,
                  ),
                ),
              ),
            )
          : el(
              'div',
              {
                style: {
                  fontSize: 22,
                  color: C.paper50,
                  opacity: 0.85,
                  display: 'flex',
                },
              },
              project.length > 40 ? project.slice(0, 37) + '…' : project,
            ),
        el(
          'div',
          {
            style: {
              fontSize: 20,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: C.paper50,
              opacity: 0.9,
              paddingBottom: 6,
              display: 'flex',
            },
          },
          'dearuser.ai',
        ),
      ),
    ),
    { width: 1200, height: 630 },
  );
}

export const GET: APIRoute = async ({ params }) => {
  const token = (params.token || '').toString();
  const { row } = await loadSharedReport(token);

  const reportType = row?.report_type || 'collab';
  const score = row?.score ?? null;
  const project = row?.project_name || 'Claude Code setup';
  const archetype =
    (row?.report_json as any)?.persona?.archetypeName ||
    REPORT_LABEL[reportType] ||
    'Audit';

  // Wrapped gets its own viral-share treatment — one MASSIVE stat on a bold
  // terracotta gradient. Spotify/GitHub-Unwrapped language, not the standard
  // score-on-paper audit layout.
  if (reportType === 'wrapped') {
    return renderWrappedCard(row, project, score);
  }

  const tone = toneColor(score);

  return new ImageResponse(
    el(
      'div',
      {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: C.paper50,
          padding: '72px 88px',
          fontFamily: 'sans-serif',
          color: C.ink900,
        },
      },
      // Header row with logo + brand
      el(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            marginBottom: 56,
          },
        },
        el(
          'div',
          {
            style: {
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: C.action600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 36,
              color: C.paper50,
              lineHeight: 1,
            },
          },
          '☺',
        ),
        el(
          'div',
          {
            style: {
              fontSize: 30,
              fontStyle: 'italic',
              color: C.ink900,
              fontWeight: 500,
            },
          },
          'Dear User',
        ),
      ),
      // Project name
      el(
        'div',
        {
          style: {
            fontSize: 28,
            color: C.ink500,
            marginBottom: 18,
            textTransform: 'uppercase',
            letterSpacing: 4,
          },
        },
        REPORT_LABEL[reportType] || 'Audit',
      ),
      el(
        'div',
        {
          style: {
            fontSize: 64,
            fontWeight: 500,
            color: C.ink900,
            lineHeight: 1.05,
            marginBottom: 44,
            maxWidth: 980,
            display: 'flex',
          },
        },
        project.length > 48 ? project.slice(0, 45) + '…' : project,
      ),
      // Score row
      score !== null
        ? el(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'flex-end',
                gap: 28,
                marginTop: 'auto',
              },
            },
            el(
              'div',
              {
                style: {
                  fontSize: 200,
                  fontWeight: 500,
                  color: tone,
                  lineHeight: 1,
                },
              },
              String(score),
            ),
            el(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  paddingBottom: 28,
                  gap: 8,
                },
              },
              el(
                'div',
                { style: { fontSize: 28, color: C.ink500 } },
                'out of 100',
              ),
              el(
                'div',
                {
                  style: {
                    fontSize: 36,
                    color: C.ink900,
                    fontStyle: 'italic',
                  },
                },
                toneLabel(score),
              ),
              el(
                'div',
                {
                  style: {
                    fontSize: 26,
                    color: C.ink500,
                    marginTop: 8,
                  },
                },
                archetype,
              ),
            ),
          )
        : el(
            'div',
            {
              style: {
                marginTop: 'auto',
                fontSize: 42,
                color: C.ink700,
                fontStyle: 'italic',
              },
            },
            archetype,
          ),
      // Footer
      el(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 48,
            paddingTop: 24,
            borderTop: `1px solid ${C.paper200}`,
            fontSize: 22,
            color: C.ink500,
          },
        },
        el('div', {}, 'dearuser.ai'),
        el('div', {}, 'Audit your own setup →'),
      ),
    ),
    {
      width: 1200,
      height: 630,
    },
  );
};
