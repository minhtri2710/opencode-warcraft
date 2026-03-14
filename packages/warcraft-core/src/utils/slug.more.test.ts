import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug more edge cases', () => {
  describe('deriveTaskFolder', () => {
    it('pads single digit order', () => {
      expect(deriveTaskFolder(1, 'Setup')).toMatch(/^01-/);
    });

    it('pads double digit order', () => {
      expect(deriveTaskFolder(10, 'Build')).toMatch(/^10-/);
    });

    it('handles special characters in name', () => {
      const folder = deriveTaskFolder(1, 'Add API (v2) endpoints');
      expect(folder).toMatch(/^01-/);
      expect(folder).not.toContain('(');
      expect(folder).not.toContain(')');
    });

    it('handles very long names', () => {
      const longName = 'A'.repeat(200);
      const folder = deriveTaskFolder(1, longName);
      expect(folder.length).toBeLessThan(200);
    });

    it('handles emoji in name', () => {
      const folder = deriveTaskFolder(1, '🚀 Deploy');
      expect(folder).toMatch(/^01-/);
    });
  });

  describe('slugifyTaskName', () => {
    it('lowercases', () => {
      expect(slugifyTaskName('UPPER')).toBe(slugifyTaskName('upper'));
    });

    it('replaces spaces with hyphens', () => {
      expect(slugifyTaskName('hello world')).toContain('-');
    });

    it('removes consecutive hyphens', () => {
      const slug = slugifyTaskName('hello --- world');
      expect(slug).not.toContain('--');
    });
  });

  describe('slugifyIdentifierSegment', () => {
    it('handles hyphens in input', () => {
      const result = slugifyIdentifierSegment('my-project');
      expect(result).toBe('my-project');
    });

    it('handles underscores', () => {
      const result = slugifyIdentifierSegment('my_project');
      expect(result).toContain('my');
    });

    it('handles uppercase', () => {
      const result = slugifyIdentifierSegment('MyProject');
      expect(result).toBe(result.toLowerCase());
    });
  });

  describe('deriveDeterministicLocalId', () => {
    it('produces same ID for same inputs', () => {
      const id1 = deriveDeterministicLocalId('feat', 'task');
      const id2 = deriveDeterministicLocalId('feat', 'task');
      expect(id1).toBe(id2);
    });

    it('produces different IDs for different features', () => {
      const id1 = deriveDeterministicLocalId('feat-a', 'task');
      const id2 = deriveDeterministicLocalId('feat-b', 'task');
      expect(id1).not.toBe(id2);
    });

    it('produces different IDs for different tasks', () => {
      const id1 = deriveDeterministicLocalId('feat', 'task-a');
      const id2 = deriveDeterministicLocalId('feat', 'task-b');
      expect(id1).not.toBe(id2);
    });

    it('starts with local- prefix', () => {
      const id = deriveDeterministicLocalId('f', 't');
      expect(id.startsWith('local-')).toBe(true);
    });
  });
});
