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

describe('outcomes combinatorial', () => {
  const SEVERITIES = ['ok', 'degraded', 'fatal'] as const;
  const VALUES = [0, '', null, 42, 'str', false, true, [], {}];

  describe('ok with all value types', () => {
    for (const val of VALUES) {
      it(`ok(${JSON.stringify(val)}) is usable`, () => {
        const result = ok(val);
        expect(result.severity).toBe('ok');
        if (val !== undefined) {
          expect(isUsable(result)).toBe(true);
        }
      });
    }
  });

  describe('degraded with all value types', () => {
    for (const val of VALUES) {
      it(`degraded(${JSON.stringify(val)}) is usable`, () => {
        const result = degraded(val, [diagnostic('w', 'warning')]);
        expect(result.severity).toBe('degraded');
        expect(isUsable(result)).toBe(true);
      });
    }
  });

  describe('worstSeverity all triple combinations', () => {
    for (const s1 of SEVERITIES) {
      for (const s2 of SEVERITIES) {
        for (const s3 of SEVERITIES) {
          it(`worst of ${s1},${s2},${s3}`, () => {
            const diags = [
              diagnostic('a', 'a', s1),
              diagnostic('b', 'b', s2),
              diagnostic('c', 'c', s3),
            ];
            const worst = worstSeverity(diags);
            if (s1 === 'fatal' || s2 === 'fatal' || s3 === 'fatal') {
              expect(worst).toBe('fatal');
            } else if (s1 === 'degraded' || s2 === 'degraded' || s3 === 'degraded') {
              expect(worst).toBe('degraded');
            } else {
              expect(worst).toBe('ok');
            }
          });
        }
      }
    }
  });
});
