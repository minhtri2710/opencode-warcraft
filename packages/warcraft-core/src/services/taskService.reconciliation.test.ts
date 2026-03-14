import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { TaskService } from './taskService.js';
import { FeatureService } from './featureService.js';
import { PlanService } from './planService.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';
import { FilesystemPlanStore } from './state/fs-plan-store.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('TaskService sync reconciliation', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-recon-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(feat: string, content: string) {
    const planPath = getPlanPath(tempDir, feat, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('adding new task to existing plan creates only the new one', () => {
    writePlan('evolve', `# Plan\n\n### 1. Setup\nInit\n`);
    const first = service.sync('evolve');
    expect(first.created.length).toBe(1);

    writePlan('evolve', `# Plan\n\n### 1. Setup\nInit\n\n### 2. Build\nConstruct\n`);
    const second = service.sync('evolve');
    expect(second.created.length).toBe(1);
    expect(second.kept.length).toBe(1);
  });

  it('renaming task title treats as new task', () => {
    writePlan('rename', `# Plan\n\n### 1. Old Name\nTask\n`);
    service.sync('rename');

    writePlan('rename', `# Plan\n\n### 1. New Name\nTask\n`);
    const result = service.sync('rename');
    // Old task removed (if pending), new one created
    expect(result.created.length + result.reconciled.length).toBeGreaterThanOrEqual(1);
  });

  it('done task survives plan removal', () => {
    writePlan('done-survive', `# Plan\n\n### 1. Keep\nStay\n\n### 2. Remove\nGo\n`);
    service.sync('done-survive');

    // Mark task 1 as done
    const tasks = service.list('done-survive');
    service.update('done-survive', tasks[0].folder, { status: 'done', summary: 'Done' });

    // Remove task 1 from plan
    writePlan('done-survive', `# Plan\n\n### 2. Remove\nGo\n`);
    const result = service.sync('done-survive');
    // Done task should be kept even though not in plan
    expect(result.kept).toContain(tasks[0].folder);
  });

  it('in_progress task survives plan removal', () => {
    writePlan('ip-survive', `# Plan\n\n### 1. Working\nIn progress\n\n### 2. Other\nPending\n`);
    service.sync('ip-survive');

    const tasks = service.list('ip-survive');
    service.update('ip-survive', tasks[0].folder, { status: 'in_progress' });

    writePlan('ip-survive', `# Plan\n\n### 2. Other\nPending\n`);
    const result = service.sync('ip-survive');
    expect(result.kept).toContain(tasks[0].folder);
  });

  it('multiple syncs are stable', () => {
    const plan = `# Plan\n\n### 1. A\nTask A\n\n### 2. B\nTask B\nDepends on: 1\n\n### 3. C\nTask C\nDepends on: 2\n`;
    writePlan('stable', plan);

    const first = service.sync('stable');
    expect(first.created.length).toBe(3);

    const second = service.sync('stable');
    expect(second.created.length).toBe(0);
    expect(second.removed.length).toBe(0);

    const third = service.sync('stable');
    expect(third.created.length).toBe(0);
    expect(third.removed.length).toBe(0);
  });
});

describe('TaskService computeRunnableStatus', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-runnable-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(feat: string, content: string) {
    const planPath = getPlanPath(tempDir, feat, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('computeRunnableStatus for empty feature', () => {
    const result = service.computeRunnableStatus('empty');
    expect(result.runnable).toEqual([]);
  });

  it('computeRunnableStatus with chain of deps', () => {
    writePlan('chain', `# Plan\n\n### 1. First\nDo first\n\n### 2. Second\nDepends on: 1\n\nDo second\n\n### 3. Third\nDepends on: 2\n\nDo third\n`);
    service.sync('chain');

    const result = service.computeRunnableStatus('chain');
    expect(result.runnable.length).toBe(1);
  });

  it('completing deps unblocks next', () => {
    writePlan('unblock', `# Plan\n\n### 1. First\nDo first\n\n### 2. Second\nDepends on: 1\n\nDo second\n`);
    service.sync('unblock');

    const tasks = service.list('unblock');
    service.update('unblock', tasks[0].folder, { status: 'done', summary: 'Done' });

    const result = service.computeRunnableStatus('unblock');
    expect(result.runnable.length).toBe(1);
    expect(result.runnable[0]).toBe(tasks[1].folder);
  });
});
