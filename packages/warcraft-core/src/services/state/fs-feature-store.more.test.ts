import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureJson } from '../../types.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';

describe('FilesystemFeatureStore more edge cases', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-feature-more-'));
    store = new FilesystemFeatureStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('create with all optional fields', () => {
    const result = store.create(
      { name: 'full', status: 'planning', createdAt: '2024-01-01', ticket: 'T-1' },
      3,
    );
    expect(result.name).toBe('full');
    expect(result.ticket).toBe('T-1');
  });

  it('save updates existing feature without creating new dirs', () => {
    const created = store.create(
      { name: 'save-existing', status: 'planning', createdAt: '2024-01-01' },
      3,
    );
    const updated = { ...created, status: 'approved' as const, approvedAt: '2024-01-02' };
    store.save(updated);
    const loaded = store.get('save-existing');
    expect(loaded?.status).toBe('approved');
  });

  it('list with many features remains sorted', () => {
    for (const name of ['zebra', 'apple', 'mango', 'banana']) {
      store.create({ name, status: 'planning', createdAt: '2024-01-01' }, 3);
    }
    expect(store.list()).toEqual(['apple', 'banana', 'mango', 'zebra']);
  });

  it('complete followed by reopen round-trips correctly', () => {
    const created = store.create(
      { name: 'round-trip', status: 'planning', createdAt: '2024-01-01' },
      3,
    );
    const completed: FeatureJson = { ...created, status: 'completed', completedAt: '2024-02-01' };
    store.complete(completed);
    expect(store.get('round-trip')?.status).toBe('completed');

    const reopened: FeatureJson = { ...completed, status: 'executing' };
    delete reopened.completedAt;
    store.reopen(reopened);
    expect(store.get('round-trip')?.status).toBe('executing');
    expect(store.get('round-trip')?.completedAt).toBeUndefined();
  });

  it('exists returns true for directory even without feature.json', () => {
    fs.mkdirSync(path.join(tempDir, 'docs', 'ghost-dir'), { recursive: true });
    // exists checks directory presence, not feature.json
    expect(store.exists('ghost-dir')).toBe(true);
  });

  it('list excludes directory without feature.json', () => {
    store.create({ name: 'real', status: 'planning', createdAt: '2024-01-01' }, 3);
    fs.mkdirSync(path.join(tempDir, 'docs', 'ghost'), { recursive: true });
    expect(store.list()).toEqual(['real']);
  });
});
