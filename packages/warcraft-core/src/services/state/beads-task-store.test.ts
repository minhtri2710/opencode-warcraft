import { describe, expect, it } from 'bun:test';
import { RepositoryError } from '../beads/BeadsRepository.js';
import { BeadsTaskStore } from './beads-task-store.js';

function initFailure(message: string = 'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed'): RepositoryError {
  return new RepositoryError('gateway_error', `Bead gateway error: ${message}`);
}

describe('BeadsTaskStore fail-fast behavior', () => {
  it('throws from list() when task listing fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      listTaskBeadsForEpic: () => ({ success: false as const, error: initFailure() }),
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
    };

    const store = new BeadsTaskStore('/tmp/project', repository as any);

    expect(store.list('test-feature')).toEqual([]);
  });

  it('throws from save() when syncTaskStatus fails with initialization-class error', () => {
    const repository = {
      setTaskState: () => ({ success: true as const, value: undefined }),
      flushArtifacts: () => ({ success: true as const, value: undefined }),
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
      )
    ).toThrow("Failed to sync bead status for 'task-1'");
  });
});
