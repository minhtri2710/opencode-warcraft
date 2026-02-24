import * as path from 'path';
import * as fs from 'fs';
import type { BeadsMode } from '../types.js';

const WARCRAFT_DIR_BEADS_ON = '.beads/artifacts';
const WARCRAFT_DIR_BEADS_OFF = 'docs';
const TASKS_DIR = 'tasks';
const CONTEXT_DIR = 'context';
const PLAN_FILE = 'plan.md';
const FEATURE_FILE = 'feature.json';
const STATUS_FILE = 'status.json';
const REPORT_FILE = 'report.md';
const WORKTREES_DIR = '.worktrees';

/**
 * Validate and sanitize a name used as a filesystem path segment.
 * Rejects path traversal attempts and dangerous characters.
 * @throws Error if name contains invalid characters
 */
export function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) {
    throw new Error('Name cannot be empty');
  }
  if (/[/\\]/.test(name)) {
    throw new Error(`Name cannot contain path separators: "${name}"`);
  }
  if (name === '..' || name === '.' || name.startsWith('..')) {
    throw new Error(`Name cannot be a relative path reference: "${name}"`);
  }
  if (name.startsWith('.')) {
    throw new Error(`Name cannot start with a dot: "${name}"`);
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new Error(`Name cannot contain control characters: "${name}"`);
  }
  return name;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Get the base warcraft directory name based on beadsMode.
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 * @returns The directory name segment(s)
 */
export function getWarcraftDir(beadsMode: BeadsMode = 'on'): string {
  return beadsMode === 'on' ? WARCRAFT_DIR_BEADS_ON : WARCRAFT_DIR_BEADS_OFF;
}

/**
 * Get the full warcraft path based on beadsMode.
 * @param projectRoot - The project root directory
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 * @returns The full path to the warcraft directory
 */
export function getWarcraftPath(projectRoot: string, beadsMode: BeadsMode = 'on'): string {
  return path.join(projectRoot, getWarcraftDir(beadsMode));
}

/**
 * Get the canonical flat feature path (new layout).
 * This is the target path for all new features.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 */
export function getCanonicalFeaturePath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'on'): string {
  return path.join(getWarcraftPath(projectRoot, beadsMode), featureName);
}

/**
 * List all feature directories in the warcraft artifacts directory.
 * Uses canonical flat layout only.
 * Excludes special directories like .worktrees and internal files.
 * @param projectRoot - The project root directory
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 */
export function listFeatureDirectories(projectRoot: string, beadsMode: BeadsMode = 'on'): string[] {
  const warcraftPath = getWarcraftPath(projectRoot, beadsMode);
  const features = new Set<string>();

  // Scan canonical flat location only
  if (fs.existsSync(warcraftPath)) {
    const entries = fs.readdirSync(warcraftPath, { withFileTypes: true })
      .filter(entry => {
        // Must be a directory
        if (!entry.isDirectory()) return false;
        // Exclude special directories
        if (entry.name === WORKTREES_DIR) return false;
        if (entry.name.startsWith('.')) return false;
        return true;
      })
      .map(entry => entry.name);

    for (const entry of entries) {
      features.add(entry);
    }
  }

  return Array.from(features);
}

/**
 * Get the canonical feature path.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 * @returns The canonical feature path
 */
export function getFeaturePath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'on'): string {
  return getCanonicalFeaturePath(projectRoot, featureName, beadsMode);
}

/**
 * Get the plan.md path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 */
export function getPlanPath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'on'): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), PLAN_FILE);
}

/**
 * Get the feature.json path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs
 */
export function getFeatureJsonPath(projectRoot: string, featureName: string, beadsMode: BeadsMode): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), FEATURE_FILE);
}

/**
 * Get the context directory path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'on')
 */
export function getContextPath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'on'): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), CONTEXT_DIR);
}

