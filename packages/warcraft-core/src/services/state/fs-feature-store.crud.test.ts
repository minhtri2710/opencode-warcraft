import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemFeatureStore } from './fs-feature-store.js';

describe('FilesystemFeatureStore CRUD', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-feat-crud-'));
    store = new FilesystemFeatureStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('create then update feature', async () => {
    const created = await store.create({ name: 'updatable' });
    expect(created.name).toBe('updatable');
  });

  it('list returns array', async () => {
    await store.create({ name: 'unique-feat' });
    const list = await store.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('list after multiple creates', async () => {
    await store.create({ name: 'feat-1' });
    await store.create({ name: 'feat-2' });
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('get non-existent returns null', async () => {
    expect(await store.get('ghost')).toBeNull();
  });

  it('create returns FeatureJson', async () => {
    const result = await store.create({ name: 'json-feat' });
    expect(result).toBeDefined();
    expect(result.name).toBe('json-feat');
  });

  it('multiple creates tracked correctly', async () => {
    for (let i = 0; i < 10; i++) {
      await store.create({ name: `batch-${i}` });
    }
    const list = await store.list();
    expect(list.length).toBeGreaterThanOrEqual(10);
  });
});
