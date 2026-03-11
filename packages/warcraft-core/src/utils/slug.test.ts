import { describe, expect, it } from 'bun:test';
import { deriveTaskFolder, slugifyTaskName } from './slug.js';

describe('slug utilities', () => {
  describe('slugifyTaskName', () => {
    it('keeps existing slugs for normal task names', () => {
      expect(slugifyTaskName('Build API Client')).toBe('build-api-client');
      expect(slugifyTaskName('feature-flag cleanup')).toBe('feature-flag-cleanup');
    });

    it('falls back to deterministic hashes for punctuation-only names', () => {
      expect(slugifyTaskName('!!!')).toBe('task-e84c538e');
      expect(slugifyTaskName('---')).toBe('task-cb3f91d5');
      expect(slugifyTaskName('   ???   ')).toBe('task-9415a90b');
    });
  });

  describe('deriveTaskFolder', () => {
    it('never emits an empty trailing slug segment', () => {
      expect(deriveTaskFolder(1, '!!!')).toBe('01-task-e84c538e');
      expect(deriveTaskFolder(2, '---')).toBe('02-task-cb3f91d5');
      expect(deriveTaskFolder(3, '   ???   ')).toBe('03-task-9415a90b');
    });
  });
});
