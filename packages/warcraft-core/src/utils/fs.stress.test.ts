import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureDir, fileExists, readJson, writeJson, readText, writeText } from './fs.js';

describe('fs utilities stress', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-stress-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writeJson handles special chars in values', () => {
    const file = path.join(tempDir, 'special.json');
    writeJson(file, { key: 'value with "quotes" and \n newlines' });
    const read = readJson<{ key: string }>(file);
    expect(read?.key).toContain('quotes');
  });

  it('writeJson handles unicode', () => {
    const file = path.join(tempDir, 'unicode.json');
    writeJson(file, { emoji: '🎉', japanese: '日本語' });
    const read = readJson<{ emoji: string; japanese: string }>(file);
    expect(read?.emoji).toBe('🎉');
    expect(read?.japanese).toBe('日本語');
  });

  it('writeJson handles large arrays', () => {
    const file = path.join(tempDir, 'large.json');
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    writeJson(file, arr);
    const read = readJson<number[]>(file);
    expect(read).toHaveLength(1000);
  });

  it('writeText with empty string', () => {
    const file = path.join(tempDir, 'empty.txt');
    writeText(file, '');
    expect(readText(file)).toBe('');
  });

  it('writeText with very long content', () => {
    const file = path.join(tempDir, 'long.txt');
    const content = 'x'.repeat(100000);
    writeText(file, content);
    expect(readText(file)).toHaveLength(100000);
  });

  it('ensureDir deeply nested', () => {
    const deep = path.join(tempDir, 'a', 'b', 'c', 'd', 'e', 'f');
    ensureDir(deep);
    expect(fs.existsSync(deep)).toBe(true);
  });

  it('fileExists distinguishes file from directory', () => {
    const dir = path.join(tempDir, 'mydir');
    fs.mkdirSync(dir);
    const file = path.join(tempDir, 'myfile.txt');
    fs.writeFileSync(file, 'data');
    expect(fileExists(dir)).toBe(true);
    expect(fileExists(file)).toBe(true);
  });

  it('readJson handles nested arrays and objects', () => {
    const file = path.join(tempDir, 'complex.json');
    const data = { a: [{ b: [1, 2] }, { c: { d: true } }] };
    writeJson(file, data);
    const read = readJson<typeof data>(file);
    expect(read?.a[0].b).toEqual([1, 2]);
    expect(read?.a[1].c?.d).toBe(true);
  });
});
