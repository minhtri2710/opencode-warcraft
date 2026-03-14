import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyTaskName } from './slug.js';

describe('slug matrix', () => {
  // Test deriveTaskFolder for orders 1-50
  describe('deriveTaskFolder orders 1-50', () => {
    const names = ['setup', 'build-core', 'write-tests', 'deploy', 'cleanup'];
    for (let order = 1; order <= 50; order++) {
      const name = names[order % names.length];
      it(`order ${order} → ${name}`, () => {
        const folder = deriveTaskFolder(order, name);
        expect(folder.length).toBeGreaterThan(0);
        // Folder should start with zero-padded order
        const prefix = String(order).padStart(2, '0');
        expect(folder.startsWith(prefix)).toBe(true);
      });
    }
  });

  describe('slugifyTaskName special inputs', () => {
    const INPUTS = [
      'Simple',
      'Two Words',
      'three separate words',
      'UPPERCASE',
      'mixedCase',
      'with-dashes',
      'with_underscores',
      'with.dots',
      'with/slashes',
      'with (parens)',
      'with [brackets]',
      'with {braces}',
      '123numeric',
      'end123',
      'mid123dle',
      'café',
      'über',
      'naïve',
      'a',
      'ab',
      'abc',
      'very long task name that goes on and on and on to test truncation behavior',
    ];

    for (const input of INPUTS) {
      it(`"${input.slice(0, 30)}" produces valid slug`, () => {
        const slug = slugifyTaskName(input);
        expect(slug.length).toBeGreaterThan(0);
        // Slug should only contain alphanumeric and hyphens
        expect(slug).toMatch(/^[a-z0-9-]+$/);
      });
    }
  });

  describe('deriveDeterministicLocalId consistency matrix', () => {
    const INPUTS = [
      ['a'],
      ['b'],
      ['c'],
      ['a', 'b'],
      ['b', 'a'], // order matters
      ['feature', 'task', 'extra'],
      ['same', 'same', 'same'],
    ];

    for (const parts of INPUTS) {
      it(`[${parts.join(',')}] is deterministic`, () => {
        const id1 = deriveDeterministicLocalId(...parts);
        const id2 = deriveDeterministicLocalId(...parts);
        expect(id1).toBe(id2);
      });
    }

    it('different inputs produce different IDs', () => {
      const id1 = deriveDeterministicLocalId('x');
      const id2 = deriveDeterministicLocalId('y');
      expect(id1).not.toBe(id2);
    });

    it('order matters', () => {
      const id1 = deriveDeterministicLocalId('a', 'b');
      const id2 = deriveDeterministicLocalId('b', 'a');
      expect(id1).not.toBe(id2);
    });
  });
});
