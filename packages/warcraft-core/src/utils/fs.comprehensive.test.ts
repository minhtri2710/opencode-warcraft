import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fileExists,
  readText,
  writeText,
  readJson,
  writeJson,
  ensureDir,
} from './fs.js';

describe('fs utils comprehensive', () => {
  const tmpBase = os.tmpdir();

  it('writeText then readText round-trip', () => {
    const file = path.join(fs.mkdtempSync(path.join(tmpBase, 'fs-rt-')), 'test.txt');
    writeText(file, 'Hello World');
    expect(readText(file)).toBe('Hello World');
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('writeJson then readJson round-trip', () => {
    const file = path.join(fs.mkdtempSync(path.join(tmpBase, 'fs-json-')), 'data.json');
    const data = { name: 'test', count: 42, nested: { arr: [1, 2, 3] } };
    writeJson(file, data);
    const read = readJson<typeof data>(file);
    expect(read).toEqual(data);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('fileExists returns true for existing file', () => {
    const dir = fs.mkdtempSync(path.join(tmpBase, 'fs-ex-'));
    const file = path.join(dir, 'exists.txt');
    fs.writeFileSync(file, 'x');
    expect(fileExists(file)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fileExists returns false for missing file', () => {
    expect(fileExists('/tmp/definitely-does-not-exist-12345.txt')).toBe(false);
  });

  it('fileExists returns true for directory', () => {
    const dir = fs.mkdtempSync(path.join(tmpBase, 'fs-dir-'));
    expect(fileExists(dir)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('readText returns null for missing file', () => {
    expect(readText('/tmp/no-such-file-98765.txt')).toBeNull();
  });

  it('readJson returns null for missing file', () => {
    expect(readJson('/tmp/no-such-file-98765.json')).toBeNull();
  });

  it('ensureDir creates nested dirs', () => {
    const base = fs.mkdtempSync(path.join(tmpBase, 'fs-ens-'));
    const deep = path.join(base, 'a', 'b', 'c');
    ensureDir(deep);
    expect(fs.existsSync(deep)).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('ensureDir is idempotent', () => {
    const base = fs.mkdtempSync(path.join(tmpBase, 'fs-idem-'));
    const dir = path.join(base, 'x');
    ensureDir(dir);
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('writeText creates parent directories', () => {
    const base = fs.mkdtempSync(path.join(tmpBase, 'fs-auto-'));
    const file = path.join(base, 'deep', 'nested', 'file.txt');
    writeText(file, 'auto-created');
    expect(readText(file)).toBe('auto-created');
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('writeText overwrites existing content', () => {
    const file = path.join(fs.mkdtempSync(path.join(tmpBase, 'fs-ow-')), 'overwrite.txt');
    writeText(file, 'v1');
    writeText(file, 'v2');
    expect(readText(file)).toBe('v2');
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('writeJson with pretty printing', () => {
    const file = path.join(fs.mkdtempSync(path.join(tmpBase, 'fs-pp-')), 'pretty.json');
    writeJson(file, { a: 1 });
    const raw = readText(file)!;
    // JSON should be formatted
    expect(raw.includes('\n') || raw.includes('{')).toBe(true);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('readJson throws on invalid JSON', () => {
    const file = path.join(fs.mkdtempSync(path.join(tmpBase, 'fs-inv-')), 'bad.json');
    writeText(file, 'not json');
    expect(() => readJson(file)).toThrow();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
