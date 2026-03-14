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

describe('Full lifecycle stress test', () => {
  let tempDir: string;
  let featureService: FeatureService;
  let planService: PlanService;
  let taskService: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-lc-'));
    const featureStore = new FilesystemFeatureStore(tempDir);
    const planStore = new FilesystemPlanStore(tempDir);
    const taskStore = new FilesystemTaskStore(tempDir);
    featureService = new FeatureService(tempDir, featureStore, 'off', taskStore);
    planService = new PlanService(tempDir, planStore, 'off');
    taskService = new TaskService(tempDir, taskStore, 'off', createNoopLogger());
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

  it('10 features each with 5 tasks', () => {
    for (let f = 1; f <= 10; f++) {
      const featName = `feature-${f}`;
      featureService.create(featName);
      
      const tasks = Array.from({ length: 5 }, (_, i) => {
        const order = i + 1;
        return `### ${order}. Task ${order}\nDepends on: ${order === 1 ? 'none' : order - 1}\nTask ${order} content`;
      }).join('\n\n');
      
      writePlan(featName, `# Plan\n\n${tasks}`);
      const sync = taskService.sync(featName);
      expect(sync.created.length).toBe(5);
    }

    // Verify all features and tasks exist
    const features = featureService.list();
    expect(features.length).toBe(10);
    
    for (let f = 1; f <= 10; f++) {
      const tasks = taskService.list(`feature-${f}`);
      expect(tasks.length).toBe(5);
    }
  });

  it('complete all tasks in 3 features', () => {
    for (let f = 1; f <= 3; f++) {
      const featName = `complete-${f}`;
      featureService.create(featName);
      writePlan(featName, `# Plan\n\n### 1. Task A\nDepends on: none\nDo A\n\n### 2. Task B\nDepends on: 1\nDo B`);
      taskService.sync(featName);
      
      const tasks = taskService.list(featName);
      for (const task of tasks) {
        taskService.update(featName, task.folder, { status: 'in_progress' });
        taskService.update(featName, task.folder, { status: 'done', summary: `Done ${task.name}` });
      }
      
      const synced = featureService.syncCompletionFromTasks(featName);
      expect(synced!.status).toBe('completed');
    }
  });

  it('plan evolution: 3 syncs with growing task list', () => {
    const feat = 'evolving';
    featureService.create(feat);
    
    writePlan(feat, `# Plan\n\n### 1. Step 1\nDepends on: none\nFirst step`);
    expect(taskService.sync(feat).created.length).toBe(1);
    
    writePlan(feat, `# Plan\n\n### 1. Step 1\nDepends on: none\nFirst step\n\n### 2. Step 2\nDepends on: 1\nSecond step`);
    expect(taskService.sync(feat).created.length).toBe(1);
    
    writePlan(feat, `# Plan\n\n### 1. Step 1\nDepends on: none\nFirst step\n\n### 2. Step 2\nDepends on: 1\nSecond step\n\n### 3. Step 3\nDepends on: 2\nThird step`);
    expect(taskService.sync(feat).created.length).toBe(1);
    
    expect(taskService.list(feat).length).toBe(3);
  });
});
