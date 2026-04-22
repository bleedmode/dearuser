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
