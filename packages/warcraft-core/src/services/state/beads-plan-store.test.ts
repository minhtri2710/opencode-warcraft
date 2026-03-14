import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RepositoryError } from '../beads/BeadsRepository.js';
import { BeadsPlanStore } from './beads-plan-store.js';

function createTempProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-plan-store-'));
}

function initFailure(
  message: string = 'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed',
): RepositoryError {
  return new RepositoryError('gateway_error', `Bead gateway error: ${message}`);
}

describe('BeadsPlanStore fail-fast behavior', () => {
  it('throws from approve() when epic resolution fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: false as const, error: initFailure() }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);

    expect(() => store.approve('test-feature', '# Plan', new Date().toISOString())).toThrow(
      'Failed to resolve epic for feature',
    );
  });

  it('throws from approve() when setPlanDescription fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      setPlanDescription: () => ({ success: false as const, error: initFailure() }),
      getPlanDescription: () => ({ success: true as const, value: null }),
      addWorkflowLabel: () => ({ success: true as const, value: undefined }),
      removeWorkflowLabel: () => ({ success: true as const, value: undefined }),
      hasWorkflowLabel: () => ({ success: true as const, value: false }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);

    expect(() => store.approve('test-feature', '# Plan', new Date().toISOString())).toThrow(
      'Failed to sync plan description during approval',
    );
  });

  it('does not throw from syncPlanDescription() for non-init repository failures', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      setPlanDescription: () => ({
        success: false as const,
        error: new RepositoryError('gateway_error', 'Bead gateway error: generic failure'),
      }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);

    expect(() => store.syncPlanDescription('test-feature', '# Plan')).not.toThrow();
  });
});

describe('BeadsPlanStore approval workflow', () => {
  it('isApproved returns true when label exists and description matches', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      hasWorkflowLabel: () => ({ success: true as const, value: true }),
      getPlanDescription: () => ({ success: true as const, value: '# My Plan' }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    expect(store.isApproved('test-feature', '# My Plan')).toBe(true);
  });

  it('isApproved returns false when description differs', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      hasWorkflowLabel: () => ({ success: true as const, value: true }),
      getPlanDescription: () => ({ success: true as const, value: '# Old Plan' }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    expect(store.isApproved('test-feature', '# New Plan')).toBe(false);
  });

  it('isApproved returns false when label is missing', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      hasWorkflowLabel: () => ({ success: true as const, value: false }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    expect(store.isApproved('test-feature', '# Plan')).toBe(false);
  });

  it('isApproved returns false when epic cannot be resolved', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: null }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    expect(store.isApproved('test-feature', '# Plan')).toBe(false);
  });

  it('revokeApproval removes the approved label', () => {
    const removedLabels: string[] = [];
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      removeWorkflowLabel: (_beadId: string, label: string) => {
        removedLabels.push(label);
        return { success: true as const, value: undefined };
      },
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    store.revokeApproval('test-feature');
    expect(removedLabels).toEqual(['approved']);
  });

  it('revokeApproval is safe when epic does not exist', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: null }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);
    expect(() => store.revokeApproval('nonexistent')).not.toThrow();
  });
});
