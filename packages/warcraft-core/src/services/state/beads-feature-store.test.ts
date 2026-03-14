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

  it('save() writes feature.json without calling setFeatureState', () => {
    const projectRoot = createTempProjectRoot();
    const repository = {
      getEpicByFeatureName: () => ({ success: true as const, value: 'epic-1' }),
    };

    const store = new BeadsFeatureStore(projectRoot, repository as any);
    const feature: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-1',
      status: 'planning',
      createdAt: new Date().toISOString(),
    };

    // save() should not throw — it just writes feature.json locally
    expect(() => store.save(feature)).not.toThrow();
  });
});

describe('BeadsFeatureStore lifecycle', () => {
  it('reopen() writes feature.json and reopens the epic bead', () => {
    const projectRoot = createTempProjectRoot();
    const reopenCalls: string[] = [];
    const repository = {
      reopenBead: (beadId: string) => {
        reopenCalls.push(beadId);
        return { success: true as const, value: undefined };
      },
    };

    const store = new BeadsFeatureStore(projectRoot, repository as any);
    const feature: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-1',
      status: 'executing',
      createdAt: new Date().toISOString(),
      approvedAt: '2026-03-01T00:00:00.000Z',
    };

    store.reopen(feature);

    expect(reopenCalls).toEqual(['epic-1']);
    const saved = JSON.parse(
      fs.readFileSync(path.join(projectRoot, '.beads', 'artifacts', 'test-feature', 'feature.json'), 'utf-8'),
    ) as FeatureJson;
    expect(saved.status).toBe('executing');
    expect(saved.approvedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('complete() writes feature.json and closes the epic bead', () => {
    const projectRoot = createTempProjectRoot();
    const closeCalls: string[] = [];
    const repository = {
      closeBead: (beadId: string) => {
        closeCalls.push(beadId);
        return { success: true as const, value: undefined };
      },
    };

    const store = new BeadsFeatureStore(projectRoot, repository as any);
    const feature: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-2',
      status: 'completed',
      createdAt: new Date().toISOString(),
    };

    store.complete(feature);
    expect(closeCalls).toEqual(['epic-2']);
  });

  it('exists() returns false for non-existent feature', () => {
    const store = new BeadsFeatureStore(createTempProjectRoot(), {} as any);
    expect(store.exists('nonexistent')).toBe(false);
  });

  it('exists() returns true after save()', () => {
    const projectRoot = createTempProjectRoot();
    const store = new BeadsFeatureStore(projectRoot, {} as any);
    const feature: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-1',
      status: 'planning',
      createdAt: new Date().toISOString(),
    };

    // Create the feature directory structure first
    const featurePath = path.join(projectRoot, '.beads', 'artifacts', 'test-feature');
    fs.mkdirSync(featurePath, { recursive: true });

    store.save(feature);
    expect(store.exists('test-feature')).toBe(true);
  });

  it('list() returns sorted feature names from epic listing', () => {
    const repository = {
      listEpics: () => ({
        success: true as const,
        value: [
          { title: 'zebra-feature', id: 'e3' },
          { title: 'alpha-feature', id: 'e1' },
          { title: 'middle-feature', id: 'e2' },
        ],
      }),
    };

    const store = new BeadsFeatureStore(createTempProjectRoot(), repository as any);
    const result = store.list();
    expect(result).toEqual(['alpha-feature', 'middle-feature', 'zebra-feature']);
  });

  it('list() returns empty array when repository fails', () => {
    const repository = {
      listEpics: () => ({
        success: false as const,
        error: new RepositoryError('gateway_error', 'Generic failure'),
      }),
    };

    const store = new BeadsFeatureStore(createTempProjectRoot(), repository as any);
    expect(store.list()).toEqual([]);
  });
});
