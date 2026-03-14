import { describe, expect, it } from 'bun:test';
import {
  ok,
  okVoid,
  degraded,
  fatal,
  diagnostic,
  isUsable,
  worstSeverity,
  withDiagnostics,
  fromError,
  collectOutcomes,
} from './outcomes.js';

describe('outcomes integration scenarios', () => {
  it('pipeline: ok → degraded → fatal escalation', () => {
    let outcome = ok(42);
    expect(outcome.severity).toBe('ok');

    outcome = withDiagnostics(outcome, [diagnostic('warn', 'soft warning')]);
    expect(outcome.severity).toBe('degraded');

    outcome = withDiagnostics(outcome, [diagnostic('fatal', 'critical', 'fatal')]);
    expect(outcome.severity).toBe('fatal');
    expect(outcome.diagnostics).toHaveLength(2);
  });

  it('collectOutcomes aggregates across mixed outcomes', () => {
    const result = collectOutcomes([
      ok('a'),
      degraded('b', [diagnostic('w1', 'warn1')]),
      ok('c'),
      degraded('d', [diagnostic('w2', 'warn2'), diagnostic('w3', 'warn3')]),
    ]);
    expect(result.severity).toBe('degraded');
    expect(result.diagnostics).toHaveLength(3);
  });

  it('isUsable distinguishes usable from non-usable', () => {
    expect(isUsable(ok(42))).toBe(true);
    expect(isUsable(okVoid())).toBe(false); // undefined value
    expect(isUsable(degraded('val', []))).toBe(true);
    expect(isUsable(fatal([]))).toBe(false);
  });

  it('fromError creates diagnostic from various error types', () => {
    expect(fromError('code', new Error('msg')).message).toBe('msg');
    expect(fromError('code', 'str').message).toBe('str');
    expect(fromError('code', 123).message).toBe('123');
    expect(fromError('code', { custom: true }).message).toBe('[object Object]');
  });

  it('diagnostic with context can carry metadata', () => {
    const d = diagnostic('op_failed', 'Operation failed', 'degraded', {
      operation: 'sync',
      beadId: 'bd-42',
      retryCount: 3,
    });
    expect(d.context?.operation).toBe('sync');
    expect(d.context?.retryCount).toBe(3);
  });
});
