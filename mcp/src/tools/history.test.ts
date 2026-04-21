/**
 * Unit tests for the history tool — exercises summary / trend / regression
 * flows against an isolated SQLite DB so we don't mutate the user's real
 * ~/.dearuser/dearuser.db.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

// Redirect HOME so db.ts writes into a throwaway directory for the tests.
const TEST_HOME = mkdtempSync(join(tmpdir(), 'dearuser-test-'));
process.env.HOME = TEST_HOME;

const { insertAgentRun, updateRunJson, updateRunDetails, getDb } = await import('../engine/db.js');
const { runHistory } = await import('./history.js');

function seedRun(tool: string, score: number | null, findingIds: string[], daysAgo: number, summary = 'Run summary'): string {
  const id = insertAgentRun({ toolName: tool, score: score ?? undefined, status: 'success', summary });
  // Back-date the run so trend ordering works without racing the clock.
  const when = Date.now() - daysAgo * 86400_000;
  getDb().prepare('UPDATE du_agent_runs SET started_at = ?, finished_at = ? WHERE id = ?').run(when, when, id);
  if (findingIds.length > 0) {
    updateRunJson(id, { findings: findingIds.map(fid => ({ id: fid, severity: 'recommended' })) });
  }
  updateRunDetails(id, `## Full report for ${tool}\n\nDetails here.`);
  return id;
}

beforeEach(() => {
  getDb().exec('DELETE FROM du_agent_runs');
});

afterAll(() => {
  try { rmSync(TEST_HOME, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('history — summary', () => {
  it('returns a helpful message when no runs exist', () => {
    const out = runHistory({ format: 'summary', scope: 'all' });
    expect(out).toContain('Ingen tidligere rapporter');
  });

  it('returns latest run per scope', () => {
    seedRun('collab', 75, [], 2);
    seedRun('collab', 82, [], 0, 'Newest collab');
    seedRun('security', 90, [], 1);
    const out = runHistory({ format: 'summary', scope: 'all' });
    expect(out).toContain('82/100');
    expect(out).toContain('90/100');
    expect(out).toContain('Newest collab');
  });

  it('accepts legacy tool names (analyze→collab)', () => {
    seedRun('analyze', 55, [], 0);
    const out = runHistory({ format: 'summary', scope: 'collab' });
    expect(out).toContain('55/100');
  });
});

describe('history — trend', () => {
  it('shows a sparkline + delta across runs', () => {
    seedRun('health', 50, [], 5);
    seedRun('health', 60, [], 3);
    seedRun('health', 70, [], 1);
    const out = runHistory({ format: 'trend', scope: 'health' });
    expect(out).toMatch(/↑ \+20/);
    expect(out).toContain('70/100');
    expect(out).toContain('3 kørsler');
  });

  it('flags no-history scopes gracefully', () => {
    const out = runHistory({ format: 'trend', scope: 'security' });
    expect(out).toContain('Ingen score-historik');
  });
});

describe('history — regression', () => {
  it('reports added and resolved finding IDs', () => {
    seedRun('security', 80, ['SEC-1', 'SEC-2'], 2);
    seedRun('security', 70, ['SEC-2', 'SEC-3'], 0);
    const out = runHistory({ format: 'regression', scope: 'security' });
    expect(out).toMatch(/regression/i);
    expect(out).toContain('SEC-3');       // new finding
    expect(out).toContain('SEC-1');       // resolved
    expect(out).toMatch(/↓ -10/);
  });

  it('handles a single-run scope with a gentle message', () => {
    seedRun('collab', 60, [], 0);
    const out = runHistory({ format: 'regression', scope: 'collab' });
    expect(out).toContain('Kun én kørsel');
  });
});

describe('history — specific run_id', () => {
  it('fetches the stored details for a run', () => {
    const id = seedRun('health', 65, [], 0);
    const out = runHistory({ runId: id });
    expect(out).toContain('65/100');
    expect(out).toContain('Full report for health');
  });

  it('reports cleanly when the run is not found', () => {
    const out = runHistory({ runId: 'does-not-exist' });
    expect(out).toContain('Ingen kørsel fundet');
  });
});