/**
 * Get the tasks directory path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getTasksPath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'off'): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), TASKS_DIR);
}

/**
 * Get the path for a specific task folder.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getTaskPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
  beadsMode: BeadsMode = 'off',
): string {
  return path.join(getTasksPath(projectRoot, featureName, beadsMode), taskFolder);
}

/**
 * Get the status.json path for a task.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getTaskStatusPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
  beadsMode: BeadsMode = 'off',
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder, beadsMode), STATUS_FILE);
}

/**
 * Get the report.md path for a task.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getTaskReportPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
  beadsMode: BeadsMode = 'off',
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder, beadsMode), REPORT_FILE);
}

/**
 * Get the spec.md path for a task.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getTaskSpecPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
  beadsMode: BeadsMode = 'off',
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder, beadsMode), 'spec.md');
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function writeJson<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ============================================================================
// Atomic + Locked JSON Write Utilities
// ============================================================================

/** Lock acquisition options */
export interface LockOptions {
  /** Maximum time to wait for lock acquisition (ms). Default: 5000 */
  timeout?: number;
  /** Time between lock acquisition attempts (ms). Default: 50 */
  retryInterval?: number;
  /** Time after which a stale lock is broken (ms). Default: 30000 */
  staleLockTTL?: number;
}

/** Default lock options */
const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  timeout: 5000,
  retryInterval: 50,
  staleLockTTL: 30000,
};

/**
 * Get the lock file path for a given file
 */
export function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * Check if a lock file is stale (older than TTL)
 */
function isLockStale(lockPath: string, staleTTL: number): boolean {
  try {
    const stat = fs.statSync(lockPath);
    const age = Date.now() - stat.mtimeMs;
    if (age <= staleTTL) {
      return false; // Not old enough to be stale
    }
    // Lock is old — check if owning process is still alive
    try {
      const lockContent = fs.readFileSync(lockPath, 'utf-8');
      const lockData = JSON.parse(lockContent) as { pid?: number };
      if (lockData.pid) {
        try {
          process.kill(lockData.pid, 0); // Signal 0 = check existence
          return false; // Process is alive, lock is not stale
        } catch {
          return true; // Process is dead, lock is stale
        }
      }
    } catch {
      // Cannot read/parse lock file, treat as stale
    }
    return true;
  } catch {
    return true; // If we can't stat it, treat as stale
  }
}

/**
 * Acquire an exclusive lock on a file.
 * Uses exclusive file creation (O_EXCL) for atomic lock acquisition.
 * 
 * @param filePath - Path to the file to lock
 * @param options - Lock acquisition options
 * @returns A release function to call when done
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(
  filePath: string,
  options: LockOptions = {}
): Promise<() => void> {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();
  const lockContent = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    filePath,
  });

  while (true) {
    try {
      // Attempt exclusive create (O_CREAT | O_EXCL | O_WRONLY)
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, lockContent);
      fs.closeSync(fd);
      
      // Lock acquired - return release function
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Lock file already removed, that's fine
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EEXIST') {
        throw error; // Unexpected error
      }

      // Lock exists - check if stale
      if (isLockStale(lockPath, opts.staleLockTTL)) {
        try {
          fs.unlinkSync(lockPath);
          continue; // Retry immediately after breaking stale lock
        } catch {
          // Another process might have removed it, continue
        }
      }

      // Check timeout
      if (Date.now() - startTime >= opts.timeout) {
        throw new Error(
          `Failed to acquire lock on ${filePath} after ${opts.timeout}ms. ` +
          `Lock file: ${lockPath}`
        );
      }

      // Wait and retry with fixed interval
      await new Promise(resolve => setTimeout(resolve, opts.retryInterval));
    }
  }
}

/**
 * Synchronous version of acquireLock for simpler use cases
 */
