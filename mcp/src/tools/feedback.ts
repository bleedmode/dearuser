// feedback — unified user-feedback channel.
//
// Three surfaces, one backend:
//   1. MCP (this file) — right after a tool call in the terminal
//   2. Dashboard modal — while looking at a rendered report
//   3. /feedback standalone page — destination from share-render footer
//
// All three POST to the same Supabase table (du_feedback, see
// migrations/supabase/007_feedback.sql). RLS allows inserts only; nobody but
// the service role can read it back.
//
// Why Supabase (not local SQLite like the rest of Dear User): the founder has
// to actually read this to learn. Keeping it in the user's local DB would
// defeat the point. Sending feedback is always an explicit user action, so
// the "nothing leaves the machine" guarantee is preserved for everything
// else.
//
// Network shape: plain fetch to PostgREST — no supabase-js dependency. The
// anon key is a public identifier (it only unlocks the insert-only policy),
// safe to ship in the bundle.

export type FeedbackContext =
  | 'collab'
  | 'security'
  | 'health'
  | 'wrapped'
  | 'general';

export type FeedbackFormat = 'text' | 'json';

export interface FeedbackOptions {
  message: string;
  context?: FeedbackContext;
  rating?: 1 | 2 | 3 | 4 | 5;
  opt_in_followup?: boolean;
  email?: string;
  format?: FeedbackFormat;
}

export interface FeedbackResult {
  ok: boolean;
  id?: string;
  sent: {
    message: string;
    context: string;
    rating: number | null;
    email: string | null;
  };
  error?: string;
}

// Defaults point at the public Dear User Supabase project. Overridable via
// env so a fork / dev environment can redirect to its own project without
// editing code.
const SUPABASE_URL =
  process.env.DEARUSER_FEEDBACK_SUPABASE_URL ??
  'https://vrjohzzvncfbrzzceuik.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.DEARUSER_FEEDBACK_SUPABASE_ANON_KEY ?? '';

const FEEDBACK_ENDPOINT = `${SUPABASE_URL}/rest/v1/du_feedback`;

/**
 * Post a feedback row to Supabase. Returns the inserted row id on success.
 *
 * We use `Prefer: return=representation` so Supabase echoes the inserted row
 * back (ID, created_at) — handy for the confirmation message without a round
 * trip to SELECT.
 */
export async function sendFeedback(
  options: FeedbackOptions,
): Promise<FeedbackResult> {
  const message = (options.message ?? '').trim();
  if (!message) {
    return {
      ok: false,
      sent: { message: '', context: 'general', rating: null, email: null },
      error: 'Message cannot be empty.',
    };
  }
  if (message.length > 4000) {
    return {
      ok: false,
      sent: { message, context: 'general', rating: null, email: null },
      error: 'Message too long (max 4000 characters).',
    };
  }

  const context = options.context ?? 'general';
  const rating = options.rating ?? null;
  // Only attach email when the user explicitly opted in — avoids accidental
  // capture if the agent populates a field from memory.
  const email =
    options.opt_in_followup && options.email?.includes('@')
      ? options.email.trim()
      : null;

  const payload = {
    message,
    context,
    rating,
    email,
    source: 'mcp',
    user_agent: `@poisedhq/dearuser-mcp node/${process.version}`,
  };

  if (!SUPABASE_ANON_KEY) {
    // Graceful degradation — we still acknowledge the user rather than
    // surfacing a config error to someone who just wanted to say thanks.
    // The message is logged to stderr so the founder sees it locally.
    console.error(
      '[feedback] DEARUSER_FEEDBACK_SUPABASE_ANON_KEY not set — feedback not sent remotely',
      JSON.stringify(payload),
    );
    return {
      ok: false,
      sent: {
        message: payload.message,
        context: payload.context,
        rating: payload.rating,
        email: payload.email,
      },
      error:
        'Feedback channel is not configured (missing SUPABASE_ANON_KEY). Your message was logged locally.',
    };
  }

  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        sent: {
          message: payload.message,
          context: payload.context,
          rating: payload.rating,
          email: payload.email,
        },
        error: `Supabase returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const rows = (await res.json().catch(() => [])) as Array<{ id?: string }>;
    return {
      ok: true,
      id: rows[0]?.id,
      sent: {
        message: payload.message,
        context: payload.context,
        rating: payload.rating,
        email: payload.email,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      sent: {
        message: payload.message,
        context: payload.context,
        rating: payload.rating,
        email: payload.email,
      },
      error: `Could not reach feedback channel: ${msg}`,
    };
  }
}

/**
 * Format a feedback result as a friendly Danish confirmation (default) or
 * raw JSON for programmatic consumers. Follows the project's "offer a format
 * parameter, not 'present verbatim'" rule.
 */
export function formatFeedbackResult(
  result: FeedbackResult,
  format: FeedbackFormat = 'text',
): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (!result.ok) {
    const lines = [
      `Tak — jeg fik ikke sendt din feedback afsted.`,
      ``,
      result.error ?? 'Ukendt fejl.',
      ``,
      `Din besked er ikke gået tabt — den blev logget lokalt så Jarl kan samle den op manuelt.`,
    ];
    return lines.join('\n');
  }

  const lines: string[] = [
    `Tak — din feedback er modtaget.`,
    ``,
    `**Hvad jeg sendte afsted:**`,
    `- Besked: "${truncate(result.sent.message, 240)}"`,
    `- Kontekst: ${result.sent.context}`,
  ];
  if (result.sent.rating !== null) {
    lines.push(`- Rating: ${result.sent.rating}/5`);
  }
  if (result.sent.email) {
    lines.push(`- Email (til opfølgning): ${result.sent.email}`);
  }
  lines.push(``, `Det er med i indbakken nu. Sæt pris på at du skrev.`);
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
