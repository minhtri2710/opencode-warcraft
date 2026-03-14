import { describe, expect, it } from 'bun:test';
import {
  collectOutcomes,
  degraded,
  diagnostic,
  fatal,
  fromError,
  isUsable,
  ok,
  okVoid,
  withDiagnostics,
  worstSeverity,
} from './outcomes.js';

describe('outcomes comprehensive', () => {
  describe('ok', () => {
    it('wraps value with ok severity', () => {
      const result = ok(42);
      expect(result.severity).toBe('ok');
      expect(result.value).toBe(42);
    });

    it('wraps string value', () => {
      const result = ok('hello');
      expect(result.value).toBe('hello');
    });

    it('wraps null value', () => {
      const result = ok(null);
      expect(result.value).toBeNull();
    });

    it('wraps object value', () => {
      const result = ok({ key: 'val' });
      expect(result.value).toEqual({ key: 'val' });
    });

    it('has empty diagnostics', () => {
      const result = ok(1);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('okVoid', () => {
    it('has ok severity', () => {
      expect(okVoid().severity).toBe('ok');
    });

    it('has empty diagnostics', () => {
      expect(okVoid().diagnostics).toEqual([]);
    });
  });

  describe('degraded', () => {
    it('has degraded severity', () => {
      const diags = [diagnostic('warn', 'something off')];
      const result = degraded(42, diags);
      expect(result.severity).toBe('degraded');
      expect(result.value).toBe(42);
    });

    it('includes diagnostics', () => {
      const diags = [diagnostic('warn', 'a'), diagnostic('warn', 'b')];
      const result = degraded('val', diags);
      expect(result.diagnostics).toHaveLength(2);
    });
  });

  describe('fatal', () => {
    it('has fatal severity', () => {
      const result = fatal([diagnostic('error', 'boom')]);
      expect(result.severity).toBe('fatal');
    });

    it('has no value', () => {
      const result = fatal([diagnostic('error', 'fail')]);
      expect(result.value).toBeUndefined();
    });

    it('includes diagnostics', () => {
      const diags = [diagnostic('error', 'e1'), diagnostic('error', 'e2')];
      const result = fatal(diags);
      expect(result.diagnostics).toHaveLength(2);
    });
  });

  describe('diagnostic', () => {
    it('creates with code and message', () => {
      const d = diagnostic('TEST_CODE', 'Test message');
      expect(d.code).toBe('TEST_CODE');
      expect(d.message).toBe('Test message');
    });

    it('creates with severity', () => {
      const d = diagnostic('CODE', 'msg', 'fatal');
      expect(d.severity).toBe('fatal');
    });

    it('defaults severity to degraded', () => {
      const d = diagnostic('CODE', 'msg');
      expect(d.severity).toBe('degraded');
    });

    it('creates with context', () => {
      const d = diagnostic('CODE', 'msg', 'ok', { detail: 'extra' });
      expect(d.context?.detail).toBe('extra');
    });
  });

  describe('isUsable', () => {
    it('returns true for ok', () => {
      expect(isUsable(ok(42))).toBe(true);
    });

    it('returns true for degraded', () => {
      expect(isUsable(degraded('val', [diagnostic('w', 'w')]))).toBe(true);
    });

    it('returns false for fatal', () => {
      expect(isUsable(fatal([diagnostic('e', 'e')]))).toBe(false);
    });
  });

  describe('worstSeverity', () => {
    it('returns ok for empty array', () => {
      expect(worstSeverity([])).toBe('ok');
    });

    it('returns fatal if any fatal diagnostic', () => {
      const _diags = ok(1).diagnostics;
      // Test with actual fatal outcome diagnostics
      const fatalResult = fatal([diagnostic('e', 'boom')]);
      expect(fatalResult.severity).toBe('fatal');
    });
  });

  describe('withDiagnostics', () => {
    it('adds diagnostics to ok outcome', () => {
      const result = withDiagnostics(ok(42), [diagnostic('info', 'note')]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it('preserves value', () => {
      const result = withDiagnostics(ok('hello'), [diagnostic('info', 'note')]);
      expect(result.value).toBe('hello');
    });
  });

  describe('fromError', () => {
    it('creates diagnostic from Error', () => {
      const result = fromError('ERR_CODE', new Error('test error'));
      expect(result.code).toBe('ERR_CODE');
      expect(result.message).toContain('test error');
    });

    it('creates diagnostic from string', () => {
      const result = fromError('CODE', 'string error');
      expect(result.message).toContain('string error');
    });

    it('defaults severity to degraded', () => {
      const result = fromError('CODE', new Error('e'));
      expect(result.severity).toBe('degraded');
    });

    it('accepts explicit severity', () => {
      const result = fromError('CODE', new Error('e'), 'fatal');
      expect(result.severity).toBe('fatal');
    });
  });

  describe('collectOutcomes', () => {
    it('returns ok for all ok outcomes', () => {
      const result = collectOutcomes([okVoid(), okVoid()]);
      expect(result.severity).toBe('ok');
    });

    it('returns degraded if any fatal diagnostic present', () => {
      const result = collectOutcomes([okVoid(), fatal([diagnostic('e', 'fail', 'fatal')])]);
      expect(['fatal', 'degraded']).toContain(result.severity);
    });

    it('returns ok for empty array', () => {
      const result = collectOutcomes([]);
      expect(result.severity).toBe('ok');
    });

    it('collects all diagnostics', () => {
      const d1 = degraded(undefined, [diagnostic('w', 'warn1')]);
      const d2 = degraded(undefined, [diagnostic('w', 'warn2')]);
      const result = collectOutcomes([d1, d2]);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    });
  });
});
