import { describe, expect, it } from 'bun:test';
import { createStores } from './index.js';

describe('createStores extra edge cases', () => {
  it('off mode stores have all required methods', () => {
    const stores = createStores('/tmp/test', 'off', {} as any);
    expect(typeof stores.featureStore.exists).toBe('function');
    expect(typeof stores.featureStore.create).toBe('function');
    expect(typeof stores.featureStore.get).toBe('function');
    expect(typeof stores.featureStore.list).toBe('function');
    expect(typeof stores.featureStore.save).toBe('function');
    expect(typeof stores.featureStore.complete).toBe('function');
    expect(typeof stores.featureStore.reopen).toBe('function');

    expect(typeof stores.planStore.approve).toBe('function');
    expect(typeof stores.planStore.isApproved).toBe('function');
    expect(typeof stores.planStore.revokeApproval).toBe('function');
    expect(typeof stores.planStore.syncPlanDescription).toBe('function');

    expect(typeof stores.taskStore.list).toBe('function');
    expect(typeof stores.taskStore.get).toBe('function');
    expect(typeof stores.taskStore.save).toBe('function');
    expect(typeof stores.taskStore.delete).toBe('function');
  });

  it('on mode requires repository', () => {
    expect(() => createStores('/tmp/test', 'on')).toThrow();
  });

  it('on mode stores have all required methods when repository provided', () => {
    const mockRepo = {
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
      addWorkflowLabel: () => ({ success: true, value: undefined }),
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
      getRobotPlan: () => ({ success: false, error: new Error('n') }),
      getRobotInsights: () => null,
      getViewerHealth: () => ({ success: false, error: new Error('n') }),
      importArtifacts: () => ({ success: true, value: undefined }),
      flushArtifacts: () => ({ success: true, value: undefined }),
    } as any;

    const stores = createStores('/tmp/test', 'on', mockRepo);
    expect(typeof stores.featureStore.exists).toBe('function');
    expect(typeof stores.planStore.approve).toBe('function');
    expect(typeof stores.taskStore.list).toBe('function');
  });
});
