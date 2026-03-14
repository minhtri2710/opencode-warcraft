import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BeadsRepository } from './beads/BeadsRepository.js';
import { createStores } from './state/index.js';
import { TaskService } from './taskService.js';

let testRoot = '';

function createMockRepo(): any {
  return {
    createEpic: () => ({ success: true, value: 'e' }),
    closeBead: () => ({ success: true, value: undefined }),
    reopenBead: () => ({ success: true, value: undefined }),
    getGateway: () => ({}) as any,
    getViewerGateway: () => ({}) as any,
    getEpicByFeatureName: () => ({ success: true, value: 'e' }),
    getTaskState: () => ({ success: true, value: null }),
    setTaskState: () => ({ success: true, value: undefined }),
    getPlanDescription: () => ({ success: true, value: null }),
    setPlanDescription: () => ({ success: true, value: undefined }),
    hasWorkflowLabel: () => ({ success: true, value: false }),
    removeWorkflowLabel: () => ({ success: true, value: undefined }),
    createTask: () => ({ success: true, value: 't' }),
    syncTaskStatus: () => ({ success: true, value: undefined }),
    listDependencies: () => ({ success: true, value: [] }),
    addDependency: () => ({ success: true, value: undefined }),
    removeDependency: () => ({ success: true, value: undefined }),
    getComments: () => ({ success: true, value: [] }),
    appendComment: () => ({ success: true, value: undefined }),
    recordAuditEvent: () => {},
    getAuditLog: () => [],
    getBeadToon: () => ({ success: true, value: '' }),
    upsertTaskArtifact: () => ({ success: true, value: undefined }),
    readTaskArtifact: () => ({ success: true, value: null }),
    listTaskBeadsForEpic: () => [],
    listEpics: () => ({ success: true, value: [] }),
    addWorkflowLabel: () => ({ success: true, value: undefined }),
    getRobotPlan: () => ({ success: false, error: new Error('n') }),
    getRobotInsights: () => null,
    getViewerHealth: () => ({ success: false, error: new Error('n') }),
    importArtifacts: () => ({ success: true, value: undefined }),
    flushArtifacts: () => ({ success: true, value: undefined }),
  };
}

function setupFeature(name: string): void {
  const featurePath = path.join(testRoot, 'docs', name);
  fs.mkdirSync(path.join(featurePath, 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(featurePath, 'feature.json'),
    JSON.stringify({ name, epicBeadId: 'e', status: 'executing', createdAt: '2024-01-01' }),
  );
}

function setupTask(featureName: string, folder: string, status: Record<string, unknown> = {}): void {
  const taskPath = path.join(testRoot, 'docs', featureName, 'tasks', folder);
  fs.mkdirSync(taskPath, { recursive: true });
  fs.writeFileSync(
    path.join(taskPath, 'status.json'),
    JSON.stringify({ status: 'pending', origin: 'plan', planTitle: folder, ...status }),
  );
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskservice-build-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('TaskService.buildSpecData', () => {
  it('returns correct structure', () => {
    const stores = createStores(testRoot, 'off', createMockRepo());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const data = service.buildSpecData({
      featureName: 'my-feat',
      task: { folder: '01-setup', name: 'Setup', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-setup', name: 'Setup', order: 1 }],
    });

    expect(data.featureName).toBe('my-feat');
    expect(data.task.folder).toBe('01-setup');
    expect(data.task.name).toBe('Setup');
    expect(data.dependsOn).toEqual([]);
    expect(data.planSection).toBeNull();
    expect(data.contextFiles).toEqual([]);
    expect(data.completedTasks).toEqual([]);
  });

  it('extracts plan section by task name', () => {
    const stores = createStores(testRoot, 'off', createMockRepo());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const data = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-setup', name: 'Setup', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-setup', name: 'Setup', order: 1 }],
      planContent: '# Plan\n\n### 1. Setup\n\nSet up the project.\n\n### 2. Build\n\nBuild it.',
    });

    expect(data.planSection).not.toBeNull();
    expect(data.planSection).toContain('Setup');
    expect(data.planSection).toContain('Set up the project');
    expect(data.planSection).not.toContain('Build it');
  });

  it('returns null planSection when plan content is null', () => {
    const stores = createStores(testRoot, 'off', createMockRepo());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const data = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-setup', name: 'Setup', order: 1 },
      dependsOn: [],
      allTasks: [],
      planContent: null,
    });

    expect(data.planSection).toBeNull();
  });

  it('passes through context files', () => {
    const stores = createStores(testRoot, 'off', createMockRepo());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const ctx = [{ name: 'notes', content: 'Notes' }];
    const data = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-t', name: 't', order: 1 },
      dependsOn: [],
      allTasks: [],
      contextFiles: ctx,
    });

    expect(data.contextFiles).toEqual(ctx);
  });

  it('passes through completed tasks', () => {
    const stores = createStores(testRoot, 'off', createMockRepo());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const completed = [{ name: 'Done', summary: 'Completed' }];
    const data = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-t', name: 't', order: 1 },
      dependsOn: [],
      allTasks: [],
      completedTasks: completed,
    });

    expect(data.completedTasks).toEqual(completed);
  });
});
