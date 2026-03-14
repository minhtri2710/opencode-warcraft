import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, getWarcraftPath } from '../utils/paths.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TASK_STATUS_SCHEMA_VERSION, TaskService } from './taskService.js';

describe('TaskService TASK_STATUS_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(TASK_STATUS_SCHEMA_VERSION).toBe(1);
  });
});

describe('TaskService manual task ordering', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-order-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('manual tasks are created in order', () => {
    service.create('feat', 'first');
    service.create('feat', 'second');
    service.create('feat', 'third');
    const tasks = service.list('feat');
    expect(tasks.length).toBe(3);
    // Tasks should be in creation order
    expect(tasks[0].folder).toMatch(/^01-/);
    expect(tasks[1].folder).toMatch(/^02-/);
    expect(tasks[2].folder).toMatch(/^03-/);
  });

  it('explicit order creates at specific position', () => {
    service.create('feat', 'at-five', 5);
    service.create('feat', 'at-ten', 10);
    const tasks = service.list('feat');
    expect(tasks[0].folder).toMatch(/^05-/);
    expect(tasks[1].folder).toMatch(/^10-/);
  });

  it('priority 1-5 all valid', () => {
    for (let p = 1; p <= 5; p++) {
      const folder = service.create('feat', `task-p${p}`, undefined, p);
      expect(folder.length).toBeGreaterThan(0);
    }
    expect(service.list('feat').length).toBe(5);
  });

  it('slug collision between manual tasks with diff names', () => {
    service.create('feat', 'setup-db');
    // This should throw because it slugifies to same thing
    expect(() => service.create('feat', 'Setup DB')).toThrow();
  });

  it('update learnings field', () => {
    const folder = service.create('feat', 'learn-task');
    service.update('feat', folder, { status: 'in_progress' });
    const updated = service.update('feat', folder, {
      status: 'done',
      summary: 'Completed with learnings',
      learnings: ['Learned about X', 'Discovered Y'],
    });
    expect(updated.learnings).toEqual(['Learned about X', 'Discovered Y']);
  });

  it('update blocker field', () => {
    const folder = service.create('feat', 'blocked-task');
    const updated = service.update('feat', folder, {
      status: 'blocked',
      blocker: { reason: 'Waiting for API', detail: 'Need v2 endpoint' },
    });
    expect(updated.blocker!.reason).toBe('Waiting for API');
    expect(updated.blocker!.detail).toBe('Need v2 endpoint');
  });

  it('update baseCommit field', () => {
    const folder = service.create('feat', 'commit-task');
    const updated = service.update('feat', folder, {
      status: 'in_progress',
      baseCommit: 'abc123def',
    });
    expect(updated.baseCommit).toBe('abc123def');
  });
});

describe('TaskService getRunnableTasks detail', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-runnable-det-'));
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

  it('result has correct source', () => {
    service.create('feat', 'task');
    const result = service.getRunnableTasks('feat');
    expect(result.source).toBe('filesystem');
  });

  it('all categories sum to total', () => {
    writePlan(
      'sum',
      `# Plan\n\n### 1. A\nDepends on: none\nA\n\n### 2. B\nDepends on: 1\nB\n\n### 3. C\nDepends on: 1\nC\n`,
    );
    service.sync('sum');
    service.update('sum', service.list('sum')[0].folder, { status: 'done', summary: 'A' });

    const result = service.getRunnableTasks('sum');
    const total = result.runnable.length + result.blocked.length + result.completed.length + result.inProgress.length;
    expect(total).toBe(3);
  });
});
