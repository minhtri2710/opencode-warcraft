import { describe, expect, it } from 'bun:test';
import type { BeadsModeProvider } from '../../types.js';
import { isBeadsEnabled, requireBeadsEnabled } from './beadsMode.js';

function onProvider(): BeadsModeProvider {
  return { getBeadsMode: () => 'on' };
}

function offProvider(): BeadsModeProvider {
  return { getBeadsMode: () => 'off' };
}

describe('beadsMode extra', () => {
  it('isBeadsEnabled returns true for on provider', () => {
    expect(isBeadsEnabled(onProvider())).toBe(true);
  });

  it('isBeadsEnabled returns false for off provider', () => {
    expect(isBeadsEnabled(offProvider())).toBe(false);
  });

  it('requireBeadsEnabled does not throw for on provider', () => {
    expect(() => requireBeadsEnabled(onProvider())).not.toThrow();
  });

  it('requireBeadsEnabled throws for off provider', () => {
    expect(() => requireBeadsEnabled(offProvider())).toThrow();
  });

  it('requireBeadsEnabled includes context in error', () => {
    try {
      requireBeadsEnabled(offProvider(), 'test operation');
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain('test operation');
    }
  });

  it('requireBeadsEnabled does not throw for on provider with context', () => {
    expect(() => requireBeadsEnabled(onProvider(), 'ctx')).not.toThrow();
  });
});
