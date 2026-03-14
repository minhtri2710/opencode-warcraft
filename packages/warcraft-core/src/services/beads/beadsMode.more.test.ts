import { describe, expect, it } from 'bun:test';
import type { BeadsModeProvider } from '../state/types.js';
import { isBeadsEnabled, requireBeadsEnabled } from './beadsMode.js';

describe('beadsMode more scenarios', () => {
  const onProvider: BeadsModeProvider = { getBeadsMode: () => 'on' };
  const offProvider: BeadsModeProvider = { getBeadsMode: () => 'off' };

  describe('isBeadsEnabled', () => {
    it('returns true when mode is on', () => {
      expect(isBeadsEnabled(onProvider)).toBe(true);
    });

    it('returns false when mode is off', () => {
      expect(isBeadsEnabled(offProvider)).toBe(false);
    });
  });

  describe('requireBeadsEnabled', () => {
    it('does not throw when enabled', () => {
      expect(() => requireBeadsEnabled(onProvider)).not.toThrow();
    });

    it('throws when disabled', () => {
      expect(() => requireBeadsEnabled(offProvider)).toThrow();
    });

    it('throws with context message', () => {
      expect(() => requireBeadsEnabled(offProvider, 'test context')).toThrow();
    });

    it('does not throw with context when enabled', () => {
      expect(() => requireBeadsEnabled(onProvider, 'test context')).not.toThrow();
    });
  });
});
