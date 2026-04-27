/**
 * Unit tests for the feedback tool.
 *
 * We stub global fetch so tests don't need a live Supabase project. The
 * assertions cover the three critical paths:
 *   - happy-path POST with the right shape
 *   - graceful degradation when the anon key is missing
 *   - email gated behind opt_in_followup
 *   - format="json" returns raw result
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('feedback tool', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.DEARUSER_FEEDBACK_SUPABASE_URL = 'https://example.supabase.co';
    process.env.DEARUSER_FEEDBACK_SUPABASE_ANON_KEY = 'anon-key-for-tests';
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  function bodyOf(call: any): any {
    return JSON.parse(call[1].body);
  }

  it('posts the expected payload to the Supabase REST endpoint', async () => {
    const fetchMock: any = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'row-1' }]), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendFeedback } = await import('./feedback.js');
    const result = await sendFeedback({
      message: 'scores feel low',
      context: 'collab',
      rating: 3,
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('https://example.supabase.co/rest/v1/du_feedback');
    expect(call[1].headers.Prefer).toBe('return=minimal');
    const body = bodyOf(call);
    expect(body.message).toBe('scores feel low');
    expect(body.context).toBe('collab');
    expect(body.rating).toBe(3);
    expect(body.source).toBe('mcp');
    expect(body.email).toBeNull();
    expect(call[1].headers.apikey).toBe('anon-key-for-tests');
  });

  it('never attaches email unless opt_in_followup is true', async () => {
    const fetchMock: any = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'row-2' }]), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendFeedback } = await import('./feedback.js');
    await sendFeedback({
      message: 'hi',
      email: 'user@example.com',
      opt_in_followup: false,
    });
    expect(bodyOf(fetchMock.mock.calls[0]).email).toBeNull();

    await sendFeedback({
      message: 'hi again',
      email: 'user@example.com',
      opt_in_followup: true,
    });
    expect(bodyOf(fetchMock.mock.calls[1]).email).toBe('user@example.com');
  });

  it('rejects empty messages without calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { sendFeedback } = await import('./feedback.js');
    const result = await sendFeedback({ message: '   ' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('degrades gracefully when no anon key is configured', async () => {
    delete process.env.DEARUSER_FEEDBACK_SUPABASE_ANON_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ });

    const { sendFeedback } = await import('./feedback.js');
    const result = await sendFeedback({ message: 'hello' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('surfaces Supabase error responses as structured errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('policy violation', { status: 403 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendFeedback } = await import('./feedback.js');
    const result = await sendFeedback({ message: 'test' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('403');
  });

  it('format=json returns the raw result payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 'row-9' }]), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { sendFeedback, formatFeedbackResult } = await import('./feedback.js');
    const result = await sendFeedback({ message: 'hi', context: 'health' });
    const json = formatFeedbackResult(result, 'json');
    expect(JSON.parse(json).ok).toBe(true);

    const text = formatFeedbackResult(result, 'text');
    expect(text).toMatch(/tak/i);
    expect(text).toContain('health');
  });
});