export function acquireLockSync(
  filePath: string,
  options: LockOptions = {}
): () => void {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();
  const lockContent = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    filePath,
  });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, lockContent);
      fs.closeSync(fd);
      
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Lock file already removed
        }
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (isLockStale(lockPath, opts.staleLockTTL)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // Continue
        }
      }

      if (Date.now() - startTime >= opts.timeout) {
        throw new Error(
          `Failed to acquire lock on ${filePath} after ${opts.timeout}ms. ` +
          `Lock file: ${lockPath}`
        );
      }

      // Non-spinning sleep using SharedArrayBuffer + Atomics.wait
      const sab = new SharedArrayBuffer(4);
      const view = new Int32Array(sab);
      Atomics.wait(view, 0, 0, opts.retryInterval);
    }
  }
}

/**
 * Write a file atomically using write-to-temp-then-rename pattern.
 * This ensures no partial writes are visible to readers.
 * 
 * @param filePath - Destination file path
 * @param content - Content to write
 */
export function writeAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  
  // Generate unique temp file in same directory (for same-filesystem rename)
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  
  try {
    fs.writeFileSync(tempPath, content);
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Write JSON atomically
 */
export function writeJsonAtomic<T>(filePath: string, data: T): void {
  writeAtomic(filePath, JSON.stringify(data, null, 2));
}

/**
 * Write JSON with exclusive lock (async version).
 * Ensures only one process writes at a time and writes are atomic.
 * 
 * @param filePath - Path to JSON file
 * @param data - Data to write
 * @param options - Lock options
 */
export async function writeJsonLocked<T>(
  filePath: string,
  data: T,
  options: LockOptions = {}
): Promise<void> {
  const release = await acquireLock(filePath, options);
  try {
    writeJsonAtomic(filePath, data);
  } finally {
    release();
  }
}

/**
 * Synchronous version of writeJsonLocked
 */
export function writeJsonLockedSync<T>(
  filePath: string,
  data: T,
  options: LockOptions = {}
): void {
  const release = acquireLockSync(filePath, options);
  try {
    writeJsonAtomic(filePath, data);
  } finally {
    release();
  }
}

/**
 * Deep merge utility that explicitly handles nested objects.
 * - Arrays are replaced, not merged
 * - Undefined values in patch are ignored (don't delete existing keys)
 * - Null values explicitly set to null
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  patch: Partial<T>
): T {
  const result = { ...target };
  
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const patchValue = patch[key];
    
    // Skip undefined values (don't overwrite)
    if (patchValue === undefined) {
      continue;
    }
    
    // If both are plain objects (not arrays, not null), deep merge
    if (
      patchValue !== null &&
      typeof patchValue === 'object' &&
      !Array.isArray(patchValue) &&
      result[key] !== null &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        patchValue as Record<string, unknown>
      ) as T[keyof T];
    } else {
      // Direct assignment for primitives, arrays, null
      result[key] = patchValue as T[keyof T];
    }
  }
  
  return result;
}

/**
 * Read-modify-write JSON with lock protection.
 * Reads current content, applies patch via deep merge, writes atomically.
 * 
 * @param filePath - Path to JSON file
 * @param patch - Partial update to merge
 * @param options - Lock options
 * @returns The merged result
 */
export async function patchJsonLocked<T extends object>(
  filePath: string,
  patch: Partial<T>,
  options: LockOptions = {}
): Promise<T> {
  const release = await acquireLock(filePath, options);
  try {
    const current = readJson<T>(filePath) || ({} as T);
    const merged = deepMerge(current as Record<string, unknown>, patch as Record<string, unknown>) as T;
    writeJsonAtomic(filePath, merged);
    return merged;
  } finally {
    release();
  }
}

/**
 * Synchronous version of patchJsonLocked
 */
export function patchJsonLockedSync<T extends object>(
  filePath: string,
  patch: Partial<T>,
  options: LockOptions = {}
): T {
  const release = acquireLockSync(filePath, options);
  try {
    const current = readJson<T>(filePath) || ({} as T);
    const merged = deepMerge(current as Record<string, unknown>, patch as Record<string, unknown>) as T;
    writeJsonAtomic(filePath, merged);
    return merged;
  } finally {
    release();
  }
}

export function readText(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeText(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}
