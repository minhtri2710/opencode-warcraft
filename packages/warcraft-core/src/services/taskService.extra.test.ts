import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskStatus } from '../types.js';
import type { BeadsRepository } from './beads/BeadsRepository.js';
import { createStores } from './state/index.js';
import { TaskService } from './taskService.js';

let testRoot = '';

function createMockRepository(): BeadsRepository {
  return {
    createEpic: () => ({ success: true, value: 'bd-epic-1' }),
    closeBead: () => ({ success: true, value: undefined }),
    reopenBead: () => ({ success: true, value: undefined }),
    getGateway: () => ({} as any),
    getViewerGateway: () => ({} as any),
    getEpicByFeatureName: () => ({ success: true, value: 'bd-epic-1' }),
    getTaskState: () => ({ success: true, value: null }),
    setTaskState: () => ({ success: true, value: undefined }),
    getPlanDescription: () => ({ success: true, value: null }),
    setPlanDescription: () => ({ success: true, value: undefined }),
    hasWorkflowLabel: () => ({ success: true, value: false }),
    removeWorkflowLabel: () => ({ success: true, value: undefined }),
    createTask: () => ({ success: true, value: 'bd-task-1' }),
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
    getRobotPlan: () => ({ success: false, error: new Error('not impl') }),
    getRobotInsights: () => null,
    getViewerHealth: () => ({ success: false, error: new Error('not impl') }),
    importArtifacts: () => ({ success: true, value: undefined }),
    flushArtifacts: () => ({ success: true, value: undefined }),
  } as any;
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskservice-extra-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function setupFeature(name: string): void {
  const featurePath = path.join(testRoot, 'docs', name);
  fs.mkdirSync(path.join(featurePath, 'tasks'), { recursive: true });
  fs.writeFileSync(
    path.join(featurePath, 'feature.json'),
    JSON.stringify({ name, epicBeadId: 'bd-epic-1', status: 'executing', createdAt: '2024-01-01' }),
  );
}

function setupTask(featureName: string, folder: string, status: Partial<TaskStatus> = {}): void {
  const taskPath = path.join(testRoot, 'docs', featureName, 'tasks', folder);
  fs.mkdirSync(taskPath, { recursive: true });
  fs.writeFileSync(
    path.join(taskPath, 'status.json'),
    JSON.stringify({
      status: 'pending',
      origin: 'plan',
      planTitle: folder,
      ...status,
    }),
  );
}

describe('TaskService.update timestamp behavior', () => {
  it('resets startedAt, completedAt, preparedAt when transitioning to pending', () => {
    const featureName = 'timestamp-reset';
    setupFeature(featureName);
    setupTask(featureName, '01-test', {
      status: 'cancelled',
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-02T00:00:00Z',
      preparedAt: '2024-01-03T00:00:00Z',
    });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.update(featureName, '01-test', { status: 'pending' });
    expect(result.status).toBe('pending');
    expect(result.startedAt).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
    expect(result.preparedAt).toBeUndefined();
  });

  it('sets preparedAt when transitioning to dispatch_prepared', () => {
    const featureName = 'prepared-ts';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'pending' });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.update(featureName, '01-test', { status: 'dispatch_prepared' });
    expect(result.status).toBe('dispatch_prepared');
    expect(result.preparedAt).toBeDefined();
  });

  it('does not override existing preparedAt', () => {
    const featureName = 'keep-prepared';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'pending', preparedAt: '2024-01-01T00:00:00Z' });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.update(featureName, '01-test', { status: 'dispatch_prepared' });
    expect(result.preparedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('does not override existing startedAt', () => {
    const featureName = 'keep-started';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'pending', startedAt: '2024-01-01T00:00:00Z' });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.update(featureName, '01-test', { status: 'in_progress' });
    expect(result.startedAt).toBe('2024-01-01T00:00:00Z');
  });

  it('does not override existing completedAt', () => {
    const featureName = 'keep-completed';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'in_progress', startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-02T00:00:00Z' });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.update(featureName, '01-test', { status: 'done' });
    expect(result.completedAt).toBe('2024-01-02T00:00:00Z');
  });
});

describe('TaskService.transition edge cases', () => {
  it('throws for non-existent task', () => {
    const featureName = 'transition-missing';
    setupFeature(featureName);

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    expect(() => service.transition(featureName, '99-nonexistent', 'in_progress')).toThrow("Task '99-nonexistent' not found");
  });

  it('passes extras through to update', () => {
    const featureName = 'transition-extras';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'in_progress', startedAt: '2024-01-01T00:00:00Z' });

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');

    const result = service.transition(featureName, '01-test', 'done', { summary: 'Task completed' });
    expect(result.status).toBe('done');
    expect(result.summary).toBe('Task completed');
  });
});

describe('TaskService.update triggers onTaskStatusChanged', () => {
  it('calls callback when status actually changes', () => {
    const featureName = 'callback-test';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'pending' });

    let callbackCalled = false;
    let callbackArgs: [string, string, string, string] | null = null;

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off', {
      onTaskStatusChanged: (f, t, from, to) => {
        callbackCalled = true;
        callbackArgs = [f, t, from, to];
      },
    });

    service.update(featureName, '01-test', { status: 'in_progress' });
    expect(callbackCalled).toBe(true);
    expect(callbackArgs).toEqual([featureName, '01-test', 'pending', 'in_progress']);
  });

  it('does not call callback when only non-status fields change', () => {
    const featureName = 'no-callback';
    setupFeature(featureName);
    setupTask(featureName, '01-test', { status: 'in_progress', startedAt: '2024-01-01' });

    let callbackCalled = false;

    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off', {
      onTaskStatusChanged: () => { callbackCalled = true; },
    });

    service.update(featureName, '01-test', { summary: 'Updated summary' });
    expect(callbackCalled).toBe(false);
  });
});
