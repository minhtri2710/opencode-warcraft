import { describe, expect, it } from 'bun:test';
import { deriveDeterministicLocalId, deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

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

    it('zero-pads single digit orders', () => {
      expect(deriveTaskFolder(1, 'test')).toBe('01-test');
      expect(deriveTaskFolder(9, 'test')).toBe('09-test');
    });

    it('does not zero-pad two digit orders', () => {
      expect(deriveTaskFolder(10, 'test')).toBe('10-test');
      expect(deriveTaskFolder(99, 'test')).toBe('99-test');
    });
  });

  describe('slugifyIdentifierSegment', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(slugifyIdentifierSegment('My Feature')).toBe('my-feature');
    });

    it('normalizes Unicode characters', () => {
      expect(slugifyIdentifierSegment('Café')).toBe('cafe');
    });

    it('replaces non-alphanumeric characters with hyphens', () => {
      expect(slugifyIdentifierSegment('hello@world!')).toBe('hello-world');
    });

    it('converts underscores to hyphens', () => {
      expect(slugifyIdentifierSegment('hello_world')).toBe('hello-world');
    });

    it('collapses consecutive hyphens', () => {
      expect(slugifyIdentifierSegment('a---b')).toBe('a-b');
    });

    it('falls back to hash for empty slug', () => {
      const result = slugifyIdentifierSegment('!!!');
      expect(result).toMatch(/^id-[a-f0-9]{8}$/);
    });
  });

  describe('deriveDeterministicLocalId', () => {
    it('creates local- prefixed ID from parts', () => {
      expect(deriveDeterministicLocalId('my-feature', '01-setup')).toBe('local-my-feature-01-setup');
    });

    it('slugifies parts', () => {
      expect(deriveDeterministicLocalId('My Feature', 'Setup Task')).toBe('local-my-feature-setup-task');
    });

    it('produces consistent IDs for same inputs', () => {
      const a = deriveDeterministicLocalId('feat', 'task');
      const b = deriveDeterministicLocalId('feat', 'task');
      expect(a).toBe(b);
    });
  });
});
