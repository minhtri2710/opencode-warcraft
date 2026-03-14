import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemTaskStore } from './fs-task-store.js';

describe('FilesystemTaskStore deep', () => {
  let tempDir: string;
  let store: FilesystemTaskStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-task-deep-'));
    store = new FilesystemTaskStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('list returns empty for non-existent feature', async () => {
    const tasks = await store.list('nonexistent');
    expect(tasks).toEqual([]);
  });

  it('get returns null for non-existent task', async () => {
    const task = await store.get('nonexistent', '01-task');
    expect(task).toBeNull();
  });

  it('has createTask method', () => {
    expect(typeof store.createTask).toBe('function');
  });

  it('has getNextOrder method', () => {
    expect(typeof store.getNextOrder).toBe('function');
  });

  it('has save method', () => {
    expect(typeof store.save).toBe('function');
  });

  it('has delete method', () => {
    expect(typeof store.delete).toBe('function');
  });

  it('has writeArtifact method', () => {
    expect(typeof store.writeArtifact).toBe('function');
  });

  it('has readArtifact method', () => {
    expect(typeof store.readArtifact).toBe('function');
  });

  it('has getRunnableTasks method', () => {
    expect(typeof store.getRunnableTasks).toBe('function');
  });

  it('has flush method', () => {
    expect(typeof store.flush).toBe('function');
  });

  it('getNextOrder returns 1 for empty feature', async () => {
    const order = await store.getNextOrder('new-feature');
    expect(order).toBe(1);
  });

  it('getRunnableTasks returns result for non-existent feature', async () => {
    const result = await store.getRunnableTasks('nonexistent');
    expect(result).toBeDefined();
  });
});
