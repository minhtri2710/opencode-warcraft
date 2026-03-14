import { describe, expect, it } from 'bun:test';
import type { FeatureJson, TaskInfo } from '../types.js';
import { FeatureService } from './featureService.js';
import type { FeatureStore } from './state/types.js';

function createStoreStub(features: FeatureJson[] = [], overrides: Partial<FeatureStore> = {}): FeatureStore {
  const featureMap = new Map(features.map((f) => [f.name, f]));
  return {
    exists: (name) => featureMap.has(name),
    create: (input) => {
      const f: FeatureJson = { ...input, epicBeadId: `local-${input.name}` };
      featureMap.set(f.name, f);
      return f;
    },
    get: (name) => featureMap.get(name) ?? null,
    list: () => Array.from(featureMap.keys()).sort(),
    save: (f) => featureMap.set(f.name, f),
    complete: (f) => featureMap.set(f.name, f),
    reopen: (f) => featureMap.set(f.name, f),
    ...overrides,
  };
}

describe('FeatureService.getActive', () => {
  it('returns first non-completed feature alphabetically', () => {
    const store = createStoreStub([
      { name: 'beta', epicBeadId: 'b', status: 'completed', createdAt: '2024-01-01' },
      { name: 'alpha', epicBeadId: 'a', status: 'planning', createdAt: '2024-01-01' },
      { name: 'gamma', epicBeadId: 'g', status: 'executing', createdAt: '2024-01-01' },
    ]);
    const service = new FeatureService('/tmp', store, 'off');
    const active = service.getActive();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('alpha');
  });

  it('returns null when all features are completed', () => {
    const store = createStoreStub([
      { name: 'a', epicBeadId: 'a', status: 'completed', createdAt: '2024-01-01' },
      { name: 'b', epicBeadId: 'b', status: 'completed', createdAt: '2024-01-01' },
    ]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.getActive()).toBeNull();
  });

  it('returns null when no features exist', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.getActive()).toBeNull();
  });
});

describe('FeatureService.getInfo', () => {
  it('returns null for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.getInfo('missing')).toBeNull();
  });

  it('returns feature info with tasks and hasPlan', () => {
    const feature: FeatureJson = { name: 'info-test', epicBeadId: 'e', status: 'executing', createdAt: '2024-01-01' };
    const tasks: TaskInfo[] = [{ folder: '01-setup', name: 'setup', status: 'done', origin: 'plan' }];
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off', { list: () => tasks });
    const info = service.getInfo('info-test');
    expect(info).not.toBeNull();
    expect(info!.name).toBe('info-test');
    expect(info!.status).toBe('executing');
    expect(info!.tasks).toHaveLength(1);
    expect(info!.hasPlan).toBe(false); // no plan file exists
  });

  it('returns empty tasks when no taskLister provided', () => {
    const feature: FeatureJson = { name: 'no-lister', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    const info = service.getInfo('no-lister');
    expect(info!.tasks).toEqual([]);
  });
});

describe('FeatureService.syncCompletionFromTasks edge cases', () => {
  it('returns null for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.syncCompletionFromTasks('missing')).toBeNull();
  });

  it('returns feature unchanged when no tasks exist', () => {
    const feature: FeatureJson = { name: 'no-tasks', epicBeadId: 'e', status: 'executing', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off', { list: () => [] });
    const result = service.syncCompletionFromTasks('no-tasks');
    expect(result!.status).toBe('executing');
  });

  it('does not re-complete an already completed feature', () => {
    const feature: FeatureJson = {
      name: 'already-done',
      epicBeadId: 'e',
      status: 'completed',
      createdAt: '2024-01-01',
      completedAt: '2024-01-02',
    };
    const tasks: TaskInfo[] = [{ folder: '01-a', name: 'a', status: 'done', origin: 'plan' }];
    let completeCalled = false;
    const store = createStoreStub([feature], {
      complete: () => {
        completeCalled = true;
      },
    });
    const service = new FeatureService('/tmp', store, 'off', { list: () => tasks });
    const result = service.syncCompletionFromTasks('already-done');
    expect(result!.status).toBe('completed');
    expect(completeCalled).toBe(false); // Already completed, no need to call
  });

  it('does not reopen non-completed feature even if tasks incomplete', () => {
    const feature: FeatureJson = { name: 'executing', epicBeadId: 'e', status: 'executing', createdAt: '2024-01-01' };
    const tasks: TaskInfo[] = [{ folder: '01-a', name: 'a', status: 'in_progress', origin: 'plan' }];
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off', { list: () => tasks });
    const result = service.syncCompletionFromTasks('executing');
    expect(result!.status).toBe('executing'); // unchanged
  });
});

describe('FeatureService.setSession and getSession', () => {
  it('stores and retrieves sessionId', () => {
    const feature: FeatureJson = { name: 'session-test', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    service.setSession('session-test', 'sess-123');
    expect(service.getSession('session-test')).toBe('sess-123');
  });

  it('throws for non-existent feature on setSession', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(() => service.setSession('missing', 'sess')).toThrow("Feature 'missing' not found");
  });

  it('returns undefined for feature without session', () => {
    const feature: FeatureJson = { name: 'no-session', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.getSession('no-session')).toBeUndefined();
  });

  it('returns undefined for non-existent feature on getSession', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.getSession('missing')).toBeUndefined();
  });
});

describe('FeatureService.complete edge cases', () => {
  it('returns fatal for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.complete('missing');
    expect(result.severity).toBe('fatal');
    expect(result.diagnostics[0].code).toBe('feature_not_found');
  });

  it('returns fatal for already completed feature', () => {
    const feature: FeatureJson = { name: 'done', epicBeadId: 'e', status: 'completed', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.complete('done');
    expect(result.severity).toBe('fatal');
    expect(result.diagnostics[0].code).toBe('feature_already_completed');
  });
});

describe('FeatureService.updateStatus', () => {
  it('throws for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(() => service.updateStatus('missing', 'approved')).toThrow("Feature 'missing' not found");
  });

  it('sets approvedAt when transitioning to approved', () => {
    const feature: FeatureJson = { name: 'approve-test', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    const updated = service.updateStatus('approve-test', 'approved');
    expect(updated.status).toBe('approved');
    expect(updated.approvedAt).toBeDefined();
  });

  it('does not override existing approvedAt', () => {
    const feature: FeatureJson = {
      name: 'keep-approved',
      epicBeadId: 'e',
      status: 'approved',
      createdAt: '2024-01-01',
      approvedAt: '2024-01-05T00:00:00Z',
    };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    const updated = service.updateStatus('keep-approved', 'approved');
    expect(updated.approvedAt).toBe('2024-01-05T00:00:00Z');
  });
});

describe('FeatureService.create edge cases', () => {
  it('accepts minimum valid priority of 1', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.create('p1', undefined, 1);
    expect(result.severity).toBe('ok');
  });

  it('accepts maximum valid priority of 5', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.create('p5', undefined, 5);
    expect(result.severity).toBe('ok');
  });

  it('rejects non-integer priority', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.create('bad-p', undefined, 2.5);
    expect(result.severity).toBe('fatal');
    expect(result.diagnostics[0].code).toBe('invalid_priority');
  });
});
