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

    it('normalizes accented characters to ASCII equivalents', () => {
      expect(slugifyTaskName('Café setup')).toBe('cafe-setup');
      expect(slugifyTaskName('Résumé handler')).toBe('resume-handler');
      expect(slugifyTaskName('naïve über task')).toBe('naive-uber-task');
    });

    it('truncates very long names with hash suffix', () => {
      const longName =
        'Implement the comprehensive distributed event-driven microservice architecture with fault-tolerant state management';
      const result = slugifyTaskName(longName);
      expect(result.length).toBeLessThanOrEqual(60);
      // Should end with a 6-char hash
      expect(result).toMatch(/-[a-f0-9]{6}$/);
      // Should preserve meaningful prefix
      expect(result).toStartWith('implement-the-comprehensive');
    });

    it('does not truncate names within length limit', () => {
      const normalName = 'Setup API client';
      const result = slugifyTaskName(normalName);
      expect(result).toBe('setup-api-client');
      expect(result).not.toMatch(/-[a-f0-9]{6}$/);
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
