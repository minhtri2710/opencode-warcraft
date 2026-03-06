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
  okVoid,
  withDiagnostics,
  worstSeverity,
} from './outcomes.js';

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

  describe('withDiagnostics()', () => {
    it('adds diagnostics to an ok outcome and upgrades severity', () => {
      const base = ok(42);
      const diags = [diagnostic('warn_code', 'Something degraded')];
      const result = withDiagnostics(base, diags);
      expect(result.severity).toBe('degraded');
      expect(result.value).toBe(42);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('warn_code');
    });

    it('preserves existing diagnostics and appends new ones', () => {
      const base = degraded('val', [diagnostic('existing', 'Already there')]);
      const newDiags = [diagnostic('new_warn', 'New warning')];
      const result = withDiagnostics(base, newDiags);
      expect(result.diagnostics).toHaveLength(2);
      expect(result.diagnostics[0].code).toBe('existing');
      expect(result.diagnostics[1].code).toBe('new_warn');
    });

    it('upgrades severity to fatal when fatal diagnostic is added', () => {
      const base = ok('value');
      const diags = [diagnostic('fatal_err', 'Critical failure', 'fatal')];
      const result = withDiagnostics(base, diags);
      expect(result.severity).toBe('fatal');
    });

    it('does not downgrade severity when ok diagnostics are added to degraded', () => {
      const base = degraded('val', [diagnostic('warn', 'w')]);
      const okDiags = [diagnostic('info', 'info', 'ok')];
      const result = withDiagnostics(base, okDiags);
      expect(result.severity).toBe('degraded');
    });
  });

  describe('fromError()', () => {
    it('creates a diagnostic from an Error instance', () => {
      const error = new Error('Something failed');
      const d = fromError('op_failed', error);
      expect(d.code).toBe('op_failed');
      expect(d.message).toBe('Something failed');
      expect(d.severity).toBe('degraded');
    });

    it('creates a diagnostic from a string error', () => {
      const d = fromError('str_error', 'plain string error');
      expect(d.code).toBe('str_error');
      expect(d.message).toBe('plain string error');
    });

    it('creates a diagnostic from an unknown error type', () => {
      const d = fromError('unknown_error', 42);
      expect(d.code).toBe('unknown_error');
      expect(d.message).toBe('42');
    });

    it('accepts explicit severity and context', () => {
      const d = fromError('fatal_op', new Error('boom'), 'fatal', { op: 'sync' });
      expect(d.severity).toBe('fatal');
      expect(d.context).toEqual({ op: 'sync' });
    });
  });

  describe('collectOutcomes()', () => {
    it('merges multiple ok outcomes into a single ok outcome', () => {
      const outcomes = [ok('a'), ok('b'), ok('c')];
      const result = collectOutcomes(outcomes);
      expect(result.severity).toBe('ok');
      expect(result.diagnostics).toEqual([]);
    });

    it('merges ok and degraded into degraded with combined diagnostics', () => {
      const outcomes = [ok('a'), degraded('b', [diagnostic('warn', 'w')])];
      const result = collectOutcomes(outcomes);
      expect(result.severity).toBe('degraded');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].code).toBe('warn');
    });

    it('returns fatal if any outcome is fatal', () => {
      const outcomes = [ok('a'), fatal([diagnostic('err', 'e', 'fatal')]), degraded('c', [diagnostic('w', 'w')])];
      const result = collectOutcomes(outcomes);
      expect(result.severity).toBe('fatal');
      expect(result.diagnostics).toHaveLength(2);
    });

    it('returns ok for empty array', () => {
      const result = collectOutcomes([]);
      expect(result.severity).toBe('ok');
      expect(result.diagnostics).toEqual([]);
    });
  });
});
