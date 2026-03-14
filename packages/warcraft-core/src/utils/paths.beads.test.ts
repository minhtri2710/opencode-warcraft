import { describe, expect, it } from 'bun:test';
import { getFeaturePath, getPlanPath, getWarcraftDir, sanitizeName } from './paths.js';

describe('paths beads mode comparison', () => {
  it('off mode and on mode give different warcraft dirs', () => {
    const off = getWarcraftDir('off');
    const on = getWarcraftDir('on');
    expect(off).not.toBe(on);
  });

  it('off mode dir is docs', () => {
    expect(getWarcraftDir('off')).toBe('docs');
  });

  it('on mode dir contains beads', () => {
    expect(getWarcraftDir('on')).toContain('beads');
  });

  it('different modes give different feature paths', () => {
    const off = getFeaturePath('/p', 'feat', 'off');
    const on = getFeaturePath('/p', 'feat', 'on');
    expect(off).not.toBe(on);
  });

  it('different modes give different plan paths', () => {
    const off = getPlanPath('/p', 'feat', 'off');
    const on = getPlanPath('/p', 'feat', 'on');
    expect(off).not.toBe(on);
  });

  it('sanitizeName with numbers only is valid', () => {
    expect(sanitizeName('12345')).toBe('12345');
  });

  it('sanitizeName with hyphens and underscores', () => {
    expect(sanitizeName('a-b_c')).toBe('a-b_c');
  });

  it('sanitizeName with single character', () => {
    expect(sanitizeName('x')).toBe('x');
  });
});
