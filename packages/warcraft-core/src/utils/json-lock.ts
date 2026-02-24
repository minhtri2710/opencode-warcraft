/**
 * Atomic JSON read-modify-write with single-lock protection
 * 
 * This module provides the `updateJsonLockedSync` helper for safe concurrent
 * updates to JSON files. It uses file locking and atomic write operations
 * from `paths.ts` internally.
 */

import { acquireLockSync, writeJsonAtomic, readJson } from './paths.js';
import type { LockOptions } from './paths.js';

/**
 * Read-modify-write JSON with lock protection using a callback updater.
 * 
 * Reads current content, applies transformation via callback, writes atomically.
 * This is the core single-lock RMW primitive.
 * 
 * @param filePath - Path to JSON file
 * @param updater - Function that receives current data and returns updated data
 * @param fallback - Default data to use if file doesn't exist
 * @param options - Lock options (import from 'warcraft-core' to use LockOptions type)
 * @returns The result of the updater function
 */
export function updateJsonLockedSync<T>(
  filePath: string,
  updater: (current: T) => T,
  fallback: T,
  options: LockOptions = {}
): T {
  const release = acquireLockSync(filePath, options);
  try {
    const current = readJson<T>(filePath) ?? fallback;
    const updated = updater(current);
    writeJsonAtomic(filePath, updated);
    return updated;
  } finally {
    release();
  }
}
