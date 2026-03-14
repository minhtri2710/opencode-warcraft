import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemFeatureStore } from './fs-feature-store.js';

describe('FilesystemFeatureStore more', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-feat-more-'));
    store = new FilesystemFeatureStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('list returns empty for new project', async () => {
    const features = await store.list();
    expect(features).toEqual([]);
  });

  it('get returns null for non-existent feature', async () => {
    const feature = await store.get('nonexistent');
    expect(feature).toBeNull();
  });

  it('create then get round-trips', async () => {
    const created = await store.create({ name: 'my-feature' });
    expect(created.name).toBe('my-feature');
    const fetched = await store.get('my-feature');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('my-feature');
  });

  it('create then list includes feature', async () => {
    await store.create({ name: 'test-feat' });
    const features = await store.list();
    expect(features.length).toBeGreaterThan(0);
  });

  it('create returns feature object', async () => {
    const feature = await store.create({ name: 'new-feat' });
    expect(feature).toBeDefined();
    expect(feature.name).toBe('new-feat');
  });

  it('create feature is retrievable', async () => {
    await store.create({ name: 'dated-feat' });
    const feature = await store.get('dated-feat');
    expect(feature).not.toBeNull();
  });

  it('create with ticket', async () => {
    const feature = await store.create({ name: 'ticketed', ticket: 'PROJ-99' });
    expect(feature.name).toBe('ticketed');
  });

  it('create multiple features and list all', async () => {
    await store.create({ name: 'feat-a' });
    await store.create({ name: 'feat-b' });
    const features = await store.list();
    expect(features.length).toBeGreaterThanOrEqual(2);
  });
});
