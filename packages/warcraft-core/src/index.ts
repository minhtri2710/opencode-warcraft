export * from './defaults.js';
export * from './services/index.js';
export * from './types.js';
export * from './utils/detection.js';
export * from './utils/fs.js';
export type { LockOptions } from './utils/json-lock.js';
export {
  acquireLock,
  acquireLockSync,
  deepMerge,
  getLockPath,
  patchJsonLocked,
  patchJsonLockedSync,
  updateJsonLockedSync,
  writeAtomic,
  writeJsonAtomic,
  writeJsonLocked,
  writeJsonLockedSync,
} from './utils/json-lock.js';
export * from './utils/paths.js';
export * from './utils/slug.js';
