import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureDir, readJson } from './fs.js';

// ============================================================================
// Lock Types & Defaults
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

interface LockFileContent {
  pid: number;
  timestamp: string;
  filePath: string;
  sessionId: string;
  hostname: string;
  lockId: string;
}

type PidProbeResult = 'alive' | 'dead' | 'inconclusive';

/** Default lock options */
const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  timeout: 5000,
  retryInterval: 50,
  staleLockTTL: 30000,
};

const PROCESS_SESSION_ID = randomUUID();
const LOCAL_HOSTNAME = os.hostname();

// ============================================================================
// Lock Path & Staleness
// ============================================================================

/**
 * Get the lock file path for a given file
 */
export function getLockPath(filePath: string): string {
  return `${filePath}.lock`;
}

function createLockContent(filePath: string): LockFileContent {
  return {
    pid: process.pid,
    timestamp: new Date().toISOString(),
    filePath,
    sessionId: PROCESS_SESSION_ID,
    hostname: LOCAL_HOSTNAME,
    lockId: randomUUID(),
  };
}

function parseLockContent(lockPath: string): LockFileContent | null {
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LockFileContent>;

    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.filePath !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.hostname !== 'string' ||
      typeof parsed.lockId !== 'string'
    ) {
      return null;
    }

    return parsed as LockFileContent;
  } catch {
    return null;
  }
}

function probePid(pid: number): PidProbeResult {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const probeError = error as NodeJS.ErrnoException;
    if (probeError.code === 'ESRCH') {
      return 'dead';
    }
    if (probeError.code === 'EPERM') {
      return 'inconclusive';
    }
    return 'inconclusive';
  }
}

function releaseLockIfOwned(lockPath: string, lockId: string): void {
  const currentLock = parseLockContent(lockPath);
  if (!currentLock || currentLock.lockId !== lockId) {
    return;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    const unlinkError = error as NodeJS.ErrnoException;
    if (unlinkError.code !== 'ENOENT') {
      // Lock file may already have been replaced or removed by another process
    }
  }
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

    const lockData = parseLockContent(lockPath);
    if (!lockData) {
      return true; // Corrupt or unreadable lock file is stale
    }

    if (lockData.hostname !== LOCAL_HOSTNAME) {
      // Cross-host PID probing is unreliable; apply TTL-only stale policy
      return true;
    }

    const pidProbe = probePid(lockData.pid);
    if (pidProbe === 'dead') {
      return true;
    }

    if (pidProbe === 'alive') {
      const sameSession = lockData.sessionId === PROCESS_SESSION_ID;
      if (sameSession) {
        return false;
      }
      // Live process with different session metadata is treated as active to avoid unsafe lock breakage
      return false;
    }

    // Inconclusive probe (permission/namespace ambiguity) falls back to TTL-only staleness
    return true;
  } catch {
    return true; // If we can't stat it, treat as stale
  }
}

// ============================================================================
// Lock Acquisition
// ============================================================================

/**
 * Acquire an exclusive lock on a file.
 * Uses exclusive file creation (O_EXCL) for atomic lock acquisition.
 *
 * @param filePath - Path to the file to lock
 * @param options - Lock acquisition options
 * @returns A release function to call when done
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(filePath: string, options: LockOptions = {}): Promise<() => void> {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();
  const lockData = createLockContent(filePath);
  const lockContent = JSON.stringify(lockData);

  while (true) {
    try {
      // Attempt exclusive create (O_CREAT | O_EXCL | O_WRONLY)
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, lockContent);
      fs.closeSync(fd);

      // Lock acquired - return release function
      return () => {
        releaseLockIfOwned(lockPath, lockData.lockId);
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
        throw new Error(`Failed to acquire lock on ${filePath} after ${opts.timeout}ms. ` + `Lock file: ${lockPath}`);
      }

      // Wait and retry with fixed interval
      await new Promise((resolve) => setTimeout(resolve, opts.retryInterval));
    }
  }
}

/**
 * Synchronous version of acquireLock for simpler use cases
 */
export function acquireLockSync(filePath: string, options: LockOptions = {}): () => void {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const lockPath = getLockPath(filePath);
  const startTime = Date.now();
  const lockData = createLockContent(filePath);
  const lockContent = JSON.stringify(lockData);

  while (true) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, lockContent);
      fs.closeSync(fd);

      return () => {
        releaseLockIfOwned(lockPath, lockData.lockId);
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
        throw new Error(`Failed to acquire lock on ${filePath} after ${opts.timeout}ms. ` + `Lock file: ${lockPath}`);
      }

      // Non-spinning sleep using SharedArrayBuffer + Atomics.wait
      const sab = new SharedArrayBuffer(4);
      const view = new Int32Array(sab);
      Atomics.wait(view, 0, 0, opts.retryInterval);
    }
  }
}

// ============================================================================
// Atomic Write
// ============================================================================

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

// ============================================================================
// Locked JSON Write
// ============================================================================

/**
 * Write JSON with exclusive lock (async version).
 * Ensures only one process writes at a time and writes are atomic.
 *
 * @param filePath - Path to JSON file
 * @param data - Data to write
 * @param options - Lock options
 */
export async function writeJsonLocked<T>(filePath: string, data: T, options: LockOptions = {}): Promise<void> {
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
export function writeJsonLockedSync<T>(filePath: string, data: T, options: LockOptions = {}): void {
  const release = acquireLockSync(filePath, options);
  try {
    writeJsonAtomic(filePath, data);
  } finally {
    release();
  }
}

// ============================================================================
// Deep Merge
// ============================================================================

/**
 * Deep merge utility that explicitly handles nested objects.
 * - Arrays are replaced, not merged
 * - Undefined values in patch are ignored (don't delete existing keys)
 * - Null values explicitly set to null
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, patch: Partial<T>): T {
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
        patchValue as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      // Direct assignment for primitives, arrays, null
      result[key] = patchValue as T[keyof T];
    }
  }

  return result;
}

// ============================================================================
// Patch JSON (Read-Modify-Write)
// ============================================================================

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
  options: LockOptions = {},
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
  options: LockOptions = {},
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

// ============================================================================
// Update JSON (callback-based RMW)
// ============================================================================

/**
 * Read-modify-write JSON with lock protection using a callback updater.
 *
 * Reads current content, applies transformation via callback, writes atomically.
 * This is the core single-lock RMW primitive.
 *
 * @param filePath - Path to JSON file
 * @param updater - Function that receives current data and returns updated data
 * @param fallback - Default data to use if file doesn't exist
 * @param options - Lock options
 * @returns The result of the updater function
 */
export function updateJsonLockedSync<T>(
  filePath: string,
  updater: (current: T) => T,
  fallback: T,
  options: LockOptions = {},
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
