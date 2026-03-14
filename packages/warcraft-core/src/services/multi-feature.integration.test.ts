import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, getWarcraftPath } from '../utils/paths.js';
import { ContextService } from './contextService.js';
import { FeatureService } from './featureService.js';
import { PlanService } from './planService.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';
import { FilesystemPlanStore } from './state/fs-plan-store.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('Multi-feature workflow', () => {
  let tempDir: string;
  let featureService: FeatureService;
  let _planService: PlanService;
  let taskService: TaskService;
  let contextService: ContextService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-feat-'));
    const featureStore = new FilesystemFeatureStore(tempDir);
    const planStore = new FilesystemPlanStore(tempDir);
    const taskStore = new FilesystemTaskStore(tempDir);
    const provider = { getBeadsMode: () => 'off' as const };
    featureService = new FeatureService(tempDir, featureStore, 'off', taskStore);
    _planService = new PlanService(tempDir, planStore, 'off');
    taskService = new TaskService(tempDir, taskStore, 'off', createNoopLogger());
    contextService = new ContextService(tempDir, provider);
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

  it('two features operate independently', () => {
    featureService.create('auth');
    featureService.create('billing');

    writePlan('auth', `# Plan\n\n### 1. Login\nBuild login\n`);
    writePlan('billing', `# Plan\n\n### 1. Payment\nAdd payment\n\n### 2. Invoice\nGenerate invoices\n`);

    const authSync = taskService.sync('auth');
    const billSync = taskService.sync('billing');

    expect(authSync.created.length).toBe(1);
    expect(billSync.created.length).toBe(2);

    expect(taskService.list('auth').length).toBe(1);
    expect(taskService.list('billing').length).toBe(2);
  });

  it('completing one feature does not affect other', () => {
    featureService.create('feat-a');
    featureService.create('feat-b');

    writePlan('feat-a', `# Plan\n\n### 1. Task A\nDo A\n`);
    writePlan('feat-b', `# Plan\n\n### 1. Task B\nDo B\n`);

    taskService.sync('feat-a');
    taskService.sync('feat-b');

    // Complete all of feat-a
    const tasksA = taskService.list('feat-a');
    taskService.update('feat-a', tasksA[0].folder, { status: 'done', summary: 'Done A' });
    featureService.syncCompletionFromTasks('feat-a');

    expect(featureService.get('feat-a')!.status).toBe('completed');
    expect(featureService.get('feat-b')!.status).toBe('planning');
  });

  it('context is feature-scoped in workflow', () => {
    featureService.create('ctx-a');
    featureService.create('ctx-b');

    contextService.write('ctx-a', 'decisions', 'A decisions');
    contextService.write('ctx-b', 'decisions', 'B decisions');

    expect(contextService.read('ctx-a', 'decisions')).toContain('A decisions');
    expect(contextService.read('ctx-b', 'decisions')).toContain('B decisions');
  });

  it('getActive returns first non-completed feature', () => {
    featureService.create('done-feat');
    featureService.create('active-feat');

    writePlan('done-feat', `# Plan\n\n### 1. X\nDone\n`);
    taskService.sync('done-feat');
    const tasks = taskService.list('done-feat');
    taskService.update('done-feat', tasks[0].folder, { status: 'done', summary: 'Done' });
    featureService.syncCompletionFromTasks('done-feat');

    const active = featureService.getActive();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('active-feat');
  });
});
