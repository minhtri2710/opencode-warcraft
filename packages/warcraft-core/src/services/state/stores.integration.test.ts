import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemTaskStore } from './fs-task-store.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';
import { FilesystemPlanStore } from './fs-plan-store.js';

describe('state stores integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stores-int-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('feature then plan workflow', () => {
    it('create feature then check plan not approved', async () => {
      const features = new FilesystemFeatureStore(tempDir);
      const plans = new FilesystemPlanStore(tempDir);
      await features.create({ name: 'my-feature' });
      const approved = await plans.isApproved('my-feature');
      expect(approved).toBe(false);
    });

    it('create feature and list it', async () => {
      const features = new FilesystemFeatureStore(tempDir);
      await features.create({ name: 'feat-a' });
      await features.create({ name: 'feat-b' });
      const list = await features.list();
      expect(list.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('task store operations', () => {
    it('list empty for new feature', async () => {
      const tasks = new FilesystemTaskStore(tempDir);
      expect(await tasks.list('new-feat')).toEqual([]);
    });

    it('get returns null for missing task', async () => {
      const tasks = new FilesystemTaskStore(tempDir);
      expect(await tasks.get('feat', '01-a')).toBeNull();
    });

    it('getNextOrder starts at 1', async () => {
      const tasks = new FilesystemTaskStore(tempDir);
      expect(await tasks.getNextOrder('new-feat')).toBe(1);
    });
  });

  describe('cross-store operations', () => {
    it('feature creation does not affect tasks', async () => {
      const features = new FilesystemFeatureStore(tempDir);
      const tasks = new FilesystemTaskStore(tempDir);
      await features.create({ name: 'isolated' });
      expect(await tasks.list('isolated')).toEqual([]);
    });

    it('stores are independent instances', () => {
      const f1 = new FilesystemFeatureStore(tempDir);
      const f2 = new FilesystemFeatureStore(tempDir);
      expect(f1).not.toBe(f2);
    });
  });
});
