// shared-report — server-side data access for /r/[token] pages.
//
// Uses Supabase REST directly (no client SDK) to keep the Astro bundle
// small. Reads require the service role key (table has no RLS — the token
// itself is the capability). The key lives in environment only — never
// ships to the browser.
//
// Graceful degradation: if Supabase is unreachable OR env vars are missing,
// we return a mock "last-known-good" report rather than throwing. That way
// the public share page still shows the brand and a friendly message
// instead of a stacktrace when Vercel env is misconfigured at cold start.

export type ReportType = 'collab' | 'security' | 'health' | 'wrapped';

export interface SharedReportRow {
  token: string;
  report_type: ReportType;
  report_json: Record<string, unknown>;
  project_name: string | null;
  score: number | null;
  created_at: string;
  expires_at: string | null;
  view_count: number;
}

export interface LoadResult {
  row: SharedReportRow | null;
  /** If true, the returned row is a local mock rather than a DB read. */
  mock?: boolean;
  /** Non-fatal error message — surfaced to the user as a banner, not a 500. */
  warning?: string;
}

function env(name: string): string {
  // Astro exposes server-only env via import.meta.env at build/SSR time.
  // Fall back to process.env for Node-based adapters.
  const viaImport = (import.meta as any).env?.[name];
  if (typeof viaImport === 'string' && viaImport) return viaImport;
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name] as string;
  }
  return '';
}

function getSupabaseEnv(): { url: string; key: string } | null {
  const url =
    env('DEARUSER_SUPABASE_URL') || env('SUPABASE_URL') || env('PUBLIC_SUPABASE_URL');
  const key =
    env('DEARUSER_SUPABASE_SERVICE_KEY') ||
    env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Load a shared report by token. Returns {row:null} for truly-not-found,
 * {row, mock:true, warning} for infra errors (Supabase down, bad creds).
 */
export async function loadSharedReport(token: string): Promise<LoadResult> {
  if (!token || !/^[A-Za-z0-9]{6,32}$/.test(token)) {
    return { row: null };
  }

  const creds = getSupabaseEnv();
  if (!creds) {
    // Dev/preview mode — serve a deterministic demo so the route can be
    // developed without real credentials.
    return {
      row: mockRow(token),
      mock: true,
      warning:
        'Demo preview — this server has no DEARUSER_SUPABASE_URL configured, so you\'re seeing a mock report.',
    };
  }

  try {
    const url =
      `${creds.url}/rest/v1/du_shared_reports` +
      `?token=eq.${encodeURIComponent(token)}&select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return {
        row: mockRow(token),
        mock: true,
        warning: `Upstream error (${res.status}). Showing a preview while we recover.`,
      };
    }

    const rows = (await res.json()) as SharedReportRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { row: null };
    }
    const row = rows[0];

    // Respect expiry — treat expired as "not found" for the viewer.
    if (row.expires_at) {
      const expiry = new Date(row.expires_at).getTime();
      if (Number.isFinite(expiry) && expiry < Date.now()) {
        return { row: null };
      }
    }

    return { row };
  } catch (err) {
    return {
      row: mockRow(token),
      mock: true,
      warning: 'We couldn\'t reach our database right now — showing a preview.',
    };
  }
}

/** Fire-and-forget — don't block the render on the counter. */
export function incrementViewCount(token: string): void {
  const creds = getSupabaseEnv();
  if (!creds) return;
  // Postgres function via RPC endpoint.
  fetch(`${creds.url}/rest/v1/rpc/du_increment_view_count`, {
    method: 'POST',
    headers: {
      apikey: creds.key,
      Authorization: `Bearer ${creds.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ report_token: token }),
  }).catch(() => { /* silent — the page already rendered */ });
}

// ============================================================================
// Mock — used when env is missing or Supabase is unavailable. Intentionally
// generic: shows the brand + product value without leaking any real user's
// data. Same shape the real rows use.
// ============================================================================

function mockRow(token: string): SharedReportRow {
  return {
    token,
    report_type: 'collab',
    project_name: 'example-project',
    score: 87,
    created_at: new Date().toISOString(),
    expires_at: null,
    view_count: 1,
    report_json: {
      collaborationScore: 87,
      projectName: 'example-project',
      persona: {
        archetypeName: 'The Solo Builder',
        traits: ['Pragmatic', 'Iterative', 'Memory-first'],
      },
      categories: [
        { key: 'who_does_what', label: 'Who Does What', score: 92 },
        { key: 'independence', label: 'Independence', score: 85 },
        { key: 'quality_checks', label: 'Quality Checks', score: 81 },
        { key: 'memory', label: 'Memory', score: 90 },
        { key: 'automation', label: 'Automation', score: 74 },
        { key: 'setup', label: 'Setup Completeness', score: 88 },
      ],
      findings: [
        {
          tag: 'win',
          title: 'Your feedback loop actually closes',
          body: 'Most of your recommendations from the last two weeks landed somewhere — shipped, abandoned, or evolved. That\'s unusually high.',
        },
        {
          tag: 'pattern',
          title: 'The same shell script is called from many skills',
          body: 'Several skills parse the same CLI output in their own way. It\'s screaming "MCP server".',
        },
      ],
      recommendations: [
        {
          title: 'Resolve the rule conflict',
          body: 'A rule in CLAUDE.md contradicts a hook. Align them so the hook honors the rule.',
        },
      ],
    },
  };
}
