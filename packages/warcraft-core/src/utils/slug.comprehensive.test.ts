import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug utilities comprehensive', () => {
  describe('slugifyTaskName', () => {
    it('lowercases', () => {
      expect(slugifyTaskName('HELLO')).toBe('hello');
    });

    it('replaces spaces with hyphens', () => {
      expect(slugifyTaskName('hello world')).toBe('hello-world');
    });

    it('handles multiple spaces', () => {
      const result = slugifyTaskName('hello   world');
      expect(result).not.toContain('  ');
    });

    it('removes special characters', () => {
      const result = slugifyTaskName('hello@world!');
      expect(result).not.toContain('@');
      expect(result).not.toContain('!');
    });

    it('handles empty string', () => {
      const result = slugifyTaskName('');
      expect(typeof result).toBe('string');
    });

    it('preserves numbers', () => {
      expect(slugifyTaskName('task123')).toContain('123');
    });
  });

  describe('slugifyIdentifierSegment', () => {
    it('lowercases', () => {
      expect(slugifyIdentifierSegment('ABC')).toBe('abc');
    });

    it('handles mixed input', () => {
      const result = slugifyIdentifierSegment('Hello World 123');
      expect(result).not.toContain(' ');
    });
  });

  describe('deriveDeterministicLocalId', () => {
    it('returns consistent results', () => {
      const a = deriveDeterministicLocalId('part1', 'part2');
      const b = deriveDeterministicLocalId('part1', 'part2');
      expect(a).toBe(b);
    });

    it('different inputs produce different IDs', () => {
      const a = deriveDeterministicLocalId('a');
      const b = deriveDeterministicLocalId('b');
      expect(a).not.toBe(b);
    });

    it('returns a string', () => {
      expect(typeof deriveDeterministicLocalId('test')).toBe('string');
    });

    it('returns non-empty string', () => {
      expect(deriveDeterministicLocalId('input').length).toBeGreaterThan(0);
    });
  });

  describe('deriveTaskFolder', () => {
    it('includes order number', () => {
      const result = deriveTaskFolder(1, 'setup');
      expect(result).toContain('01');
    });

    it('includes task name', () => {
      const result = deriveTaskFolder(1, 'setup');
      expect(result).toContain('setup');
    });

    it('pads order to 2 digits', () => {
      const result = deriveTaskFolder(5, 'task');
      expect(result).toContain('05');
    });

    it('handles double-digit order', () => {
      const result = deriveTaskFolder(12, 'task');
      expect(result).toContain('12');
    });

    it('slugifies task name', () => {
      const result = deriveTaskFolder(1, 'My Task Name');
      expect(result).not.toContain(' ');
    });
  });
});
