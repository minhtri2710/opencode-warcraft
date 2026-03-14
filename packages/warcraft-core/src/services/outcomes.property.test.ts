import { describe, expect, it } from 'bun:test';
import { collectOutcomes, degraded, diagnostic, fatal, isUsable, ok, okVoid, worstSeverity } from './outcomes.js';

describe('outcomes property-based validation', () => {
  describe('isUsable is consistent with severity', () => {
    it('ok outcomes are always usable', () => {
      for (const val of [0, '', null, false, 42, 'str', [], {}]) {
        expect(isUsable(ok(val))).toBe(true);
      }
    });

    it('degraded outcomes are always usable', () => {
      const d = [diagnostic('w', 'warn')];
      expect(isUsable(degraded(42, d))).toBe(true);
      expect(isUsable(degraded('', d))).toBe(true);
      expect(isUsable(degraded(null, d))).toBe(true);
    });

    it('fatal outcomes are never usable', () => {
      const d = [diagnostic('e', 'error', 'fatal')];
      expect(isUsable(fatal(d))).toBe(false);
    });
  });

  describe('worstSeverity follows ordering', () => {
    it('empty is ok', () => {
      expect(worstSeverity([])).toBe('ok');
    });

    it('all ok stays ok', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'ok')];
      expect(worstSeverity(diags)).toBe('ok');
    });

    it('degraded beats ok', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'degraded')];
      expect(worstSeverity(diags)).toBe('degraded');
    });

    it('fatal beats everything', () => {
      const diags = [diagnostic('a', 'a', 'ok'), diagnostic('b', 'b', 'degraded'), diagnostic('c', 'c', 'fatal')];
      expect(worstSeverity(diags)).toBe('fatal');
    });
  });

  describe('collectOutcomes preserves all diagnostics', () => {
    it('merges diagnostics from multiple outcomes', () => {
      const o1 = degraded(undefined, [diagnostic('a', 'diag-a')]);
      const o2 = degraded(undefined, [diagnostic('b', 'diag-b')]);
      const o3 = degraded(undefined, [diagnostic('c', 'diag-c')]);
      const result = collectOutcomes([o1, o2, o3]);
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
    });

    it('empty outcomes produce ok', () => {
      expect(collectOutcomes([]).severity).toBe('ok');
    });

    it('all ok outcomes produce ok', () => {
      expect(collectOutcomes([okVoid(), okVoid(), okVoid()]).severity).toBe('ok');
    });
  });
});
