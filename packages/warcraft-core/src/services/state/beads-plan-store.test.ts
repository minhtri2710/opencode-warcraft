import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RepositoryError } from '../beads/BeadsRepository.js';
import { BeadsPlanStore } from './beads-plan-store.js';

function createTempProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-plan-store-'));
}

function initFailure(message: string = 'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed'): RepositoryError {
  return new RepositoryError('gateway_error', `Bead gateway error: ${message}`);
}

describe('BeadsPlanStore fail-fast behavior', () => {
  it('throws from approve() when epic resolution fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: false as const, error: initFailure() }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);

    expect(() => store.approve('test-feature', '# Plan', 'a'.repeat(64), new Date().toISOString())).toThrow(
      'Failed to resolve epic for feature',
    );
  });

  it('throws from approve() when setPlanApproval fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
      setPlanApproval: () => ({ success: false as const, error: initFailure() }),
      setApprovedPlan: () => ({ success: true as const, value: undefined }),
      addWorkflowLabel: () => ({ success: true as const, value: undefined }),
      setFeatureState: () => ({ success: true as const, value: undefined }),
    };

    const store = new BeadsPlanStore(createTempProjectRoot(), repository as any);

    expect(() => store.approve('test-feature', '# Plan', 'a'.repeat(64), new Date().toISOString())).toThrow(
      'Failed to set plan approval',
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
