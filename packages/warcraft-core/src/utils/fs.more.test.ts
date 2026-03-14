import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureDir, fileExists, readJson, readText, writeJson, writeText } from './fs.js';

describe('fs utilities more edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-more-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('ensureDir creates nested directories', () => {
    const deep = path.join(tempDir, 'a', 'b', 'c');
    ensureDir(deep);
    expect(fs.existsSync(deep)).toBe(true);
  });

  it('ensureDir is idempotent', () => {
    const dir = path.join(tempDir, 'x');
    ensureDir(dir);
    ensureDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('fileExists returns true for existing file', () => {
    const file = path.join(tempDir, 'exists.txt');
    fs.writeFileSync(file, 'data');
    expect(fileExists(file)).toBe(true);
  });

  it('fileExists returns false for non-existent file', () => {
    expect(fileExists(path.join(tempDir, 'nope.txt'))).toBe(false);
  });

  it('fileExists returns true for directory', () => {
    expect(fileExists(tempDir)).toBe(true);
  });

  it('writeJson then readJson round-trips', () => {
    const file = path.join(tempDir, 'data.json');
    writeJson(file, { key: 'value', num: 42 });
    const read = readJson<{ key: string; num: number }>(file);
    expect(read?.key).toBe('value');
    expect(read?.num).toBe(42);
  });

  it('readJson returns null for non-existent file', () => {
    expect(readJson(path.join(tempDir, 'missing.json'))).toBeNull();
  });

  it('readJson throws SyntaxError for invalid JSON', () => {
    const file = path.join(tempDir, 'bad.json');
    fs.writeFileSync(file, 'not json');
    expect(() => readJson(file)).toThrow(SyntaxError);
  });

  it('writeText then readText round-trips', () => {
    const file = path.join(tempDir, 'text.md');
    writeText(file, '# Hello\n\nWorld');
    expect(readText(file)).toBe('# Hello\n\nWorld');
  });

  it('readText returns null for non-existent file', () => {
    expect(readText(path.join(tempDir, 'missing.txt'))).toBeNull();
  });

  it('writeJson creates parent directories', () => {
    const file = path.join(tempDir, 'deep', 'nested', 'data.json');
    writeJson(file, { created: true });
    expect(readJson<{ created: boolean }>(file)?.created).toBe(true);
  });

  it('writeText creates parent directories', () => {
    const file = path.join(tempDir, 'deep', 'nested', 'text.txt');
    writeText(file, 'content');
    expect(readText(file)).toBe('content');
  });

  it('writeJson overwrites existing file', () => {
    const file = path.join(tempDir, 'overwrite.json');
    writeJson(file, { v: 1 });
    writeJson(file, { v: 2 });
    expect(readJson<{ v: number }>(file)?.v).toBe(2);
  });
});
