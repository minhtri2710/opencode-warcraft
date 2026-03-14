import { describe, expect, it } from 'bun:test';
import { diagnostic, type Severity, worstSeverity } from './outcomes.js';

describe('outcomes worstSeverity matrix', () => {
  const SEVERITIES: Severity[] = ['ok', 'degraded', 'fatal'];

  // 4-way combinations: 3^4 = 81 tests
  for (const s1 of SEVERITIES) {
    for (const s2 of SEVERITIES) {
      for (const s3 of SEVERITIES) {
        for (const s4 of SEVERITIES) {
          it(`worst of ${s1},${s2},${s3},${s4}`, () => {
            const diags = [
              diagnostic('a', 'a', s1),
              diagnostic('b', 'b', s2),
              diagnostic('c', 'c', s3),
              diagnostic('d', 'd', s4),
            ];
            const worst = worstSeverity(diags);
            const all = [s1, s2, s3, s4];
            if (all.includes('fatal')) {
              expect(worst).toBe('fatal');
            } else if (all.includes('degraded')) {
              expect(worst).toBe('degraded');
            } else {
              expect(worst).toBe('ok');
            }
          });
        }
      }
    }
  }
});
