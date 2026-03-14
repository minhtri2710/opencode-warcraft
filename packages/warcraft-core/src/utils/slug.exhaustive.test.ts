import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug exhaustive', () => {
  describe('slugifyTaskName with international chars', () => {
    const INPUTS = ['café au lait', 'naïve', 'résumé', 'über cool', 'piñata party', 'El Niño', 'Straße'];
    for (const input of INPUTS) {
      it(`slugifies "${input}"`, () => {
        const result = slugifyTaskName(input);
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toContain(' ');
      });
    }
  });

  describe('deriveTaskFolder for all orders 1-20', () => {
    for (let i = 1; i <= 20; i++) {
      it(`order ${i} produces valid folder`, () => {
        const result = deriveTaskFolder(i, 'task');
        expect(result.length).toBeGreaterThan(0);
        expect(result).toContain(String(i).padStart(2, '0'));
      });
    }
  });

  describe('deriveDeterministicLocalId consistency', () => {
    const INPUTS = [['a'], ['b'], ['a', 'b'], ['a', 'b', 'c'], ['test'], ['test', 'extra'], ['hello world']];
    for (const parts of INPUTS) {
      it(`[${parts.join(', ')}] is deterministic`, () => {
        const a = deriveDeterministicLocalId(...parts);
        const b = deriveDeterministicLocalId(...parts);
        expect(a).toBe(b);
      });
    }
  });
});
