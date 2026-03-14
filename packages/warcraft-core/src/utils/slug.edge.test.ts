import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug edge cases', () => {
  describe('slugifyTaskName edge cases', () => {
    it('handles consecutive hyphens', () => {
      const result = slugifyTaskName('hello---world');
      expect(result).not.toMatch(/---/);
    });

    it('handles trailing spaces', () => {
      const result = slugifyTaskName('trailing  ');
      expect(result).not.toMatch(/\s/);
    });

    it('handles leading spaces', () => {
      const result = slugifyTaskName('  leading');
      expect(result).not.toMatch(/^\s/);
    });

    it('handles tabs', () => {
      const result = slugifyTaskName('tab\there');
      expect(result).not.toContain('\t');
    });

    it('handles mixed case and numbers', () => {
      const result = slugifyTaskName('Task123ABC');
      expect(result).toBe('task123abc');
    });

    it('handles parentheses', () => {
      const result = slugifyTaskName('task (optional)');
      expect(result).not.toContain('(');
    });
  });

  describe('deriveTaskFolder edge cases', () => {
    it('order 0 gives 00 prefix', () => {
      const result = deriveTaskFolder(0, 'task');
      expect(result).toContain('00');
    });

    it('order 99 gives 99 prefix', () => {
      const result = deriveTaskFolder(99, 'task');
      expect(result).toContain('99');
    });

    it('handles long task names', () => {
      const result = deriveTaskFolder(1, 'a-very-long-task-name-that-goes-on-and-on');
      expect(result.length).toBeGreaterThan(0);
    });

    it('different orders produce different folders', () => {
      const a = deriveTaskFolder(1, 'task');
      const b = deriveTaskFolder(2, 'task');
      expect(a).not.toBe(b);
    });
  });

  describe('deriveDeterministicLocalId edge cases', () => {
    it('empty string produces a valid ID', () => {
      const result = deriveDeterministicLocalId('');
      expect(result.length).toBeGreaterThan(0);
    });

    it('very long input produces a valid ID', () => {
      const result = deriveDeterministicLocalId('x'.repeat(10000));
      expect(result.length).toBeGreaterThan(0);
    });

    it('multiple parts produce different ID than single combined', () => {
      const multi = deriveDeterministicLocalId('a', 'b');
      const single = deriveDeterministicLocalId('ab');
      expect(multi).not.toBe(single);
    });
  });
});
