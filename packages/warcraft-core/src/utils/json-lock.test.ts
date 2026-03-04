import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readJson } from './fs.js';
import {
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
} from './json-lock.js';

const TEST_DIR = `/tmp/warcraft-json-lock-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

/**
 * Create a fake lock file with fully-specified content and an old mtime.
 * This avoids flaky TTL races by setting the mtime far in the past.
 */
function writeStaleLock(
  lockPath: string,
  overrides: Partial<{
    pid: number;
    sessionId: string;
    hostname: string;
    lockId: string;
    filePath: string;
  }> = {},
): void {
  const content = {
    pid: overrides.pid ?? 999999999,
    timestamp: new Date(Date.now() - 120_000).toISOString(),
    filePath: overrides.filePath ?? 'test',
    sessionId: overrides.sessionId ?? 'stale-session',
    hostname: overrides.hostname ?? os.hostname(),
    lockId: overrides.lockId ?? 'stale-lock-id',
  };
  fs.writeFileSync(lockPath, JSON.stringify(content));
  // Set mtime 2 minutes in the past — well beyond any reasonable staleTTL
  const pastTime = new Date(Date.now() - 120_000);
  fs.utimesSync(lockPath, pastTime, pastTime);
}

describe('json-lock', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  // ======================================================================
  // getLockPath
  // ======================================================================

  describe('getLockPath', () => {
    it('appends .lock to the file path', () => {
      expect(getLockPath('/foo/bar.json')).toBe('/foo/bar.json.lock');
    });

    it('works with paths that already have extensions', () => {
      expect(getLockPath('/a/b.txt')).toBe('/a/b.txt.lock');
    });
  });

  // ======================================================================
  // acquireLock — acquire / release cycle
  // ======================================================================

  describe('acquireLock', () => {
    it('creates a lock file and release removes it', async () => {
      const filePath = path.join(TEST_DIR, 'basic.json');
      const lockPath = getLockPath(filePath);

      const release = await acquireLock(filePath);
      expect(fs.existsSync(lockPath)).toBe(true);

      // Lock file content should be valid JSON with expected fields
      const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(lockContent.pid).toBe(process.pid);
      expect(lockContent.hostname).toBe(os.hostname());
      expect(typeof lockContent.lockId).toBe('string');
      expect(typeof lockContent.sessionId).toBe('string');
      expect(typeof lockContent.timestamp).toBe('string');
      expect(lockContent.filePath).toBe(filePath);

      release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('release is idempotent — calling twice does not throw', async () => {
      const filePath = path.join(TEST_DIR, 'idem.json');

      const release = await acquireLock(filePath);
      release();
      // Second call should not throw (lock file already gone)
      expect(() => release()).not.toThrow();
    });

    it('second acquirer waits until first releases', async () => {
      const filePath = path.join(TEST_DIR, 'contention.json');
      const order: string[] = [];

      const release1 = await acquireLock(filePath);
      order.push('lock1-acquired');

      // Start second lock attempt — it will poll
      const lock2Promise = acquireLock(filePath, { timeout: 2000, retryInterval: 10 }).then((release) => {
        order.push('lock2-acquired');
        return release;
      });

      // Give lock2 time to start polling
      await new Promise((r) => setTimeout(r, 60));

      // Release first lock
      release1();
      order.push('lock1-released');

      const release2 = await lock2Promise;
      release2();
      order.push('lock2-released');

      expect(order).toEqual(['lock1-acquired', 'lock1-released', 'lock2-acquired', 'lock2-released']);
    });

    it('times out when lock cannot be acquired', async () => {
      const filePath = path.join(TEST_DIR, 'timeout.json');

      const release = await acquireLock(filePath);

      await expect(acquireLock(filePath, { timeout: 80, retryInterval: 10 })).rejects.toThrow(/Failed to acquire lock/);

      release();
    });

    it('timeout error message includes file path and lock path', async () => {
      const filePath = path.join(TEST_DIR, 'err-msg.json');

      const release = await acquireLock(filePath);

      try {
        await acquireLock(filePath, { timeout: 50, retryInterval: 10 });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        const msg = (error as Error).message;
        expect(msg).toContain(filePath);
        expect(msg).toContain('Lock file:');
      } finally {
        release();
      }
    });
  });

  // ======================================================================
  // acquireLockSync
  // ======================================================================

  describe('acquireLockSync', () => {
    it('creates lock file and release removes it', () => {
      const filePath = path.join(TEST_DIR, 'sync.json');
      const lockPath = getLockPath(filePath);

      const release = acquireLockSync(filePath);
      expect(fs.existsSync(lockPath)).toBe(true);

      release();
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('times out when lock is already held', () => {
      const filePath = path.join(TEST_DIR, 'sync-timeout.json');

      const release = acquireLockSync(filePath);

      expect(() => acquireLockSync(filePath, { timeout: 80, retryInterval: 10 })).toThrow(/Failed to acquire lock/);

      release();
    });
  });

  // ======================================================================
  // Stale lock detection & recovery
  // ======================================================================

  describe('stale lock detection', () => {
    it('breaks lock older than staleTTL with unrecognized/dead PID', async () => {
      const filePath = path.join(TEST_DIR, 'stale-dead.json');
      const lockPath = getLockPath(filePath);

      writeStaleLock(lockPath, { pid: 999999999 });

      const release = await acquireLock(filePath, { staleLockTTL: 500, timeout: 2000 });

      // Verify our process now owns the lock
      const lockContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      expect(lockContent.pid).toBe(process.pid);

      release();
    });

    it('breaks corrupt lock file (invalid JSON)', async () => {
      const filePath = path.join(TEST_DIR, 'stale-corrupt.json');
      const lockPath = getLockPath(filePath);

      // Write garbage as lock content
      fs.writeFileSync(lockPath, 'NOT-VALID-JSON!!!');
      const pastTime = new Date(Date.now() - 120_000);
      fs.utimesSync(lockPath, pastTime, pastTime);

      const release = await acquireLock(filePath, { staleLockTTL: 500, timeout: 2000 });
      expect(fs.existsSync(lockPath)).toBe(true);
      release();
    });

    it('breaks lock from different hostname (cross-host TTL policy)', async () => {
      const filePath = path.join(TEST_DIR, 'stale-crosshost.json');
      const lockPath = getLockPath(filePath);

      writeStaleLock(lockPath, {
        pid: process.pid, // Same PID but different host
        hostname: 'remote-host-that-does-not-exist',
      });

      const release = await acquireLock(filePath, { staleLockTTL: 500, timeout: 2000 });
      expect(fs.existsSync(lockPath)).toBe(true);
      release();
    });

    it('does NOT break lock held by alive process with different session', async () => {
      const filePath = path.join(TEST_DIR, 'alive-foreign.json');
      const lockPath = getLockPath(filePath);

      // Current process PID is alive, different session → NOT stale
      writeStaleLock(lockPath, {
        pid: process.pid,
        sessionId: 'foreign-session-id',
        hostname: os.hostname(),
      });

      await expect(acquireLock(filePath, { staleLockTTL: 500, timeout: 100, retryInterval: 10 })).rejects.toThrow(
        /Failed to acquire lock/,
      );
    });

    it('does NOT break lock that is younger than staleTTL', async () => {
      const filePath = path.join(TEST_DIR, 'fresh-lock.json');
      const lockPath = getLockPath(filePath);

      // Write a lock but do NOT age it — mtime is now
      const content = {
        pid: 999999999,
        timestamp: new Date().toISOString(),
        filePath,
        sessionId: 'fresh-session',
        hostname: os.hostname(),
        lockId: 'fresh-lock-id',
      };
      fs.writeFileSync(lockPath, JSON.stringify(content));
      // No utimesSync — mtime is current

      await expect(acquireLock(filePath, { staleLockTTL: 60_000, timeout: 100, retryInterval: 10 })).rejects.toThrow(
        /Failed to acquire lock/,
      );
    });

    it('sync: breaks stale lock and acquires', () => {
      const filePath = path.join(TEST_DIR, 'stale-sync.json');
      const lockPath = getLockPath(filePath);

      writeStaleLock(lockPath, { pid: 999999999 });

      const release = acquireLockSync(filePath, { staleLockTTL: 500, timeout: 2000 });
      expect(fs.existsSync(lockPath)).toBe(true);
      release();
    });
  });

  // ======================================================================
  // writeAtomic
  // ======================================================================

  describe('writeAtomic', () => {
    it('writes content to file via temp+rename', () => {
      const filePath = path.join(TEST_DIR, 'atomic.txt');

      writeAtomic(filePath, 'hello atomic');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello atomic');
    });

    it('creates parent directories as needed', () => {
      const filePath = path.join(TEST_DIR, 'deep', 'nested', 'dir', 'file.txt');

      writeAtomic(filePath, 'deep content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep content');
    });

    it('overwrites existing file atomically', () => {
      const filePath = path.join(TEST_DIR, 'overwrite.txt');
      fs.writeFileSync(filePath, 'old');

      writeAtomic(filePath, 'new');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new');
    });

    it('cleans up temp file on write failure', () => {
      const readonlyDir = path.join(TEST_DIR, 'readonly');
      fs.mkdirSync(readonlyDir);
      fs.chmodSync(readonlyDir, 0o444);

      const filePath = path.join(readonlyDir, 'fail.txt');

      try {
        expect(() => writeAtomic(filePath, 'should fail')).toThrow();
      } finally {
        fs.chmodSync(readonlyDir, 0o755);
      }

      // No temp files should remain
      const files = fs.readdirSync(readonlyDir);
      expect(files.filter((f) => f.includes('.tmp.'))).toHaveLength(0);
    });
  });

  // ======================================================================
  // writeJsonAtomic
  // ======================================================================

  describe('writeJsonAtomic', () => {
    it('writes formatted JSON', () => {
      const filePath = path.join(TEST_DIR, 'data.json');

      writeJsonAtomic(filePath, { key: 'value', num: 42 });

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual({ key: 'value', num: 42 });
      // Should be formatted with 2-space indent
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });

    it('handles arrays', () => {
      const filePath = path.join(TEST_DIR, 'arr.json');

      writeJsonAtomic(filePath, [1, 2, 3]);

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual([1, 2, 3]);
    });

    it('handles null', () => {
      const filePath = path.join(TEST_DIR, 'null.json');

      writeJsonAtomic(filePath, null);

      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toBeNull();
    });
  });

  // ======================================================================
  // writeJsonLocked / writeJsonLockedSync
  // ======================================================================

  describe('writeJsonLocked', () => {
    it('writes JSON and releases lock', async () => {
      const filePath = path.join(TEST_DIR, 'locked-write.json');

      await writeJsonLocked(filePath, { x: 1 });

      expect(readJson<{ x: number }>(filePath)).toEqual({ x: 1 });
      // Lock should be released
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });

    it('releases lock even when writeJsonAtomic throws', async () => {
      // Use a path where the parent dir is read-only to force write failure
      const readonlyDir = path.join(TEST_DIR, 'ro-locked');
      fs.mkdirSync(readonlyDir);

      const filePath = path.join(readonlyDir, 'sub', 'fail.json');

      // First make the directory structure so acquireLock works,
      // then make it read-only so writeJsonAtomic fails on the temp file
      fs.mkdirSync(path.join(readonlyDir, 'sub'), { recursive: true });
      fs.chmodSync(path.join(readonlyDir, 'sub'), 0o444);

      try {
        await expect(writeJsonLocked(filePath, { fail: true })).rejects.toThrow();
      } finally {
        fs.chmodSync(path.join(readonlyDir, 'sub'), 0o755);
      }

      // Lock file should be cleaned up (it's at filePath.lock, not in the subdir)
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });

    it('serializes concurrent writes', async () => {
      const filePath = path.join(TEST_DIR, 'concurrent.json');

      // Launch 5 concurrent writes
      const promises = [1, 2, 3, 4, 5].map((n) => writeJsonLocked(filePath, { value: n }));

      await Promise.all(promises);

      // File should have valid JSON (last writer wins)
      const result = readJson<{ value: number }>(filePath);
      expect(result?.value).toBeGreaterThanOrEqual(1);
      expect(result?.value).toBeLessThanOrEqual(5);

      // Lock should be released
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });
  });

  describe('writeJsonLockedSync', () => {
    it('writes JSON synchronously and releases lock', () => {
      const filePath = path.join(TEST_DIR, 'locked-sync.json');

      writeJsonLockedSync(filePath, { sync: true });

      expect(readJson<{ sync: boolean }>(filePath)).toEqual({ sync: true });
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });
  });

  // ======================================================================
  // deepMerge
  // ======================================================================

  describe('deepMerge', () => {
    it('merges top-level fields', () => {
      const target: Record<string, unknown> = { a: 1, b: 2 };
      const patch: Record<string, unknown> = { b: 3, c: 4 };
      const result = deepMerge(target, patch);
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('deep merges nested objects', () => {
      const target = { outer: { inner1: 'a', inner2: 'b' }, other: 'x' };
      const patch = { outer: { inner2: 'c', inner3: 'd' } };

      const result = deepMerge(target as Record<string, unknown>, patch as Record<string, unknown>);

      expect(result).toEqual({
        outer: { inner1: 'a', inner2: 'c', inner3: 'd' },
        other: 'x',
      });
    });

    it('deep merges three levels', () => {
      const target = { l1: { l2: { l3: { keep: true, update: 'old' } } } };
      const patch = { l1: { l2: { l3: { update: 'new', add: true } } } };

      const result = deepMerge(target as Record<string, unknown>, patch as Record<string, unknown>);

      expect(result).toEqual({
        l1: { l2: { l3: { keep: true, update: 'new', add: true } } },
      });
    });

    it('replaces arrays rather than merging them', () => {
      const result = deepMerge(
        { arr: [1, 2, 3] } as Record<string, unknown>,
        { arr: [4, 5] } as Record<string, unknown>,
      );
      expect(result).toEqual({ arr: [4, 5] });
    });

    it('skips undefined values in patch', () => {
      const result = deepMerge(
        { a: 1, b: 2 } as Record<string, unknown>,
        { a: undefined, c: 3 } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('allows null to overwrite existing values', () => {
      const result = deepMerge(
        { a: { nested: true } } as Record<string, unknown>,
        { a: null } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: null });
    });

    it('primitive in patch overwrites object in target', () => {
      const result = deepMerge(
        { a: { nested: true } } as Record<string, unknown>,
        { a: 42 } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: 42 });
    });

    it('object in patch overwrites primitive in target', () => {
      const result = deepMerge(
        { a: 'string' } as Record<string, unknown>,
        { a: { nested: true } } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: { nested: true } });
    });

    it('handles empty patch', () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, {});
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('handles empty target', () => {
      const result = deepMerge({} as Record<string, unknown>, { a: 1 });
      expect(result).toEqual({ a: 1 });
    });

    it('does not mutate target or patch', () => {
      const target = { a: 1, nested: { x: 10 } };
      const patch = { nested: { y: 20 } };
      const targetCopy = JSON.parse(JSON.stringify(target));
      const patchCopy = JSON.parse(JSON.stringify(patch));

      deepMerge(target as Record<string, unknown>, patch as Record<string, unknown>);

      expect(target).toEqual(targetCopy);
      expect(patch).toEqual(patchCopy);
    });

    it('array in target replaced by object in patch', () => {
      const result = deepMerge(
        { a: [1, 2] } as Record<string, unknown>,
        { a: { key: 'val' } } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: { key: 'val' } });
    });

    it('object in target replaced by array in patch', () => {
      const result = deepMerge(
        { a: { key: 'val' } } as Record<string, unknown>,
        { a: [1, 2] } as Record<string, unknown>,
      );
      expect(result).toEqual({ a: [1, 2] });
    });
  });

  // ======================================================================
  // patchJsonLocked / patchJsonLockedSync
  // ======================================================================

  describe('patchJsonLocked', () => {
    it('patches an existing JSON file', async () => {
      const filePath = path.join(TEST_DIR, 'patch.json');
      fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: 2 }));

      const result = await patchJsonLocked<Record<string, number>>(filePath, { b: 3, c: 4 });

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
      expect(readJson(filePath)).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('creates file from empty when it does not exist', async () => {
      const filePath = path.join(TEST_DIR, 'new-patch.json');

      const result = await patchJsonLocked<{ x: number }>(filePath, { x: 1 });

      expect(result).toEqual({ x: 1 });
      expect(readJson(filePath)).toEqual({ x: 1 });
    });

    it('deep merges nested objects', async () => {
      const filePath = path.join(TEST_DIR, 'nested-patch.json');
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          status: 'pending',
          meta: { sessionId: 'abc', attempt: 1 },
        }),
      );

      await patchJsonLocked(filePath, {
        meta: { lastPing: '2025-01-01' },
      });

      const result = readJson<Record<string, unknown>>(filePath);
      expect(result).toEqual({
        status: 'pending',
        meta: { sessionId: 'abc', attempt: 1, lastPing: '2025-01-01' },
      });
    });

    it('releases lock after patching', async () => {
      const filePath = path.join(TEST_DIR, 'patch-lock.json');
      fs.writeFileSync(filePath, JSON.stringify({ a: 1 }));

      await patchJsonLocked(filePath, { b: 2 });

      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });
  });

  describe('patchJsonLockedSync', () => {
    it('patches file synchronously and returns merged result', () => {
      const filePath = path.join(TEST_DIR, 'patch-sync.json');
      fs.writeFileSync(filePath, JSON.stringify({ x: 1 }));

      const result = patchJsonLockedSync<{ x: number; y?: number }>(filePath, { y: 2 });

      expect(result).toEqual({ x: 1, y: 2 });
      expect(readJson(filePath)).toEqual({ x: 1, y: 2 });
    });

    it('creates file from empty when it does not exist', () => {
      const filePath = path.join(TEST_DIR, 'patch-sync-new.json');

      const result = patchJsonLockedSync<{ a: number }>(filePath, { a: 99 });

      expect(result).toEqual({ a: 99 });
    });
  });

  // ======================================================================
  // updateJsonLockedSync
  // ======================================================================

  describe('updateJsonLockedSync', () => {
    it('applies updater to existing file content', () => {
      const filePath = path.join(TEST_DIR, 'update.json');
      fs.writeFileSync(filePath, JSON.stringify({ count: 5 }));

      const result = updateJsonLockedSync<{ count: number }>(filePath, (current) => ({ count: current.count + 1 }), {
        count: 0,
      });

      expect(result).toEqual({ count: 6 });
      expect(readJson(filePath)).toEqual({ count: 6 });
    });

    it('uses fallback when file does not exist', () => {
      const filePath = path.join(TEST_DIR, 'update-new.json');

      const result = updateJsonLockedSync<{ items: string[] }>(
        filePath,
        (current) => ({ items: [...current.items, 'first'] }),
        { items: [] },
      );

      expect(result).toEqual({ items: ['first'] });
      expect(readJson(filePath)).toEqual({ items: ['first'] });
    });

    it('releases lock after update', () => {
      const filePath = path.join(TEST_DIR, 'update-lock.json');

      updateJsonLockedSync(filePath, () => ({ done: true }), { done: false });

      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });

    it('releases lock even when updater throws', () => {
      const filePath = path.join(TEST_DIR, 'update-throw.json');
      fs.writeFileSync(filePath, JSON.stringify({ ok: true }));

      expect(() =>
        updateJsonLockedSync(
          filePath,
          () => {
            throw new Error('updater failed');
          },
          { ok: false },
        ),
      ).toThrow('updater failed');

      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });

    it('multiple sequential updates accumulate correctly', () => {
      const filePath = path.join(TEST_DIR, 'update-seq.json');

      for (let i = 0; i < 5; i++) {
        updateJsonLockedSync<{ count: number }>(filePath, (current) => ({ count: current.count + 1 }), { count: 0 });
      }

      expect(readJson<{ count: number }>(filePath)).toEqual({ count: 5 });
    });
  });

  // ======================================================================
  // releaseLockIfOwned (tested indirectly via ownership checks)
  // ======================================================================

  describe('lock ownership', () => {
    it('release only removes lock if lockId matches', async () => {
      const filePath = path.join(TEST_DIR, 'ownership.json');
      const lockPath = getLockPath(filePath);

      const release = await acquireLock(filePath);

      // Overwrite the lock file with different lockId (simulating another process)
      const foreignLock = {
        pid: process.pid,
        timestamp: new Date().toISOString(),
        filePath,
        sessionId: 'foreign',
        hostname: os.hostname(),
        lockId: 'foreign-lock-id',
      };
      fs.writeFileSync(lockPath, JSON.stringify(foreignLock));

      // Release should detect lockId mismatch and NOT delete
      release();
      expect(fs.existsSync(lockPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(lockPath);
    });
  });
});
