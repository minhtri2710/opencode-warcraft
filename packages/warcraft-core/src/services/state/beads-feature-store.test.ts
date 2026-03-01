import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureJson } from '../../types.js';
import { RepositoryError } from '../beads/BeadsRepository.js';
import { BeadsFeatureStore } from './beads-feature-store.js';

function createTempProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-feature-store-'));
}

function initFailure(
  message: string = 'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed',
): RepositoryError {
  return new RepositoryError('gateway_error', `Bead gateway error: ${message}`);
}

describe('BeadsFeatureStore fail-fast behavior', () => {
  it('throws from get() when epic lookup fails with initialization-class error', () => {
    const repository = {
      getEpicByFeatureName: () => ({ success: false as const, error: initFailure() }),
    };

    const store = new BeadsFeatureStore(createTempProjectRoot(), repository as any);

    expect(() => store.get('test-feature')).toThrow('Failed to get epic for feature');
  });

  it('returns null from get() for non-initialization lookup failures', () => {
    const repository = {
      getEpicByFeatureName: () => ({
        success: false as const,
        error: new RepositoryError('gateway_error', 'Bead gateway error: generic failure'),
      }),
    };

    const store = new BeadsFeatureStore(createTempProjectRoot(), repository as any);

    expect(store.get('test-feature')).toBeNull();
  });

  it('throws from save() when writing feature state fails with initialization-class error', () => {
    const repository = {
      setFeatureState: () => ({ success: false as const, error: initFailure() }),
    };

    const store = new BeadsFeatureStore(createTempProjectRoot(), repository as any);
    const feature: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-1',
      status: 'planning',
      createdAt: new Date().toISOString(),
    };

    expect(() => store.save(feature)).toThrow('Failed to write feature state');
  });
});
