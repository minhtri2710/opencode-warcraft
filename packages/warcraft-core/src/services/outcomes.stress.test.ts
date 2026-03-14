import { describe, expect, it } from 'bun:test';
import {
  ok,
  okVoid,
  degraded,
  fatal,
  diagnostic,
  isUsable,
  withDiagnostics,
  collectOutcomes,
  fromError,
} from './outcomes.js';

describe('outcomes stress and edge cases', () => {
  it('ok with complex nested object', () => {
    const value = { a: { b: { c: [1, 2, { d: 'deep' }] } } };
    const result = ok(value);
    expect(result.value.a.b.c[2]).toEqual({ d: 'deep' });
  });

  it('withDiagnostics chains multiple times', () => {
    let result = ok(42);
    result = withDiagnostics(result, [diagnostic('a', 'first')]);
    result = withDiagnostics(result, [diagnostic('b', 'second')]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    expect(result.value).toBe(42);
  });

  it('collectOutcomes with many outcomes', () => {
    const outcomes = Array.from({ length: 50 }, () => okVoid());
    const result = collectOutcomes(outcomes);
    expect(result.severity).toBe('ok');
  });

  it('diagnostic message can be very long', () => {
    const longMsg = 'x'.repeat(5000);
    const d = diagnostic('CODE', longMsg);
    expect(d.message).toHaveLength(5000);
  });

  it('fromError with non-Error object', () => {
    const d = fromError('CODE', { custom: 'error' });
    expect(d.message).toBeDefined();
    expect(d.code).toBe('CODE');
  });

  it('fromError with string error', () => {
    const d = fromError('CODE', 'string error message');
    expect(d.message).toContain('string error message');
  });

  it('fromError with number', () => {
    const d = fromError('CODE', 42);
    expect(d.message).toContain('42');
  });

  it('degraded preserves falsy values', () => {
    expect(degraded(0, [diagnostic('w', 'w')]).value).toBe(0);
    expect(degraded('', [diagnostic('w', 'w')]).value).toBe('');
    expect(degraded(false, [diagnostic('w', 'w')]).value).toBe(false);
  });

  it('fatal with many diagnostics', () => {
    const diags = Array.from({ length: 20 }, (_, i) => diagnostic(`E${i}`, `Error ${i}`, 'fatal'));
    const result = fatal(diags);
    expect(result.diagnostics).toHaveLength(20);
    expect(result.severity).toBe('fatal');
  });
});
