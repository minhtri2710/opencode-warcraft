// Storage port interfaces
export type {
  FeatureStore,
  TaskStore,
  PlanStore,
  StoreSet,
  CreateFeatureInput,
  TaskArtifactKind,
  TaskSaveOptions,
} from './types.js';

// Concrete adapters
export { BeadsFeatureStore } from './beads-feature-store.js';
export { FilesystemFeatureStore } from './fs-feature-store.js';
export { BeadsTaskStore } from './beads-task-store.js';
export { FilesystemTaskStore } from './fs-task-store.js';
export { BeadsPlanStore } from './beads-plan-store.js';
export { FilesystemPlanStore } from './fs-plan-store.js';

// Factory
export { createStores } from './factory.js';
