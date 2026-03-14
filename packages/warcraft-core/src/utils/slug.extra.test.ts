import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug extra edge cases', () => {
  describe('slugifyTaskName', () => {
    it('lowercases input', () => {
      expect(slugifyTaskName('Setup API')).toBe('setup-api');
    });

    it('replaces multiple spaces with single hyphen', () => {
      expect(slugifyTaskName('a   b')).toBe('a-b');
    });

    it('falls back to hash for empty string', () => {
      const result = slugifyTaskName('');
      expect(result).toMatch(/^task-[a-f0-9]+$/);
    });

    it('handles single word', () => {
      expect(slugifyTaskName('setup')).toBe('setup');
    });

    it('strips leading/trailing hyphens', () => {
      expect(slugifyTaskName('-setup-')).toBe('setup');
    });

    it('handles numbers', () => {
      expect(slugifyTaskName('v2 migration')).toBe('v2-migration');
    });
  });

  describe('deriveTaskFolder', () => {
    it('pads single digit order', () => {
      expect(deriveTaskFolder(1, 'setup')).toBe('01-setup');
    });

    it('pads double digit order', () => {
      expect(deriveTaskFolder(5, 'api')).toBe('05-api');
    });

    it('handles two-digit order', () => {
      expect(deriveTaskFolder(12, 'frontend')).toBe('12-frontend');
    });

    it('handles order > 99', () => {
      const result = deriveTaskFolder(100, 'task');
      expect(result).toContain('100');
      expect(result).toContain('task');
    });
  });

  describe('deriveDeterministicLocalId', () => {
    it('produces consistent output for same input', () => {
      const id1 = deriveDeterministicLocalId('my-feature');
      const id2 = deriveDeterministicLocalId('my-feature');
      expect(id1).toBe(id2);
    });

    it('produces different output for different input', () => {
      const id1 = deriveDeterministicLocalId('feature-a');
      const id2 = deriveDeterministicLocalId('feature-b');
      expect(id1).not.toBe(id2);
    });

    it('produces a string prefixed with local-', () => {
      const id = deriveDeterministicLocalId('test');
      expect(id).toStartWith('local-');
    });
  });

  describe('slugifyIdentifierSegment', () => {
    it('handles CamelCase', () => {
      const result = slugifyIdentifierSegment('MyComponent');
      expect(result).toBe('mycomponent');
    });

    it('handles special characters', () => {
      const result = slugifyIdentifierSegment('a@b#c');
      expect(result).toBe('a-b-c');
    });

    it('collapses consecutive hyphens', () => {
      const result = slugifyIdentifierSegment('a---b');
      expect(result).toBe('a-b');
    });

    it('trims hyphens from edges', () => {
      const result = slugifyIdentifierSegment('---test---');
      expect(result).toBe('test');
    });
  });
});
