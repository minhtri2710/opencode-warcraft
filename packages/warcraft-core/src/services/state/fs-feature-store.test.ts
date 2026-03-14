import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureJson } from '../../types.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';

describe('FilesystemFeatureStore', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-feature-store-test-'));
    store = new FilesystemFeatureStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('exists()', () => {
    it('returns false when feature does not exist', () => {
      expect(store.exists('non-existent')).toBe(false);
    });

    it('returns true after feature is created', () => {
      store.create(
        { name: 'my-feature', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );
      expect(store.exists('my-feature')).toBe(true);
    });
  });

  describe('create()', () => {
    it('creates feature directory structure with feature.json, context/, and tasks/', () => {
      const result = store.create(
        { name: 'my-feature', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );

      expect(result.name).toBe('my-feature');
      expect(result.status).toBe('planning');
      expect(result.epicBeadId).toBeDefined();

      const featurePath = path.join(tempDir, 'docs', 'my-feature');
      expect(fs.existsSync(featurePath)).toBe(true);
      expect(fs.existsSync(path.join(featurePath, 'feature.json'))).toBe(true);
      expect(fs.existsSync(path.join(featurePath, 'context'))).toBe(true);
      expect(fs.existsSync(path.join(featurePath, 'tasks'))).toBe(true);
    });

    it('throws when feature already exists', () => {
      store.create(
        { name: 'my-feature', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );
      expect(() =>
        store.create(
          { name: 'my-feature', status: 'planning', createdAt: '2024-01-02T00:00:00Z' },
          3,
        ),
      ).toThrow("Feature 'my-feature' already exists");
    });

    it('includes ticket when provided', () => {
      const result = store.create(
        { name: 'ticketed', status: 'planning', createdAt: '2024-01-01T00:00:00Z', ticket: 'PROJ-42' },
        3,
      );
      expect(result.ticket).toBe('PROJ-42');
    });

    it('derives epicBeadId deterministically from name', () => {
      const r1 = store.create(
        { name: 'deterministic-test', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        1,
      );
      // Clean up and recreate to verify determinism
      fs.rmSync(path.join(tempDir, 'docs', 'deterministic-test'), { recursive: true, force: true });
      const r2 = store.create(
        { name: 'deterministic-test', status: 'planning', createdAt: '2024-01-02T00:00:00Z' },
        1,
      );
      expect(r1.epicBeadId).toBe(r2.epicBeadId);
    });

    it('sets createdAt from input', () => {
      const result = store.create(
        { name: 'ts-feature', status: 'planning', createdAt: '2025-06-15T12:00:00Z' },
        3,
      );
      expect(result.createdAt).toBe('2025-06-15T12:00:00Z');
    });
  });

  describe('get()', () => {
    it('returns null for non-existent feature', () => {
      expect(store.get('non-existent')).toBeNull();
    });

    it('returns stored feature data', () => {
      store.create(
        { name: 'my-feature', status: 'planning', createdAt: '2024-01-01T00:00:00Z', ticket: 'ABC-1' },
        3,
      );
      const result = store.get('my-feature');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-feature');
      expect(result!.status).toBe('planning');
      expect(result!.ticket).toBe('ABC-1');
    });
  });

  describe('list()', () => {
    it('returns empty array when no features exist', () => {
      expect(store.list()).toEqual([]);
    });

    it('returns sorted list of feature names', () => {
      store.create({ name: 'beta', status: 'planning', createdAt: '2024-01-01T00:00:00Z' }, 3);
      store.create({ name: 'alpha', status: 'planning', createdAt: '2024-01-01T00:00:00Z' }, 3);
      store.create({ name: 'gamma', status: 'planning', createdAt: '2024-01-01T00:00:00Z' }, 3);

      expect(store.list()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('excludes directories without feature.json', () => {
      store.create({ name: 'real-feature', status: 'planning', createdAt: '2024-01-01T00:00:00Z' }, 3);
      // Create a directory without feature.json
      fs.mkdirSync(path.join(tempDir, 'docs', 'stale-dir'), { recursive: true });

      expect(store.list()).toEqual(['real-feature']);
    });
  });

  describe('save()', () => {
    it('persists updated feature data', () => {
      const created = store.create(
        { name: 'save-test', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );

      const updated: FeatureJson = { ...created, status: 'approved', approvedAt: '2024-01-02T00:00:00Z' };
      store.save(updated);

      const loaded = store.get('save-test');
      expect(loaded!.status).toBe('approved');
      expect(loaded!.approvedAt).toBe('2024-01-02T00:00:00Z');
    });
  });

  describe('complete() and reopen()', () => {
    it('complete persists the feature (same as save)', () => {
      const created = store.create(
        { name: 'complete-test', status: 'planning', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );

      const completed: FeatureJson = { ...created, status: 'completed', completedAt: '2024-01-02T00:00:00Z' };
      store.complete(completed);

      const loaded = store.get('complete-test');
      expect(loaded!.status).toBe('completed');
      expect(loaded!.completedAt).toBe('2024-01-02T00:00:00Z');
    });

    it('reopen persists the feature (same as save)', () => {
      const created = store.create(
        { name: 'reopen-test', status: 'completed', createdAt: '2024-01-01T00:00:00Z' },
        3,
      );

      const reopened: FeatureJson = { ...created, status: 'executing' };
      store.reopen(reopened);

      const loaded = store.get('reopen-test');
      expect(loaded!.status).toBe('executing');
    });
  });
});
