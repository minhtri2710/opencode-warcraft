import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { TaskService } from './taskService.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('TaskService slug collision detection', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-slug-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(feat: string, content: string) {
    const planPath = getPlanPath(tempDir, feat, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('slug collision in plan throws', () => {
    writePlan('collide', `# Plan

### 1. Setup DB
Init database

### 2. Setup Db
Init database again
`);
    expect(() => service.sync('collide')).toThrow(/collides/);
  });

  it('manual task slug collision throws', () => {
    service.create('feat', 'my-task');
    // Creating another task that slugifies to same thing
    expect(() => service.create('feat', 'My Task')).toThrow();
  });
});

describe('TaskService background patch', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-bgpatch-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('patchBackgroundFields updates idempotencyKey', () => {
    const folder = service.create('feat', 'bg-task');
    const result = service.patchBackgroundFields('feat', folder, {
      idempotencyKey: 'key-abc',
    });
    expect(result.idempotencyKey).toBe('key-abc');
  });

  it('patchBackgroundFields updates workerSession', () => {
    const folder = service.create('feat', 'bg-task');
    const result = service.patchBackgroundFields('feat', folder, {
      workerSession: {
        sessionId: 'sess-1',
        lastHeartbeatAt: '2024-01-01T00:00:00Z',
      },
    });
    expect(result.workerSession?.sessionId).toBe('sess-1');
  });

  it('patchBackgroundFields does not clobber status', () => {
    const folder = service.create('feat', 'bg-task');
    service.update('feat', folder, { status: 'in_progress' });
    service.patchBackgroundFields('feat', folder, {
      idempotencyKey: 'key-xyz',
    });
    const raw = service.getRawStatus('feat', folder);
    expect(raw!.status).toBe('in_progress');
    expect(raw!.idempotencyKey).toBe('key-xyz');
  });
});

describe('TaskService dispatch_prepared', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-dispatch-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('dispatch_prepared stamps preparedAt', () => {
    const folder = service.create('feat', 'dispatch-task');
    const updated = service.update('feat', folder, { status: 'dispatch_prepared' });
    expect(updated.preparedAt).toBeDefined();
    expect(updated.status).toBe('dispatch_prepared');
  });

  it('dispatch_prepared in getRunnableTasks is in_progress', () => {
    const folder = service.create('feat', 'dispatch-task');
    service.update('feat', folder, { status: 'dispatch_prepared' });
    const result = service.getRunnableTasks('feat');
    expect(result.inProgress.length).toBe(1);
  });

  it('dispatch_prepared then in_progress preserves preparedAt', () => {
    const folder = service.create('feat', 'dispatch-task');
    service.update('feat', folder, { status: 'dispatch_prepared' });
    const prepared = service.getRawStatus('feat', folder);
    const updatedIp = service.update('feat', folder, { status: 'in_progress' });
    expect(updatedIp.preparedAt).toBe(prepared!.preparedAt);
  });
});
