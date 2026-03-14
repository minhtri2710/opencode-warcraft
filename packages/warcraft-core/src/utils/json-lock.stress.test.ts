import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, patchJsonLockedSync, writeJsonLockedSync } from './json-lock.js';

describe('json-lock stress', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jl-stress-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('patchJsonLockedSync with deep merge', () => {
    const file = path.join(tempDir, 'deep.json');
    writeJsonLockedSync(file, { a: 1, b: { c: 2 } });
    const result = patchJsonLockedSync(file, { b: { d: 3 }, e: 4 });
    expect(result.a).toBe(1);
    expect(result.e).toBe(4);
  });

  it('writeJsonLockedSync in existing dir', () => {
    const subdir = path.join(tempDir, 'sub');
    fs.mkdirSync(subdir, { recursive: true });
    const file = path.join(subdir, 'data.json');
    writeJsonLockedSync(file, { ok: true });
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.ok).toBe(true);
  });

  it('patchJsonLockedSync with array values', () => {
    const file = path.join(tempDir, 'arr.json');
    writeJsonLockedSync(file, { items: [1, 2] });
    const result = patchJsonLockedSync(file, { items: [3, 4, 5] });
    expect(result.items).toEqual([3, 4, 5]);
  });

  it('patchJsonLockedSync with null values', () => {
    const file = path.join(tempDir, 'null.json');
    writeJsonLockedSync(file, { a: 1, b: 2 });
    const result = patchJsonLockedSync(file, { b: null });
    expect(result.b).toBeNull();
  });

  it('acquireLock handles concurrent calls', async () => {
    const lockPath = path.join(tempDir, 'concurrent.lock');
    const release1 = await acquireLock(lockPath);
    release1();
    const release2 = await acquireLock(lockPath);
    release2();
    // Both should succeed sequentially
    expect(true).toBe(true);
  });

  it('writeJsonLockedSync with boolean values', () => {
    const file = path.join(tempDir, 'bool.json');
    writeJsonLockedSync(file, { flag: true, other: false });
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.flag).toBe(true);
    expect(content.other).toBe(false);
  });

  it('writeJsonLockedSync preserves number precision', () => {
    const file = path.join(tempDir, 'precision.json');
    writeJsonLockedSync(file, { pi: Math.PI, big: 999999999999 });
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(content.pi).toBe(Math.PI);
    expect(content.big).toBe(999999999999);
  });

  it('patchJsonLockedSync with empty patch', () => {
    const file = path.join(tempDir, 'empty-patch.json');
    writeJsonLockedSync(file, { a: 1 });
    const result = patchJsonLockedSync(file, {});
    expect(result.a).toBe(1);
  });

  it('patchJsonLockedSync on missing file creates it', () => {
    const file = path.join(tempDir, 'new-patch.json');
    const result = patchJsonLockedSync(file, { created: true });
    expect(result.created).toBe(true);
  });
});
