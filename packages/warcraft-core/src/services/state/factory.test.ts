import { describe, expect, it } from 'bun:test';
import type { BeadsRepository } from '../beads/BeadsRepository.js';
import { BeadsFeatureStore } from './beads-feature-store.js';
import { BeadsPlanStore } from './beads-plan-store.js';
import { BeadsTaskStore } from './beads-task-store.js';
import { createStores } from './factory.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';
import { FilesystemPlanStore } from './fs-plan-store.js';
import { FilesystemTaskStore } from './fs-task-store.js';

const mockRepository = {} as BeadsRepository;

describe('createStores', () => {
  it('creates filesystem stores for off mode', () => {
    const stores = createStores('/tmp/test', 'off');
    expect(stores.featureStore).toBeInstanceOf(FilesystemFeatureStore);
    expect(stores.taskStore).toBeInstanceOf(FilesystemTaskStore);
    expect(stores.planStore).toBeInstanceOf(FilesystemPlanStore);
  });

  it('creates beads stores for on mode with repository', () => {
    const stores = createStores('/tmp/test', 'on', mockRepository);
    expect(stores.featureStore).toBeInstanceOf(BeadsFeatureStore);
    expect(stores.taskStore).toBeInstanceOf(BeadsTaskStore);
    expect(stores.planStore).toBeInstanceOf(BeadsPlanStore);
  });

  it('throws when on mode is used without repository', () => {
    expect(() => createStores('/tmp/test', 'on')).toThrow(/BeadsRepository.*required/);
  });

  it('ignores repository parameter in off mode', () => {
    const stores = createStores('/tmp/test', 'off', mockRepository);
    expect(stores.featureStore).toBeInstanceOf(FilesystemFeatureStore);
  });
});
