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

describe('outcomes exhaustive severity', () => {
  const ALL_SEVERITIES = ['ok', 'degraded', 'fatal'] as const;

  describe('worstSeverity with all combinations', () => {
    for (const s1 of ALL_SEVERITIES) {
      for (const s2 of ALL_SEVERITIES) {
        it(`worst of ${s1} and ${s2}`, () => {
          const d1 = diagnostic('c1', 'm1', s1);
          const d2 = diagnostic('c2', 'm2', s2);
          const worst = worstSeverity([d1, d2]);
          // fatal > degraded > ok
          if (s1 === 'fatal' || s2 === 'fatal') expect(worst).toBe('fatal');
          else if (s1 === 'degraded' || s2 === 'degraded') expect(worst).toBe('degraded');
          else expect(worst).toBe('ok');
        });
      }
    }
  });

  describe('fromError with all severity levels', () => {
    for (const sev of ALL_SEVERITIES) {
      it(`fromError with ${sev} severity`, () => {
        const d = fromError('CODE', new Error('test'), sev);
        expect(d.severity).toBe(sev);
        expect(d.code).toBe('CODE');
      });
    }
  });

  describe('diagnostic context variations', () => {
    it('context can be undefined', () => {
      const d = diagnostic('C', 'M');
      expect(d.context).toBeUndefined();
    });

    it('context with string values', () => {
      const d = diagnostic('C', 'M', 'ok', { key: 'value' });
      expect(d.context?.key).toBe('value');
    });

    it('context with number values', () => {
      const d = diagnostic('C', 'M', 'ok', { count: 42 });
      expect(d.context?.count).toBe(42);
    });

    it('context with nested object', () => {
      const d = diagnostic('C', 'M', 'ok', { nested: { deep: true } });
      expect((d.context?.nested as any)?.deep).toBe(true);
    });
  });
});
