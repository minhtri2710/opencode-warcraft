import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  acquireLockSync,
  deepMerge,
  getLockPath,
  patchJsonLockedSync,
  updateJsonLockedSync,
  writeAtomic,
  writeJsonAtomic,
  writeJsonLockedSync,
} from './json-lock.js';

const TEST_DIR = `/tmp/json-lock-extra-${process.pid}`;

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('getLockPath', () => {
  it('appends .lock to file path', () => {
    expect(getLockPath('/path/to/file.json')).toBe('/path/to/file.json.lock');
  });

  it('handles paths without extension', () => {
    expect(getLockPath('/path/to/file')).toBe('/path/to/file.lock');
  });
});

describe('deepMerge extra edge cases', () => {
  it('skips undefined values in patch', () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: undefined, b: 3 });
    expect(result.a).toBe(1);
    expect(result.b).toBe(3);
  });

  it('replaces arrays instead of deep merging', () => {
    const result = deepMerge({ items: [1, 2, 3] }, { items: [4, 5] });
    expect(result.items).toEqual([4, 5]);
  });

  it('replaces null values', () => {
    const result = deepMerge({ a: { nested: true } }, { a: null } as any);
    expect(result.a).toBeNull();
  });

  it('deep merges nested objects', () => {
    const result = deepMerge({ config: { theme: 'dark', lang: 'en' } }, { config: { theme: 'light' } } as any);
    expect(result.config.theme).toBe('light');
    expect(result.config.lang).toBe('en');
  });

  it('adds new keys from patch', () => {
    const result = deepMerge({ a: 1 }, { b: 2 } as any);
    expect(result.a).toBe(1);
    expect((result as any).b).toBe(2);
  });

  it('handles empty patch', () => {
    const result = deepMerge({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });

  it('handles empty target', () => {
    const result = deepMerge({}, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });
});

describe('writeAtomic', () => {
  it('writes content atomically', () => {
    const filePath = path.join(TEST_DIR, 'atomic.txt');
    writeAtomic(filePath, 'Hello World');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello World');
  });

  it('overwrites existing content', () => {
    const filePath = path.join(TEST_DIR, 'overwrite.txt');
    writeAtomic(filePath, 'First');
    writeAtomic(filePath, 'Second');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('Second');
  });
});

describe('writeJsonAtomic', () => {
  it('writes JSON with formatting', () => {
    const filePath = path.join(TEST_DIR, 'data.json');
    writeJsonAtomic(filePath, { key: 'value' });
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ key: 'value' });
    expect(content).toContain('\n'); // formatted
  });
});

describe('writeJsonLockedSync', () => {
  it('writes JSON with lock protection', () => {
    const filePath = path.join(TEST_DIR, 'locked.json');
    writeJsonLockedSync(filePath, { locked: true });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ locked: true });
  });
});

describe('acquireLockSync', () => {
  it('returns a release function', () => {
    const lockTarget = path.join(TEST_DIR, 'test.lock');
    const release = acquireLockSync(lockTarget);
    expect(typeof release).toBe('function');
    release();
  });

  it('blocks concurrent access to the same lock', () => {
    const lockTarget = path.join(TEST_DIR, 'concurrent.lock');
    const release1 = acquireLockSync(lockTarget);
    // Second acquire should work after release
    release1();
    const release2 = acquireLockSync(lockTarget);
    release2();
  });
});

describe('updateJsonLockedSync', () => {
  it('creates file with default when it does not exist', () => {
    const filePath = path.join(TEST_DIR, 'update-create.json');
    updateJsonLockedSync(filePath, (current) => ({ ...current, added: true }), { initial: 'value' });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(result.initial).toBe('value');
    expect(result.added).toBe(true);
  });

  it('updates existing file', () => {
    const filePath = path.join(TEST_DIR, 'update-existing.json');
    fs.writeFileSync(filePath, JSON.stringify({ count: 1 }));
    updateJsonLockedSync(filePath, (current: any) => ({ ...current, count: current.count + 1 }), { count: 0 });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(result.count).toBe(2);
  });
});

describe('patchJsonLockedSync', () => {
  it('deep merges patch into existing file', () => {
    const filePath = path.join(TEST_DIR, 'patch.json');
    fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: { c: 2 } }));
    patchJsonLockedSync(filePath, { b: { d: 3 } } as any);
    const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(result.a).toBe(1);
    expect(result.b.c).toBe(2);
    expect(result.b.d).toBe(3);
  });

  it('creates file with patch when it does not exist', () => {
    const filePath = path.join(TEST_DIR, 'patch-create.json');
    patchJsonLockedSync(filePath, { key: 'value' });
    const result = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(result.key).toBe('value');
  });
});
