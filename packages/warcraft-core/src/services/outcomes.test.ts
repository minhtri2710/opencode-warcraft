import { describe, expect, it } from 'bun:test';
import type { OperationOutcome } from './outcomes.js';
import { degraded, diagnostic, fatal, isUsable, ok, okVoid, worstSeverity } from './outcomes.js';

describe('outcomes', () => {
  describe('ok()', () => {
    it('creates an ok outcome with value', () => {
      const result = ok(42);
      expect(result.severity).toBe('ok');
      expect(result.value).toBe(42);
      expect(result.diagnostics).toEqual([]);
    });

    it('works with complex types', () => {
      const result = ok({ id: 'abc', count: 3 });
      expect(result.severity).toBe('ok');
      expect(result.value).toEqual({ id: 'abc', count: 3 });
    });
  });

  describe('okVoid()', () => {
    it('creates an ok outcome with undefined value', () => {
      const result = okVoid();
      expect(result.severity).toBe('ok');
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('degraded()', () => {
    it('creates a degraded outcome with value and diagnostics', () => {
      const diags = [diagnostic('flush_failed', 'Flush timed out')];
      const result = degraded('partial-value', diags);
      expect(result.severity).toBe('degraded');
      expect(result.value).toBe('partial-value');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('flush_failed');
    });
  });

  describe('fatal()', () => {
    it('creates a fatal outcome without value', () => {
      const diags = [diagnostic('epic_not_found', 'Cannot find epic', 'fatal')];
      const result = fatal(diags);
      expect(result.severity).toBe('fatal');
      expect(result.value).toBeUndefined();
      expect(result.diagnostics).toHaveLength(1);
    });

    it('creates a typed fatal outcome', () => {
      const result = fatal<string>([diagnostic('fail', 'nope', 'fatal')]);
      expect(result.severity).toBe('fatal');
      expect(result.value).toBeUndefined();
    });
  });

  describe('diagnostic()', () => {
    it('creates a diagnostic with default degraded severity', () => {
      const d = diagnostic('test_code', 'Test message');
      expect(d.code).toBe('test_code');
      expect(d.message).toBe('Test message');
      expect(d.severity).toBe('degraded');
      expect(d.context).toBeUndefined();
    });

    it('creates a diagnostic with explicit severity and context', () => {
      const d = diagnostic('fatal_code', 'Fatal message', 'fatal', { beadId: '123' });
      expect(d.code).toBe('fatal_code');
      expect(d.severity).toBe('fatal');
      expect(d.context).toEqual({ beadId: '123' });
    });
  });

  describe('isUsable()', () => {
    it('returns true for ok outcomes', () => {
      expect(isUsable(ok(42))).toBe(true);
    });

    it('returns true for degraded outcomes with value', () => {
      expect(isUsable(degraded('val', [diagnostic('warn', 'w')]))).toBe(true);
    });

    it('returns false for fatal outcomes', () => {
      expect(isUsable(fatal([diagnostic('fail', 'f', 'fatal')]))).toBe(false);
    });

    it('returns false when value is undefined even if severity is ok', () => {
      const outcome: OperationOutcome<string> = { severity: 'ok', diagnostics: [] };
      expect(isUsable(outcome)).toBe(false);
    });
  });

  describe('worstSeverity()', () => {
    it('returns ok for empty diagnostics', () => {
      expect(worstSeverity([])).toBe('ok');
    });

    it('returns degraded when worst is degraded', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'degraded')];
      expect(worstSeverity(diags)).toBe('degraded');
    });

    it('returns fatal when any diagnostic is fatal', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'degraded'), diagnostic('c', 'c', 'fatal')];
      expect(worstSeverity(diags)).toBe('fatal');
    });

    it('returns ok when all diagnostics are ok', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'ok')];
      expect(worstSeverity(diags)).toBe('ok');
    });
  });
});
