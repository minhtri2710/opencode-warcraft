import { describe, expect, it } from 'bun:test';
import type { OperationOutcome } from './outcomes.js';
import {
  collectOutcomes,
  degraded,
  diagnostic,
  fatal,
  fromError,
  isUsable,
  ok,
  withDiagnostics,
  worstSeverity,
} from './outcomes.js';

describe('outcomes extra edge cases', () => {
  describe('ok()', () => {
    it('works with null value', () => {
      const result = ok(null);
      expect(result.severity).toBe('ok');
      expect(result.value).toBeNull();
    });

    it('works with false value', () => {
      const result = ok(false);
      expect(result.severity).toBe('ok');
      expect(result.value).toBe(false);
    });

    it('works with 0 value', () => {
      const result = ok(0);
      expect(result.severity).toBe('ok');
      expect(result.value).toBe(0);
    });
  });

  describe('isUsable()', () => {
    it('returns true for ok with null value', () => {
      // null is not undefined, so isUsable returns true
      const outcome: OperationOutcome<null> = { severity: 'ok', value: null, diagnostics: [] };
      expect(isUsable(outcome)).toBe(true);
    });

    it('returns true for ok with false value', () => {
      const outcome = ok(false);
      expect(isUsable(outcome)).toBe(true);
    });

    it('returns true for ok with 0 value', () => {
      const outcome = ok(0);
      expect(isUsable(outcome)).toBe(true);
    });

    it('returns true for degraded with 0 value', () => {
      const outcome = degraded(0, [diagnostic('w', 'warning')]);
      expect(isUsable(outcome)).toBe(true);
    });
  });

  describe('withDiagnostics()', () => {
    it('does not change severity when adding empty diagnostics', () => {
      const base = ok(42);
      const result = withDiagnostics(base, []);
      expect(result.severity).toBe('ok');
      expect(result.diagnostics).toEqual([]);
    });

    it('handles adding to a fatal outcome', () => {
      const base = fatal<number>([diagnostic('err', 'error', 'fatal')]);
      const result = withDiagnostics(base, [diagnostic('ok', 'info', 'ok')]);
      expect(result.severity).toBe('fatal'); // fatal is still worst
      expect(result.diagnostics).toHaveLength(2);
    });
  });

  describe('fromError()', () => {
    it('handles null error', () => {
      const d = fromError('null_err', null);
      expect(d.message).toBe('null');
    });

    it('handles undefined error', () => {
      const d = fromError('undef_err', undefined);
      expect(d.message).toBe('undefined');
    });

    it('handles Error with empty message', () => {
      const d = fromError('empty_err', new Error(''));
      expect(d.message).toBe('');
    });
  });

  describe('collectOutcomes()', () => {
    it('combines diagnostics from many outcomes', () => {
      const outcomes = [
        degraded('a', [diagnostic('w1', 'warn1'), diagnostic('w2', 'warn2')]),
        degraded('b', [diagnostic('w3', 'warn3')]),
      ];
      const result = collectOutcomes(outcomes);
      expect(result.diagnostics).toHaveLength(3);
    });

    it('result value is always undefined', () => {
      const result = collectOutcomes([ok('value')]);
      expect(result.value).toBeUndefined();
    });
  });

  describe('diagnostic()', () => {
    it('creates ok severity diagnostic', () => {
      const d = diagnostic('info', 'Informational', 'ok');
      expect(d.severity).toBe('ok');
    });

    it('creates diagnostic without context', () => {
      const d = diagnostic('code', 'message');
      expect(d.context).toBeUndefined();
    });
  });

  describe('worstSeverity()', () => {
    it('returns fatal for single fatal diagnostic', () => {
      expect(worstSeverity([diagnostic('f', 'fatal', 'fatal')])).toBe('fatal');
    });

    it('returns ok for single ok diagnostic', () => {
      expect(worstSeverity([diagnostic('o', 'ok', 'ok')])).toBe('ok');
    });
  });
});
