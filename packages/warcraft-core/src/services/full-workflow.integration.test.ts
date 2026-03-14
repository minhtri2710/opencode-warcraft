import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getWarcraftPath } from '../utils/paths.js';
import { FeatureService } from './featureService.js';
import { PlanService } from './planService.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';
import { FilesystemPlanStore } from './state/fs-plan-store.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('Feature → Plan → Task full workflow', () => {
  let tempDir: string;
  let featureService: FeatureService;
  let planService: PlanService;
  let taskService: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-'));
    const featureStore = new FilesystemFeatureStore(tempDir);
    const planStore = new FilesystemPlanStore(tempDir);
    const taskStore = new FilesystemTaskStore(tempDir);
    featureService = new FeatureService(tempDir, featureStore, 'off', taskStore);
    planService = new PlanService(tempDir, planStore, 'off');
    taskService = new TaskService(tempDir, taskStore, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('end-to-end: create feature, write plan, approve, sync tasks, complete', () => {
    // 1. Create feature
    const createResult = featureService.create('add-login');
    expect(createResult.severity).toBe('ok');

    // 2. Write plan
    const plan = `# Plan

### 1. Database Schema
Create users table

### 2. Auth Endpoint
Build login API
Depends on: 1

### 3. Frontend Form
Build login form
Depends on: 2
`;
    planService.write('add-login', plan);
    const readPlan = planService.read('add-login');
    expect(readPlan).not.toBeNull();
    expect(readPlan!.status).toBe('planning');

    // 3. Approve plan
    planService.approve('add-login');
    expect(planService.isApproved('add-login')).toBe(true);

    // 4. Sync tasks
    const syncResult = taskService.sync('add-login');
    expect(syncResult.created.length).toBe(3);
    expect(syncResult.removed.length).toBe(0);

    // 5. Check tasks created correctly
    const tasks = taskService.list('add-login');
    expect(tasks.length).toBe(3);
    expect(tasks[0].status).toBe('pending');

    // 6. Start first task
    taskService.update('add-login', tasks[0].folder, { status: 'in_progress' });
    const inProgress = taskService.get('add-login', tasks[0].folder);
    expect(inProgress!.status).toBe('in_progress');

    // 7. Complete first task
    taskService.update('add-login', tasks[0].folder, {
      status: 'done',
      summary: 'Created users table with migrations',
    });
    const done = taskService.get('add-login', tasks[0].folder);
    expect(done!.status).toBe('done');

    // 8. Check runnable tasks - task 2 should now be runnable
    const runnable = taskService.getRunnableTasks('add-login');
    expect(runnable.completed.length).toBe(1);
    expect(runnable.runnable.length).toBeGreaterThanOrEqual(1);

    // 9. Complete all tasks
    taskService.update('add-login', tasks[1].folder, { status: 'in_progress' });
    taskService.update('add-login', tasks[1].folder, { status: 'done', summary: 'Built auth API' });
    taskService.update('add-login', tasks[2].folder, { status: 'in_progress' });
    taskService.update('add-login', tasks[2].folder, { status: 'done', summary: 'Built login form' });

    // 10. Sync completion to feature
    const synced = featureService.syncCompletionFromTasks('add-login');
    expect(synced).not.toBeNull();
    expect(synced!.status).toBe('completed');
  });

  it('task dependency resolution blocks downstream tasks', () => {
    featureService.create('dep-test');
    planService.write(
      'dep-test',
      `# Plan

### 1. First
Start here

### 2. Second
Depends on: 1

After first

### 3. Third
Depends on: 2

After second
`,
    );
    taskService.sync('dep-test');

    const runnable = taskService.getRunnableTasks('dep-test');
    expect(runnable.runnable.length).toBe(1);
    expect(runnable.blocked.length).toBe(2);
  });

  it('feature stays open when tasks not all done', () => {
    featureService.create('partial');
    planService.write(
      'partial',
      `# Plan

### 1. Done Task
Finished

### 2. Pending Task
Not started
`,
    );
    taskService.sync('partial');
    const tasks = taskService.list('partial');
    taskService.update('partial', tasks[0].folder, { status: 'done', summary: 'Done' });

    const result = featureService.syncCompletionFromTasks('partial');
    expect(result!.status).not.toBe('completed');
  });
});
