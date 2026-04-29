import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  anonymizeReport,
  extractProjectName,
  extractScore,
  generateToken,
  runShareReport,
} from './share.js';

describe('generateToken', () => {
  it('returns a 10-char url-safe token by default', () => {
    const t = generateToken();
    expect(t).toHaveLength(10);
    expect(t).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('tokens are unique over 1000 generations', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateToken());
    expect(set.size).toBe(1000);
  });

  it('avoids visually ambiguous characters', () => {
    // 10k samples — if we're using the confusing alphabet we'll hit at least
    // one O/0/I/l/1 in 10k × 10 chars.
    let combined = '';
    for (let i = 0; i < 1000; i++) combined += generateToken();
    expect(combined).not.toMatch(/[0OIl1]/);
  });
});

describe('anonymizeReport — strings', () => {
  it('strips macOS absolute paths to basename', () => {
    const out = anonymizeReport({ loc: '/Users/karlo/secret/cool-app' });
    expect(out).toEqual({ loc: 'cool-app' });
  });

  it('strips Linux absolute paths to basename', () => {
    const out = anonymizeReport({ loc: '/home/dev/my-project/src/index.ts' });
    expect(out).toEqual({ loc: 'index.ts' });
  });

  it('strips email addresses', () => {
    const out = anonymizeReport({
      contact: 'ping me at karlo@example.com thanks',
    });
    expect(out).toEqual({ contact: 'ping me at [redacted-email] thanks' });
  });

  it('strips Anthropic API keys', () => {
    const out = anonymizeReport({
      bad: 'leaked sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA key',
    });
    expect((out as any).bad).toContain('[redacted-secret]');
    expect((out as any).bad).not.toContain('sk-ant-api03');
  });

  it('strips GitHub PATs', () => {
    const out = anonymizeReport({
      s: 'token=ghp_012345678901234567890123456789012345',
    });
    expect((out as any).s).toContain('[redacted-secret]');
  });

  it('strips JWT-shaped tokens', () => {
    const out = anonymizeReport({
      s: 'eyJabcdefghij.eyJabcdefghij.abcdefghijklmnopqrst',
    });
    expect((out as any).s).toContain('[redacted-secret]');
  });

  it('preserves non-sensitive strings untouched', () => {
    const out = anonymizeReport({ title: 'Your Collaboration Score', body: 'Nice work!' });
    expect(out).toEqual({ title: 'Your Collaboration Score', body: 'Nice work!' });
  });
});

describe('anonymizeReport — structure', () => {
  it('preserves numbers and booleans', () => {
    expect(anonymizeReport({ score: 87, ok: true, bad: false, n: null })).toEqual({
      score: 87,
      ok: true,
      bad: false,
      n: null,
    });
  });

  it('recurses into nested objects and arrays', () => {
    const out = anonymizeReport({
      findings: [
        { id: 1, loc: '/Users/jane/app/src/x.ts' },
        { id: 2, loc: '/home/j/y.ts' },
      ],
    });
    expect(out).toEqual({
      findings: [
        { id: 1, loc: 'x.ts' },
        { id: 2, loc: 'y.ts' },
      ],
    });
  });

  it('drops keys known to carry local context', () => {
    const out = anonymizeReport({
      keep: 'this',
      _projectRoot: '/Users/x/secret',
      projectRoot: '/Users/x/secret',
      _localPath: '/tmp/foo',
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: 'this' });
  });

  it('handles circular references without hanging', () => {
    const a: any = { name: 'a' };
    a.self = a;
    // Should not throw or hang.
    const out = anonymizeReport(a) as any;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[circular]');
  });
});

describe('extractProjectName', () => {
  it('returns the basename of an absolute path', () => {
    expect(extractProjectName({ projectName: '/Users/x/my-app' })).toBe('my-app');
  });

  it('returns null for missing project name', () => {
    expect(extractProjectName({})).toBe(null);
  });

  it('truncates absurdly long names', () => {
    const long = 'a'.repeat(200);
    const out = extractProjectName({ projectName: long });
    expect(out!.length).toBeLessThanOrEqual(64);
  });
});

describe('extractScore', () => {
  it('reads collaborationScore', () => {
    expect(extractScore({ collaborationScore: 87 })).toBe(87);
  });

  it('reads generic score', () => {
    expect(extractScore({ score: 42 })).toBe(42);
  });

  it('clamps to 0..100', () => {
    expect(extractScore({ score: 150 })).toBe(100);
    expect(extractScore({ score: -10 })).toBe(0);
  });

  it('returns null when nothing numeric present', () => {
    expect(extractScore({ title: 'Report' })).toBe(null);
  });
});

