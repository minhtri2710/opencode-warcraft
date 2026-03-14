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

    it('collapses consecutive hyphens from special characters', () => {
      expect(slugifyTaskName('Hello -- World')).toBe('hello-world');
      expect(slugifyTaskName('API (v2) Setup')).toBe('api-v2-setup');
      expect(slugifyTaskName('test___multiple___separators')).toBe('test-multiple-separators');
    });

    it('converts underscores to hyphens', () => {
      expect(slugifyTaskName('hello_world')).toBe('hello-world');
      expect(slugifyTaskName('setup_api_client')).toBe('setup-api-client');
    });

    it('strips leading and trailing hyphens', () => {
      expect(slugifyTaskName('-leading')).toBe('leading');
      expect(slugifyTaskName('trailing-')).toBe('trailing');
      expect(slugifyTaskName('-both-')).toBe('both');
      expect(slugifyTaskName('--multiple-leading')).toBe('multiple-leading');
    });
  });

  describe('deriveTaskFolder', () => {
    it('never emits an empty trailing slug segment', () => {
      expect(deriveTaskFolder(1, '!!!')).toBe('01-task-e84c538e');
      expect(deriveTaskFolder(2, '---')).toBe('02-task-cb3f91d5');
      expect(deriveTaskFolder(3, '   ???   ')).toBe('03-task-9415a90b');
    });

    it('produces clean folder names from names with special characters', () => {
      expect(deriveTaskFolder(1, 'Hello -- World')).toBe('01-hello-world');
      expect(deriveTaskFolder(2, 'API (v2) Setup')).toBe('02-api-v2-setup');
    });
  });
});
