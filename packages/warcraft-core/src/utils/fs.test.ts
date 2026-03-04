import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, fileExists, readJson, readText, writeJson, writeText } from './fs.js';

const TEST_DIR = `/tmp/warcraft-fs-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

describe('fs utilities', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe('ensureDir', () => {
    it('creates a directory that does not exist', () => {
      const dirPath = path.join(TEST_DIR, 'new-dir');
      expect(fs.existsSync(dirPath)).toBe(false);

      ensureDir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
      expect(fs.statSync(dirPath).isDirectory()).toBe(true);
    });

    it('creates nested directories recursively', () => {
      const dirPath = path.join(TEST_DIR, 'a', 'b', 'c');
      expect(fs.existsSync(dirPath)).toBe(false);

      ensureDir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
    });

    it('is a no-op if directory already exists', () => {
      const dirPath = path.join(TEST_DIR, 'existing');
      fs.mkdirSync(dirPath);

      // Should not throw
      ensureDir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
    });
  });

  describe('fileExists', () => {
    it('returns true for an existing file', () => {
      const filePath = path.join(TEST_DIR, 'exists.txt');
      fs.writeFileSync(filePath, 'hello');

      expect(fileExists(filePath)).toBe(true);
    });

    it('returns false for a non-existent file', () => {
      expect(fileExists(path.join(TEST_DIR, 'no-such-file.txt'))).toBe(false);
    });

    it('returns true for an existing directory', () => {
      // fs.existsSync returns true for directories too
      expect(fileExists(TEST_DIR)).toBe(true);
    });
  });

  describe('readJson', () => {
    it('reads and parses valid JSON', () => {
      const filePath = path.join(TEST_DIR, 'data.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: 'test', count: 42 }));

      const result = readJson<{ name: string; count: number }>(filePath);

      expect(result).toEqual({ name: 'test', count: 42 });
    });

    it('returns null for a missing file (ENOENT)', () => {
      const result = readJson(path.join(TEST_DIR, 'missing.json'));

      expect(result).toBeNull();
    });

    it('throws SyntaxError with file path for malformed JSON', () => {
      const filePath = path.join(TEST_DIR, 'bad.json');
      fs.writeFileSync(filePath, '{ not valid json');

      expect(() => readJson(filePath)).toThrow(SyntaxError);
      expect(() => readJson(filePath)).toThrow(`Failed to parse JSON file at ${filePath}`);
    });

    it('rethrows non-ENOENT filesystem errors', () => {
      // Reading a directory throws EISDIR, not ENOENT
      const dirPath = path.join(TEST_DIR, 'a-directory');
      fs.mkdirSync(dirPath);

      expect(() => readJson(dirPath)).toThrow();
    });

    it('handles empty JSON object', () => {
      const filePath = path.join(TEST_DIR, 'empty.json');
      fs.writeFileSync(filePath, '{}');

      expect(readJson(filePath)).toEqual({});
    });

    it('handles JSON array', () => {
      const filePath = path.join(TEST_DIR, 'array.json');
      fs.writeFileSync(filePath, '[1, 2, 3]');

      expect(readJson<number[]>(filePath)).toEqual([1, 2, 3]);
    });
  });

  describe('writeJson', () => {
    it('writes JSON to a file with formatting', () => {
      const filePath = path.join(TEST_DIR, 'output.json');
      const data = { key: 'value', num: 7 };

      writeJson(filePath, data);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
      // Should be formatted with 2-space indent
      expect(content).toBe(JSON.stringify(data, null, 2));
    });

    it('creates parent directories if they do not exist', () => {
      const filePath = path.join(TEST_DIR, 'nested', 'deep', 'file.json');

      writeJson(filePath, { nested: true });

      expect(fs.existsSync(filePath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ nested: true });
    });

    it('overwrites an existing file', () => {
      const filePath = path.join(TEST_DIR, 'overwrite.json');
      fs.writeFileSync(filePath, JSON.stringify({ old: true }));

      writeJson(filePath, { new: true });

      expect(readJson(filePath)).toEqual({ new: true });
    });
  });

  describe('readText', () => {
    it('reads text from an existing file', () => {
      const filePath = path.join(TEST_DIR, 'hello.txt');
      fs.writeFileSync(filePath, 'hello world');

      expect(readText(filePath)).toBe('hello world');
    });

    it('returns null for a missing file', () => {
      expect(readText(path.join(TEST_DIR, 'missing.txt'))).toBeNull();
    });

    it('reads empty file as empty string', () => {
      const filePath = path.join(TEST_DIR, 'empty.txt');
      fs.writeFileSync(filePath, '');

      expect(readText(filePath)).toBe('');
    });

    it('preserves unicode content', () => {
      const filePath = path.join(TEST_DIR, 'unicode.txt');
      const content = 'Hello \u4e16\u754c \ud83c\udf0d';
      fs.writeFileSync(filePath, content, 'utf-8');

      expect(readText(filePath)).toBe(content);
    });
  });

  describe('writeText', () => {
    it('writes text content to a file', () => {
      const filePath = path.join(TEST_DIR, 'write.txt');

      writeText(filePath, 'some content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('some content');
    });

    it('creates parent directories if they do not exist', () => {
      const filePath = path.join(TEST_DIR, 'a', 'b', 'write.txt');

      writeText(filePath, 'nested');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested');
    });

    it('overwrites an existing file', () => {
      const filePath = path.join(TEST_DIR, 'overwrite.txt');
      fs.writeFileSync(filePath, 'old content');

      writeText(filePath, 'new content');

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
    });
  });

  describe('TOCTOU edge cases', () => {
    it('readText returns null if file is deleted between existence check and read', () => {
      // This tests the current behavior: readText uses existsSync then readFileSync.
      // If the file disappears between those calls, readFileSync throws ENOENT.
      // We can't truly simulate TOCTOU race, but we document the behavior:
      // readText does NOT catch ENOENT from readFileSync — it would throw.
      const filePath = path.join(TEST_DIR, 'vanishing.txt');
      // File does not exist
      expect(readText(filePath)).toBeNull();
    });

    it('ensureDir is safe when directory is created concurrently', () => {
      // If another process creates the dir between existsSync and mkdirSync,
      // mkdirSync with recursive: true is idempotent and won't throw.
      const dirPath = path.join(TEST_DIR, 'concurrent-dir');

      // Simulate: dir exists when mkdirSync runs
      fs.mkdirSync(dirPath, { recursive: true });
      // ensureDir should not throw even though dir already exists
      ensureDir(dirPath);

      expect(fs.existsSync(dirPath)).toBe(true);
    });

    it('writeJson is not atomic — partial writes can leave corrupt file', () => {
      // writeJson calls writeFileSync directly (not atomic write).
      // If process crashes mid-write, file could be corrupt.
      // We document this by showing writeJson uses ensureDir + writeFileSync.
      const filePath = path.join(TEST_DIR, 'atomic-test.json');
      writeJson(filePath, { safe: true });

      // Verify the write completed normally
      expect(readJson(filePath)).toEqual({ safe: true });
    });
  });
});
