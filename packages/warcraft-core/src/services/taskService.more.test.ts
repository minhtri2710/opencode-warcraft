import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BeadsRepository } from './beads/BeadsRepository.js';
import { createStores } from './state/index.js';
import { TaskService } from './taskService.js';

let testRoot = '';

function createMockRepository(): BeadsRepository {
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
  } as any;
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
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskservice-more-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('TaskService get/list/getRawStatus', () => {
  it('get returns null for non-existent task', () => {
    setupFeature('feat');
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    expect(service.get('feat', '99-nonexistent')).toBeNull();
  });

  it('getRawStatus returns null for non-existent task', () => {
    setupFeature('feat');
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    expect(service.getRawStatus('feat', '99-nonexistent')).toBeNull();
  });

  it('list returns empty for feature with no tasks', () => {
    setupFeature('empty-feat');
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    expect(service.list('empty-feat')).toEqual([]);
  });

  it('list returns tasks sorted by folder', () => {
    setupFeature('sorted');
    setupTask('sorted', '02-second');
    setupTask('sorted', '01-first');
    setupTask('sorted', '03-third');
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    const tasks = service.list('sorted');
    expect(tasks.map((t) => t.folder)).toEqual(['01-first', '02-second', '03-third']);
  });
});

describe('TaskService writeReport', () => {
  it('writeReport creates report.md in task folder', () => {
    setupFeature('report-feat');
    setupTask('report-feat', '01-task');
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    const reportPath = service.writeReport('report-feat', '01-task', '# Report');
    expect(fs.existsSync(reportPath)).toBe(true);
  });
});

describe('TaskService.computeRunnableStatus', () => {
  it('returns all pending tasks as runnable when no dependencies', () => {
    setupFeature('runnable');
    setupTask('runnable', '01-a', { status: 'pending', dependsOn: [] });
    setupTask('runnable', '02-b', { status: 'pending', dependsOn: [] });
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    const result = service.computeRunnableStatus('runnable');
    expect(result.runnable).toContain('01-a');
    expect(result.runnable).toContain('02-b');
  });

  it('blocks task with unmet dependency', () => {
    setupFeature('blocked');
    setupTask('blocked', '01-a', { status: 'pending', dependsOn: [] });
    setupTask('blocked', '02-b', { status: 'pending', dependsOn: ['01-a'] });
    const stores = createStores(testRoot, 'off', createMockRepository());
    const service = new TaskService(testRoot, stores.taskStore, 'off');
    const result = service.computeRunnableStatus('blocked');
    expect(result.runnable).toContain('01-a');
    expect(result.blocked['02-b']).toEqual(['01-a']);
  });
});
