import { describe, expect, it } from 'bun:test';
import { isBeadsEnabled, requireBeadsEnabled } from './beadsMode.js';

describe('beadsMode combinatorial', () => {
  const MODES = ['on', 'off'] as const;

  for (const mode of MODES) {
    const provider = { getBeadsMode: () => mode };

    it(`isBeadsEnabled with ${mode}`, () => {
      expect(isBeadsEnabled(provider)).toBe(mode === 'on');
    });

    it(`requireBeadsEnabled with ${mode}`, () => {
      if (mode === 'on') {
        expect(() => requireBeadsEnabled(provider)).not.toThrow();
      } else {
        expect(() => requireBeadsEnabled(provider)).toThrow();
      }
    });
  }

  it('isBeadsEnabled returns boolean', () => {
    expect(typeof isBeadsEnabled({ getBeadsMode: () => 'on' })).toBe('boolean');
  });

  it('requireBeadsEnabled error message mentions beads', () => {
    try {
      requireBeadsEnabled({ getBeadsMode: () => 'off' });
    } catch (err: any) {
      expect(err.message.toLowerCase()).toContain('bead');
    }
  });
});
