import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemPlanStore } from './fs-plan-store.js';

describe('FilesystemPlanStore deep', () => {
  let tempDir: string;
  let store: FilesystemPlanStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-plan-deep-'));
    store = new FilesystemPlanStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('isApproved returns false for non-existent feature', async () => {
    const result = await store.isApproved('nonexistent');
    expect(result).toBe(false);
  });

  it('has revokeApproval method', () => {
    expect(typeof store.revokeApproval).toBe('function');
  });

  it('has syncPlanDescription method', () => {
    expect(typeof store.syncPlanDescription).toBe('function');
  });

  it('has approve method', () => {
    expect(typeof store.approve).toBe('function');
  });
});
