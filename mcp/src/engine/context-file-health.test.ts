import { describe, it, expect } from 'vitest';
import { summariseContextHealth } from './context-file-health.js';
import type { LintFinding } from '../types.js';

function f(check: LintFinding['check'], severity: LintFinding['severity'] = 'recommended'): LintFinding {
  return {
    id: `${check}-1`,
    check,
    severity,
    title: `${check} title`,
    description: 'desc',
    file: '/tmp/CLAUDE.md',
    excerpt: '',
  };
}

describe('summariseContextHealth', () => {
  it('groups findings into bloat / llmSmell / staleness', () => {
    const result = summariseContextHealth([
      f('file_too_long'),
      f('empty_section'),
      f('generic_filler'),
      f('dead_command_ref'),
      f('missing_update_date'),
      // Non-categorised — should be ignored
      f('cognitive_blueprint_gap'),
    ]);
    expect(result.byCategory.bloat).toBe(2);
    expect(result.byCategory.llmSmell).toBe(1);
    expect(result.byCategory.staleness).toBe(2);
    expect(result.total).toBe(5);
    expect(result.hasSignal).toBe(true);
  });

  it('returns hasSignal=false when no relevant findings', () => {
    const result = summariseContextHealth([f('cognitive_blueprint_gap')]);
    expect(result.hasSignal).toBe(false);
    expect(result.total).toBe(0);
  });

  it('surfaces top examples with one per category for balance', () => {
    const result = summariseContextHealth([
      f('file_too_long', 'critical'),
      f('empty_section', 'critical'),
      f('generic_filler'),
      f('dead_command_ref'),
    ]);
    expect(result.topExamples).toHaveLength(3);
    const categories = new Set(result.topExamples.map(e => e.category));
    expect(categories.size).toBe(3);
  });

  it('prioritises critical severity in top examples', () => {
    const result = summariseContextHealth([
      f('empty_section', 'nice_to_have'),
      f('file_too_long', 'critical'),
    ]);
    expect(result.topExamples[0].check).toBe('file_too_long');
  });
});
