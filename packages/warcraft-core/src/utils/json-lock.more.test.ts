import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, patchJsonLockedSync, writeJsonLockedSync } from './json-lock.js';

describe('json-lock more scenarios', () => {
  let tempDir: string;

  function setup(): string {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-lock-more-'));
    return tempDir;
  }

  function cleanup(): void {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  it('writeJsonLockedSync creates file and writes JSON', () => {
    setup();
    const file = path.join(tempDir, 'data.json');
    writeJsonLockedSync(file, { key: 'value' });
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.key).toBe('value');
    cleanup();
  });

  it('writeJsonLockedSync overwrites existing file', () => {
    setup();
    const file = path.join(tempDir, 'overwrite.json');
    writeJsonLockedSync(file, { v: 1 });
    writeJsonLockedSync(file, { v: 2 });
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.v).toBe(2);
    cleanup();
  });

  it('patchJsonLockedSync merges into existing', () => {
    setup();
    const file = path.join(tempDir, 'patch.json');
    writeJsonLockedSync(file, { a: 1, b: 2 });
    const result = patchJsonLockedSync(file, { b: 3, c: 4 });
    expect(result.a).toBe(1);
    expect(result.b).toBe(3);
    expect(result.c).toBe(4);
    cleanup();
  });

  it('acquireLock returns a release function', async () => {
    setup();
    const lockPath = path.join(tempDir, 'test.lock');
    const release = await acquireLock(lockPath);
    expect(typeof release).toBe('function');
    release();
    cleanup();
  });

  it('acquireLock lock and release work', async () => {
    setup();
    const lockPath = path.join(tempDir, 'exists.lock');
    const release = await acquireLock(lockPath);
    // Lock is held - just verify release works
    release();
    cleanup();
  });

  it('acquireLock release removes lock file', async () => {
    setup();
    const lockPath = path.join(tempDir, 'removed.lock');
    const release = await acquireLock(lockPath);
    release();
    expect(fs.existsSync(lockPath)).toBe(false);
    cleanup();
  });

  it('writeJsonLockedSync with complex nested object', () => {
    setup();
    const file = path.join(tempDir, 'nested.json');
    const data = { a: { b: { c: [1, 2, 3] } }, d: 'str' };
    writeJsonLockedSync(file, data);
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.a.b.c).toEqual([1, 2, 3]);
    cleanup();
  });
});
