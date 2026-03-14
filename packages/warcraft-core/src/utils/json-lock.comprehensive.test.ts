import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, acquireLockSync } from './json-lock.js';

describe('json-lock comprehensive', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-comp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('acquireLock', () => {
    it('acquires and releases lock', async () => {
      const lockPath = path.join(tempDir, 'test.lock');
      const release = await acquireLock(lockPath);
      expect(typeof release).toBe('function');
      release();
    });

    it('lock file created during lock', async () => {
      const lockPath = path.join(tempDir, 'visible.lock');
      const release = await acquireLock(lockPath);
      // Lock file should exist
      expect(fs.existsSync(lockPath) || fs.existsSync(`${lockPath}.lock`)).toBe(true);
      release();
    });

    it('sequential locks work', async () => {
      const lockPath = path.join(tempDir, 'seq.lock');
      const r1 = await acquireLock(lockPath);
      r1();
      const r2 = await acquireLock(lockPath);
      r2();
      const r3 = await acquireLock(lockPath);
      r3();
    });

    it('timeout option accepted', async () => {
      const lockPath = path.join(tempDir, 'timeout.lock');
      const release = await acquireLock(lockPath, { timeout: 5000 });
      release();
    });
  });

  describe('acquireLockSync', () => {
    it('acquires and releases', () => {
      const lockPath = path.join(tempDir, 'sync.lock');
      const release = acquireLockSync(lockPath);
      expect(typeof release).toBe('function');
      release();
    });

    it('sequential sync locks work', () => {
      const lockPath = path.join(tempDir, 'sync-seq.lock');
      acquireLockSync(lockPath)();
      acquireLockSync(lockPath)();
      acquireLockSync(lockPath)();
    });

    it('timeout option accepted', () => {
      const lockPath = path.join(tempDir, 'sync-timeout.lock');
      const release = acquireLockSync(lockPath, { timeout: 5000 });
      release();
    });
  });

  describe('concurrent safety', () => {
    it('protects shared counter', async () => {
      const lockPath = path.join(tempDir, 'counter.lock');
      const counterPath = path.join(tempDir, 'counter.txt');
      fs.writeFileSync(counterPath, '0');

      const increment = async () => {
        const release = await acquireLock(lockPath);
        try {
          const val = parseInt(fs.readFileSync(counterPath, 'utf-8'), 10);
          fs.writeFileSync(counterPath, String(val + 1));
        } finally {
          release();
        }
      };

      await Promise.all(Array.from({ length: 10 }, () => increment()));
      const final = parseInt(fs.readFileSync(counterPath, 'utf-8'), 10);
      expect(final).toBe(10);
    });
  });
});
