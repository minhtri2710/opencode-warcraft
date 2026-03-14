import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskStatus } from '../../types.js';
import { FilesystemTaskStore } from './fs-task-store.js';

describe('FilesystemTaskStore extra', () => {
  let tempDir: string;
  let store: FilesystemTaskStore;

  function makeStatus(overrides: Partial<TaskStatus> = {}): TaskStatus {
    return {
      status: 'pending',
      origin: 'plan',
      planTitle: 'Test',
      ...overrides,
    } as TaskStatus;
  }

  function setupFeature(name: string): void {
    const dir = path.join(tempDir, 'docs', name, 'tasks');
    fs.mkdirSync(dir, { recursive: true });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-task-extra-'));
    store = new FilesystemTaskStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('createTask generates deterministic local ID without repository', () => {
    setupFeature('feat');
    const result = store.createTask('feat', '01-setup', 'Setup', makeStatus(), 3);
    expect(result.beadId).toBeTruthy();
    expect(result.beadId!.startsWith('local-')).toBe(true);
  });

  it('createTask is idempotent for same feature/folder (overwrites)', () => {
    setupFeature('feat');
    store.createTask('feat', '01-a', 'A', makeStatus({ planTitle: 'First' }), 3);
    store.createTask('feat', '01-a', 'A', makeStatus({ planTitle: 'Second' }), 3);
    const status = store.getRawStatus('feat', '01-a');
    expect(status?.planTitle).toBe('Second');
  });

  it('get returns null for non-existent task', () => {
    setupFeature('feat');
    expect(store.get('feat', 'missing')).toBeNull();
  });

  it('get returns TaskInfo with correct fields', () => {
    setupFeature('feat');
    store.createTask('feat', '01-setup', 'Setup', makeStatus({ summary: 'Done', origin: 'manual' }), 3);
    const task = store.get('feat', '01-setup');
    expect(task).not.toBeNull();
    expect(task!.folder).toBe('01-setup');
    expect(task!.name).toBe('setup');
    expect(task!.origin).toBe('manual');
    expect(task!.summary).toBe('Done');
  });

  it('list returns empty for non-existent feature', () => {
    expect(store.list('nope')).toEqual([]);
  });

  it('list returns sorted tasks', () => {
    setupFeature('feat');
    store.createTask('feat', '03-c', 'C', makeStatus(), 3);
    store.createTask('feat', '01-a', 'A', makeStatus(), 3);
    store.createTask('feat', '02-b', 'B', makeStatus(), 3);
    const tasks = store.list('feat');
    expect(tasks.map((t) => t.folder)).toEqual(['01-a', '02-b', '03-c']);
  });

  it('getNextOrder returns 1 for empty feature', () => {
    setupFeature('feat');
    expect(store.getNextOrder('feat')).toBe(1);
  });

  it('getNextOrder returns 1 for non-existent feature', () => {
    expect(store.getNextOrder('ghost')).toBe(1);
  });

  it('getNextOrder returns max + 1', () => {
    setupFeature('feat');
    store.createTask('feat', '03-c', 'C', makeStatus(), 3);
    store.createTask('feat', '01-a', 'A', makeStatus(), 3);
    expect(store.getNextOrder('feat')).toBe(4);
  });

  it('delete removes task directory', () => {
    setupFeature('feat');
    store.createTask('feat', '01-a', 'A', makeStatus(), 3);
    expect(store.get('feat', '01-a')).not.toBeNull();
    store.delete('feat', '01-a');
    expect(store.get('feat', '01-a')).toBeNull();
  });

  it('delete is no-op for non-existent task', () => {
    setupFeature('feat');
    expect(() => store.delete('feat', 'missing')).not.toThrow();
  });

  it('save overwrites existing status', () => {
    setupFeature('feat');
    store.createTask('feat', '01-a', 'A', makeStatus({ status: 'pending' }), 3);
    store.save('feat', '01-a', makeStatus({ status: 'done', summary: 'Completed' }));
    const raw = store.getRawStatus('feat', '01-a');
    expect(raw?.status).toBe('done');
    expect(raw?.summary).toBe('Completed');
  });

  it('patchBackground patches without clobbering status', () => {
    setupFeature('feat');
    store.createTask('feat', '01-a', 'A', makeStatus({ status: 'in_progress' }), 3);
    const patched = store.patchBackground('feat', '01-a', {
      idempotencyKey: 'key-1',
      workerSession: { sessionId: 'sess-1' },
    });
    expect(patched.status).toBe('in_progress');
    expect(patched.idempotencyKey).toBe('key-1');
    expect(patched.workerSession?.sessionId).toBe('sess-1');
  });

  it('writeReport creates report file', () => {
    setupFeature('feat');
    store.createTask('feat', '01-a', 'A', makeStatus(), 3);
    const reportPath = store.writeReport('feat', '01-a', 'Report content');
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toBe('Report content');
  });

  it('getRunnableTasks returns null (filesystem has no scheduler)', () => {
    expect(store.getRunnableTasks('feat')).toBeNull();
  });

  it('flush is no-op', () => {
    expect(() => store.flush()).not.toThrow();
  });
});
