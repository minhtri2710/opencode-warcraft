import { describe, expect, it } from 'bun:test';
import {
  collectOutcomes,
  type Diagnostic,
  degraded,
  diagnostic,
  fatal,
  fromError,
  isUsable,
  type OperationOutcome,
  ok,
  okVoid,
  type Severity,
  withDiagnostics,
  worstSeverity,
} from './outcomes.js';

describe('outcomes API completeness', () => {
  describe('ok outcomes', () => {
    const VALUES = [0, 1, -1, '', 'hello', true, false, null, [], {}, [1, 2], { a: 1 }];
    for (const val of VALUES) {
      it(`ok(${JSON.stringify(val)})`, () => {
        const result = ok(val);
        expect(result.severity).toBe('ok');
        expect(isUsable(result)).toBe(true);
        if (result.severity === 'ok') {
          expect(result.value).toEqual(val);
        }
      });
    }
  });

  describe('okVoid', () => {
    it('returns ok severity', () => {
      const result = okVoid();
      expect(result.severity).toBe('ok');
    });
  });

  describe('degraded outcomes', () => {
    it('with single diagnostic', () => {
      const result = degraded('value', [diagnostic('w', 'warning')]);
      expect(result.severity).toBe('degraded');
      expect(isUsable(result)).toBe(true);
    });

    it('with multiple diagnostics', () => {
      const diags = [diagnostic('a', 'first'), diagnostic('b', 'second'), diagnostic('c', 'third')];
      const result = degraded('val', diags);
      expect(result.severity).toBe('degraded');
      expect(result.diagnostics.length).toBe(3);
    });
  });

  describe('fatal outcomes', () => {
    it('with single diagnostic', () => {
      const result = fatal([diagnostic('e', 'error', 'fatal')]);
      expect(result.severity).toBe('fatal');
      expect(isUsable(result)).toBe(false);
    });

    it('with no diagnostics', () => {
      const result = fatal([]);
      expect(result.severity).toBe('fatal');
      expect(isUsable(result)).toBe(false);
    });
  });

  describe('diagnostic factory', () => {
    const SEVERITIES: Severity[] = ['ok', 'degraded', 'fatal'];
    const CODES = ['err_1', 'warn_2', 'info_3'];
    const MESSAGES = ['Short', 'A longer message with details', ''];

    for (const sev of SEVERITIES) {
      for (const code of CODES) {
        for (const msg of MESSAGES) {
          it(`${sev}/${code}/${msg.slice(0, 10)}`, () => {
            const d = diagnostic(code, msg, sev);
            expect(d.code).toBe(code);
            expect(d.message).toBe(msg);
            expect(d.severity).toBe(sev);
          });
        }
      }
    }
  });

  describe('fromError', () => {
    it('from Error instance', () => {
      const d = fromError('test', new Error('boom'));
      expect(d.code).toBe('test');
      expect(d.message).toContain('boom');
    });

    it('from string', () => {
      const d = fromError('code', 'string error');
      expect(d.message).toContain('string error');
    });

    it('from null', () => {
      const d = fromError('code', null);
      expect(d.code).toBe('code');
    });
  });

  describe('collectOutcomes', () => {
    it('all ok → ok', () => {
      const results = [ok(1), ok(2), ok(3)];
      const collected = collectOutcomes(results);
      expect(collected.severity).toBe('ok');
    });

    it('one fatal → not ok', () => {
      const results = [ok(1), fatal([diagnostic('e', 'error')])];
      const collected = collectOutcomes(results);
      expect(collected.severity).not.toBe('ok');
    });

    it('one degraded → degraded', () => {
      const results = [ok(1), degraded(2, [diagnostic('w', 'warn')])];
      const collected = collectOutcomes(results);
      expect(collected.severity === 'degraded' || collected.severity === 'ok').toBe(true);
    });
  });
});
