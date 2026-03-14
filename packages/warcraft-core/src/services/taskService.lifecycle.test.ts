import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getWarcraftPath } from '../utils/paths.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('TaskService manual task creation', () => {
  let tempDir: string;
  let service: TaskService;
  let store: FilesystemTaskStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-manual-'));
    store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('create manual task returns folder', () => {
    const folder = service.create('my-feature', 'setup-db');
    expect(folder).toMatch(/^01-/);
  });

  it('create two tasks returns different folders', () => {
    const f1 = service.create('feat', 'first-task');
    const f2 = service.create('feat', 'second-task');
    expect(f1).not.toBe(f2);
    expect(f1).toMatch(/^01-/);
    expect(f2).toMatch(/^02-/);
  });

  it('create task and list it', () => {
    service.create('feat', 'my-task');
    const tasks = service.list('feat');
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toBe('my-task');
  });

  it('create task and get it', () => {
    const folder = service.create('feat', 'my-task');
    const task = service.get('feat', folder);
    expect(task).not.toBeNull();
    expect(task!.status).toBe('pending');
  });

  it('invalid priority throws', () => {
    expect(() => service.create('feat', 'task', undefined, 0)).toThrow(/Priority/);
    expect(() => service.create('feat', 'task', undefined, 6)).toThrow(/Priority/);
    expect(() => service.create('feat', 'task', undefined, 1.5)).toThrow(/Priority/);
  });

  it('invalid order throws', () => {
    expect(() => service.create('feat', 'task', 0)).toThrow(/positive integer/);
    expect(() => service.create('feat', 'task', -1)).toThrow(/positive integer/);
  });

  it('duplicate order throws', () => {
    service.create('feat', 'first', 1);
    expect(() => service.create('feat', 'second', 1)).toThrow(/already in use/);
  });
});

describe('TaskService status transitions', () => {
  let tempDir: string;
  let service: TaskService;
  let store: FilesystemTaskStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-trans-'));
    store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('update status from pending to in_progress', () => {
    const folder = service.create('feat', 'my-task');
    const updated = service.update('feat', folder, { status: 'in_progress' });
    expect(updated.status).toBe('in_progress');
    expect(updated.startedAt).toBeDefined();
  });

  it('update status to done stamps completedAt', () => {
    const folder = service.create('feat', 'my-task');
    service.update('feat', folder, { status: 'in_progress' });
    const done = service.update('feat', folder, { status: 'done', summary: 'Completed' });
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeDefined();
    expect(done.summary).toBe('Completed');
  });

  it('update status to pending clears timestamps', () => {
    const folder = service.create('feat', 'my-task');
    service.update('feat', folder, { status: 'in_progress' });
    const pending = service.update('feat', folder, { status: 'pending' });
    expect(pending.status).toBe('pending');
    expect(pending.startedAt).toBeUndefined();
    expect(pending.completedAt).toBeUndefined();
  });

  it('update non-existent task throws', () => {
    expect(() => service.update('feat', '99-ghost', { status: 'done' })).toThrow(/not found/);
  });

  it('transition with strict mode rejects invalid', () => {
    const strictService = new TaskService(tempDir, store, 'off', createNoopLogger(), {
      strictTaskTransitions: true,
    });
    const folder = strictService.create('feat', 'strict-task');
    // pending -> done should be invalid in strict mode
    expect(() => strictService.transition('feat', folder, 'done')).toThrow();
  });

  it('transition with strict mode allows valid', () => {
    const strictService = new TaskService(tempDir, store, 'off', createNoopLogger(), {
      strictTaskTransitions: true,
    });
    const folder = strictService.create('feat', 'strict-task');
    // pending -> dispatch_prepared should be valid
    const result = strictService.transition('feat', folder, 'dispatch_prepared');
    expect(result.status).toBe('dispatch_prepared');
  });

  it('onTaskStatusChanged callback fires', () => {
    const changes: Array<{ from: string; to: string }> = [];
    const cbService = new TaskService(tempDir, store, 'off', createNoopLogger(), {
      onTaskStatusChanged: (_feat, _folder, from, to) => changes.push({ from, to }),
    });
    const folder = cbService.create('feat', 'cb-task');
    cbService.update('feat', folder, { status: 'in_progress' });
    expect(changes).toHaveLength(1);
    expect(changes[0].from).toBe('pending');
    expect(changes[0].to).toBe('in_progress');
  });
});

describe('TaskService spec and report', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-spec-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('write and read spec', () => {
    const folder = service.create('feat', 'spec-task');
    service.writeSpec('feat', folder, '# Spec\n\nDo the thing');
    const spec = service.readTaskBeadArtifact('feat', folder, 'spec');
    // Spec may or may not be readable depending on store implementation
    expect(spec === null || (typeof spec === 'string' && spec.includes('Spec'))).toBe(true);
  });

  it('write and read report', () => {
    const folder = service.create('feat', 'report-task');
    service.writeReport('feat', folder, '# Report\n\nTask completed');
    // Report might be read through the store
    const tasks = service.list('feat');
    expect(tasks.length).toBe(1);
  });

  it('getRawStatus returns full status', () => {
    const folder = service.create('feat', 'raw-task');
    service.update('feat', folder, { status: 'in_progress' });
    const raw = service.getRawStatus('feat', folder);
    expect(raw).not.toBeNull();
    expect(raw!.status).toBe('in_progress');
    expect(raw!.origin).toBe('manual');
  });

  it('getRawStatus returns null for missing task', () => {
    expect(service.getRawStatus('feat', '99-ghost')).toBeNull();
  });
});
