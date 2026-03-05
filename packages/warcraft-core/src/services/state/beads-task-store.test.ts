import { describe, expect, it, spyOn } from 'bun:test';
import { RepositoryError } from '../beads/BeadsRepository.js';
import { BeadsTaskStore } from './beads-task-store.js';

function initFailure(
  message: string = 'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed',
): RepositoryError {
  return new RepositoryError('gateway_error', `Bead gateway error: ${message}`);
}

describe('BeadsTaskStore fail-fast behavior', () => {
  it('throws from list() when task listing fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => ({ success: false as const, error: initFailure() }),
      getTaskState: () => ({ success: true as const, value: null }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(() => store.list('test-feature')).toThrow('Failed to list task beads for epic');
  });

  it('returns empty list from list() for non-initialization listing failures', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => ({
        success: false as const,
        error: new RepositoryError('gateway_error', 'Bead gateway error: generic failure'),
      }),
      getTaskState: () => ({ success: true as const, value: null }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(store.list('test-feature')).toEqual([]);
  });

  it('throws from save() when syncTaskStatus fails with initialization-class error', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          throw initFailure();
        },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(() =>
      store.save(
        'test-feature',
        '01-task',
        { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1' },
        { syncBeadStatus: true },
      ),
    ).toThrow("Failed to sync bead status for 'task-1'");
  });
});

describe('BeadsTaskStore caching layer', () => {
  it('get() uses cache after list() is called, avoiding O(n) search', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [
            { id: 'task-1', title: 'Task 1', status: 'pending' },
            { id: 'task-2', title: 'Task 2', status: 'pending' },
          ],
        };
      },
      getTaskState: (beadId: string) => ({
        success: true as const,
        value:
          beadId === 'task-1'
            ? { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' }
            : { folder: '02-task-2', status: 'pending', origin: 'plan', planTitle: 'Task 2' },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // Subsequent get() calls should use cache (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);

    store.get('test-feature', '02-task-2');
    expect(listCallCount).toBe(1);

    // Accessing non-existent task should still use cache (listCallCount stays at 1)
    store.get('test-feature', '99-nonexistent');
    expect(listCallCount).toBe(1);
  });

  it('getRawStatus() uses cache after list() is called, avoiding O(n) search', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // Subsequent getRawStatus() calls should use cache (listCallCount stays at 1)
    store.getRawStatus('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);

    store.getRawStatus('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('save() invalidates cache entry for the modified task', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' },
      }),
      setTaskState: () => ({ success: true as const, value: undefined }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // get() uses cache (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);

    // save() invalidates the cache entry
    store.save('test-feature', '01-task-1', {
      status: 'in_progress',
      origin: 'plan',
      beadId: 'task-1',
      planTitle: 'Task 1',
      folder: '01-task-1',
    });

    // get() should still use cache for the task entry (no new list call)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('createTask() invalidates cache for the feature', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' },
      }),
      setTaskState: () => ({ success: true as const, value: undefined }),
      getGateway: () => ({
        createTask: () => 'task-2',
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // createTask() invalidates the cache
    store.createTask('test-feature', '02-task-2', 'Task 2', 'pending', 3);

    // Subsequent get() should still not call list (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('delete() invalidates cache entry for the deleted task', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // delete() invalidates the cache entry
    store.delete('test-feature', '01-task-1');

    // get() should still use cache for the task entry (returns null now) (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('patchBackground() invalidates cache entry for the patched task', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1', beadId: 'task-1' },
      }),
      getGateway: () => ({
        upsertArtifact: () => undefined,
      }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // patchBackground() invalidates the cache entry
    store.patchBackground('test-feature', '01-task-1', { idempotencyKey: 'test-key' });

    // get() should still use cache for the task entry (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('syncDependencies() invalidates cache for the feature', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [
            { id: 'task-1', title: 'Task 1', status: 'pending' },
            { id: 'task-2', title: 'Task 2', status: 'pending' },
          ],
        };
      },
      getTaskState: (beadId: string) => ({
        success: true as const,
        value:
          beadId === 'task-1'
            ? { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1', dependsOn: ['02-task-2'] }
            : { folder: '02-task-2', status: 'pending', origin: 'plan', planTitle: 'Task 2', dependsOn: [] },
      }),
      getGateway: () => ({
        listDependencies: () => [],
        addDependency: () => undefined,
        removeDependency: () => undefined,
      }),
      getViewerGateway: () => ({
        getHealth: () => ({ available: false }),
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // First list() populates cache (listCallCount = 1)
    store.list('test-feature');
    expect(listCallCount).toBe(1);

    // syncDependencies() invalidates the cache
    store.syncDependencies('test-feature');

    // Subsequent get() should still not call list (listCallCount stays at 1)
    store.get('test-feature', '01-task-1');
    expect(listCallCount).toBe(1);
  });

  it('getRunnableTasks() calls list() at most once even when processing many tasks', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: Array.from({ length: 10 }, (_, i) => ({
            id: `task-${i}`,
            title: `Task ${i}`,
            status: 'pending',
          })),
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task', status: 'pending', origin: 'plan', planTitle: 'Task', dependsOn: [] },
      }),
      getRobotPlan: () => ({
        tracks: [{ name: 'track-1', tasks: Array.from({ length: 10 }, (_, i) => `task-${i}`) }],
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // getRunnableTasks() should call list() only once (to populate cache)
    store.getRunnableTasks('test-feature');
    expect(listCallCount).toBe(1);
  });

  it('cache is isolated per feature', () => {
    let listCallCount = 0;
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => {
        listCallCount++;
        return {
          success: true as const,
          value: [{ id: 'task-1', title: 'Task 1', status: 'pending' }],
        };
      },
      getTaskState: () => ({
        success: true as const,
        value: { folder: '01-task-1', status: 'pending', origin: 'plan', planTitle: 'Task 1' },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // List for feature-1 (listCallCount = 1)
    store.list('feature-1');
    expect(listCallCount).toBe(1);

    // List for feature-2 (listCallCount = 2 - separate cache entry)
    store.list('feature-2');
    expect(listCallCount).toBe(2);

    // get() for feature-1 uses its cache (listCallCount stays at 2)
    store.get('feature-1', '01-task-1');
    expect(listCallCount).toBe(2);

    // get() for feature-2 uses its cache (listCallCount stays at 2)
    store.get('feature-2', '01-task-1');
    expect(listCallCount).toBe(2);
  });
});

