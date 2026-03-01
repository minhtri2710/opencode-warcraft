// Storage port interfaces

// Concrete adapters
export { BeadsFeatureStore } from './beads-feature-store.js';
export { BeadsPlanStore } from './beads-plan-store.js';
export { BeadsTaskStore } from './beads-task-store.js';
// Factory
export { createStores } from './factory.js';
export { FilesystemFeatureStore } from './fs-feature-store.js';
export { FilesystemPlanStore } from './fs-plan-store.js';
export { FilesystemTaskStore } from './fs-task-store.js';
export type {
  CreateFeatureInput,
  FeatureStore,
  PlanStore,
  StoreSet,
  TaskArtifactKind,
  TaskSaveOptions,
  TaskStore,
} from './types.js';
