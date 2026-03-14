import { describe, expect, it } from 'bun:test';
import type { BeadsModeProvider } from '../../types.js';
import { isBeadsEnabled, requireBeadsEnabled } from './beadsMode.js';

function createProvider(mode: 'on' | 'off'): BeadsModeProvider {
  return { getBeadsMode: () => mode };
}

describe('isBeadsEnabled', () => {
  it('returns true when beadsMode is on', () => {
    expect(isBeadsEnabled(createProvider('on'))).toBe(true);
  });

  it('returns false when beadsMode is off', () => {
    expect(isBeadsEnabled(createProvider('off'))).toBe(false);
  });
});

describe('requireBeadsEnabled', () => {
  it('does not throw when beadsMode is on', () => {
    expect(() => requireBeadsEnabled(createProvider('on'))).not.toThrow();
  });

  it('throws when beadsMode is off', () => {
    expect(() => requireBeadsEnabled(createProvider('off'))).toThrow(/beads mode is required/i);
  });

  it('includes context in error message when provided', () => {
    expect(() => requireBeadsEnabled(createProvider('off'), 'for sync operation')).toThrow('for sync operation');
  });

  it('throws without context when not provided', () => {
    expect(() => requireBeadsEnabled(createProvider('off'))).toThrow("Beads mode is required but is currently 'off'.");
  });
});