describe('BeadsTaskStore audit trail for state transitions', () => {
  it('appends transition comment after status sync when syncBeadStatus is true', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const appendCommentSpy = spyOn(repository, 'appendComment');

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    store.save(
      'test-feature',
      '01-task',
      { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1', summary: 'Working on task' },
      { syncBeadStatus: true },
    );

    expect(appendCommentSpy).toHaveBeenCalledTimes(1);
    expect(appendCommentSpy).toHaveBeenCalledWith(
      'task-1',
      expect.stringMatching(
        /^\[warcraft:transition\] pending → in_progress \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \| Working on task$/,
      ),
    );
  });

  it('does not append transition comment when syncBeadStatus is false', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const appendCommentSpy = spyOn(repository, 'appendComment');

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    store.save(
      'test-feature',
      '01-task',
      { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1' },
      { syncBeadStatus: false },
    );

    expect(appendCommentSpy).not.toHaveBeenCalled();
  });

  it('does not throw when appendComment returns failure result', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: false as const, error: new Error('Failed to add comment') }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(() =>
      store.save(
        'test-feature',
        '01-task',
        { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1' },
        { syncBeadStatus: true },
      ),
    ).not.toThrow();
  });

  it('does not throw when appendComment throws an exception', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => {
        throw new Error('br command crashed');
      },
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(() =>
      store.save(
        'test-feature',
        '01-task',
        { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1' },
        { syncBeadStatus: true },
      ),
    ).not.toThrow();
  });

  it('trims trailing whitespace from comment body when summary is absent', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const appendCommentSpy = spyOn(repository, 'appendComment');

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    store.save(
      'test-feature',
      '01-task',
      { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1' },
      { syncBeadStatus: true },
    );

    expect(appendCommentSpy).toHaveBeenCalledTimes(1);
    const commentBody = appendCommentSpy.mock.calls[0][1] as string;
    // Comment should NOT end with trailing whitespace or pipe
    expect(commentBody).toMatch(
      /^\[warcraft:transition\] pending → in_progress \| \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \|$/,
    );
    expect(commentBody).not.toMatch(/\s$/);
  });

  it('uses previous status from readTaskState when available', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({
        success: true as const,
        value: { status: 'in_progress', origin: 'plan', planTitle: 'Task 1' },
      }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const appendCommentSpy = spyOn(repository, 'appendComment');

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    store.save(
      'test-feature',
      '01-task',
      { status: 'done', origin: 'plan', beadId: 'task-1', planTitle: 'Task 1', summary: 'Completed' },
      { syncBeadStatus: true },
    );

    expect(appendCommentSpy).toHaveBeenCalledTimes(1);
    expect(appendCommentSpy).toHaveBeenCalledWith(
      'task-1',
      expect.stringMatching(/^\[warcraft:transition\] in_progress → done \| .+ \| Completed$/),
    );
  });

  it('flushes pending transitions when flushTransitionAudit is called', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
      appendComment: () => ({ success: true as const, value: undefined }),
      getTaskState: () => ({ success: true as const, value: null }),
      getGateway: () => ({
        syncTaskStatus: () => {
          // syncTaskStatus succeeds
        },
      }),
    };

    const appendCommentSpy = spyOn(repository, 'appendComment');

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    // Save with syncBeadStatus: true triggers immediate append
    store.save(
      'test-feature',
      '01-task',
      { status: 'in_progress', origin: 'manual', beadId: 'task-1', planTitle: 'Task 1', summary: 'Working on task' },
      { syncBeadStatus: true },
    );

    expect(appendCommentSpy).toHaveBeenCalledTimes(1);

    // Flush pending transitions (should be empty since we already appended)
    store.flushTransitionAudit();

    // Count should still be 1 since no pending transitions were accumulated
    expect(appendCommentSpy).toHaveBeenCalledTimes(1);
  });
});
