/**
 * Factory for creating the appropriate store implementations
 * based on beadsMode configuration.
 */

import type { BeadsMode } from '../../types.js';
import type { BeadsRepository } from '../beads/BeadsRepository.js';
import { BeadsFeatureStore } from './beads-feature-store.js';
import { BeadsPlanStore } from './beads-plan-store.js';
import { BeadsTaskStore } from './beads-task-store.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';
import { FilesystemPlanStore } from './fs-plan-store.js';
import { FilesystemTaskStore } from './fs-task-store.js';
import type { StoreSet } from './types.js';

/**
 * Create the full set of stores based on beadsMode.
 *
 * @param projectRoot - Project root directory
 * @param beadsMode - Current beads mode ('on' or 'off')
 * @param repository - BeadsRepository instance (used by beads stores and filesystem task store for bead ID generation)
 */
export function createStores(projectRoot: string, beadsMode: BeadsMode, repository: BeadsRepository): StoreSet {
  if (beadsMode === 'on') {
    return {
      featureStore: new BeadsFeatureStore(projectRoot, repository),
      taskStore: new BeadsTaskStore(projectRoot, repository),
      planStore: new BeadsPlanStore(projectRoot, repository),
    };
  }

  return {
    featureStore: new FilesystemFeatureStore(projectRoot),
    taskStore: new FilesystemTaskStore(projectRoot, repository),
    planStore: new FilesystemPlanStore(projectRoot),
  };
}