describe('runShareReport — integration', () => {
  const originalEnv = { ...process.env };
  const calls: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.DEARUSER_SUPABASE_URL = 'https://test.supabase.co';
    process.env.DEARUSER_SUPABASE_SERVICE_KEY = 'test-service-key';
    process.env.DEARUSER_PUBLIC_BASE_URL = 'https://test.dearuser.ai';

    // Stub global fetch so the test doesn't hit the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status: 201 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('returns a token and public URL', async () => {
    const result = await runShareReport({
      report_type: 'wrapped',
      report_json: { score: 87, projectName: '/Users/j/app' },
    });
    expect(result.token).toHaveLength(10);
    expect(result.url).toBe(`https://test.dearuser.ai/r/${result.token}`);
  });

  it('anonymizes before upload — no absolute paths reach Supabase', async () => {
    await runShareReport({
      report_type: 'wrapped',
      report_json: {
        score: 74,
        projectName: '/Users/secret-person/cool-startup',
        note: 'contact dev@secretco.com for details',
      },
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body as string);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/Users/secret-person');
    expect(serialized).not.toContain('secretco.com');
    expect(body.project_name).toBe('cool-startup');
    expect(body.score).toBe(74);
  });

  it('rejects non-wrapped report_type (pre-launch restriction)', async () => {
    for (const bad of ['collab', 'security', 'health', 'bogus']) {
      await expect(
        runShareReport({ report_type: bad as any, report_json: { score: 1 } }),
      ).rejects.toThrow(/restricted to report_type='wrapped'/);
    }
  });

  it('rejects invalid expires_at', async () => {
    await expect(
      runShareReport({
        report_type: 'wrapped',
        report_json: { score: 1 },
        expires_at: 'not-a-date',
      }),
    ).rejects.toThrow(/expires_at/);
  });

  it('uses hardcoded production defaults when no env or config is present', async () => {
    // Supabase creds were promoted to a hardcoded public anon-key default so
    // fresh installs work out of the box (security comes from the
    // INSERT-only RLS policy on du_shared_reports, not from key secrecy).
    // We assert the call is attempted — and either succeeds (real network
    // available) or fails with a network/RLS error, NOT a config error.
    delete process.env.DEARUSER_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.DEARUSER_SUPABASE_ANON_KEY;
    delete process.env.DEARUSER_SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const os = require('node:os');
    const fs = require('node:fs');
    const path = require('node:path');
    const configPath = path.join(os.homedir(), '.dearuser', 'config.json');
    const backupPath = configPath + '.test-backup';
    let moved = false;
    if (fs.existsSync(configPath)) {
      fs.renameSync(configPath, backupPath);
      moved = true;
    }
    try {
      // Whatever happens, it must NOT be a "credentials not configured" error.
      // Either the call goes through (live network) or it fails with a
      // network/HTTP error from the real Supabase endpoint.
      await runShareReport({
        report_type: 'wrapped',
        report_json: { score: 1 },
      }).catch((err: Error) => {
        expect(err.message).not.toMatch(/credentials not configured/);
      });
    } finally {
      if (moved) fs.renameSync(backupPath, configPath);
    }
  });

  // Regression test: the dashboard Share button uploads a real wrapped report
  // pulled from SQLite, which tends to carry project roots, local paths and
  // user-entered preference blobs that the MCP-tool callsite never sees.
  // Shape here mirrors what formatWrappedJson + archetype-detector actually
  // produce in the wild (sampled from ~/.dearuser/dearuser.db rows).
  it('anonymizes a realistic wrapped report from the dashboard path', async () => {
    const realisticWrapped = {
      collaborationScore: 82,
      projectName: '/Users/karlo/clawd/dearuser',
      archetype: {
        nameEn: 'The System Architect',
        description: 'Runs /Users/karlo/clawd/dearuser/mcp — heavy on rules, light on automation.',
      },
      wrapped: {
        headlineStat: { value: '12', label: 'rules written' },
        topLesson: {
          quote: 'Contact team@poised.dk before shipping.',
          context: 'CLAUDE.md line 42 in /Users/karlo/clawd/dearuser/CLAUDE.md',
        },
        systemGrid: {
          skills: 7,
          hooks: 3,
          scheduledTasks: 2,
          mcpServers: 5,
          projects: 12,
          prohibitionRatio: '0.3',
        },
      },
      _projectRoot: '/Users/karlo/clawd/dearuser',
    };

    await runShareReport({
      report_type: 'wrapped',
      report_json: realisticWrapped,
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].init.body as string);
    const serialized = JSON.stringify(body);
    // Absolute paths must not leak.
    expect(serialized).not.toContain('/Users/karlo');
    expect(serialized).not.toContain('/clawd/');
    // Emails must not leak.
    expect(serialized).not.toContain('team@poised.dk');
    // _projectRoot must be dropped entirely, not anonymized.
    expect(JSON.stringify(body.report_json)).not.toContain('_projectRoot');
    expect(JSON.stringify(body.report_json)).not.toContain('projectRoot');
    // Project name for the social card is the basename, not the full path.
    expect(body.project_name).toBe('dearuser');
    // Score is preserved.
    expect(body.score).toBe(82);
    // Non-sensitive content survives.
    expect(serialized).toContain('The System Architect');
    expect(serialized).toContain('rules written');
  });
});
