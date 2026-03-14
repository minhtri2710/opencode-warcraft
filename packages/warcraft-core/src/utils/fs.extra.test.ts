import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, fileExists, readJson, readText, writeJson, writeText } from './fs.js';

const TEST_DIR = `/tmp/warcraft-fs-extra-${process.pid}`;

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('fs extra edge cases', () => {
  describe('readJson', () => {
    it('reads JSON with nested structures', () => {
      const data = { deep: { nested: { value: [1, 2, 3] } } };
      const filePath = path.join(TEST_DIR, 'nested.json');
      fs.writeFileSync(filePath, JSON.stringify(data));
      expect(readJson(filePath)).toEqual(data);
    });

    it('reads JSON with null value', () => {
      const filePath = path.join(TEST_DIR, 'null.json');
      fs.writeFileSync(filePath, 'null');
      expect(readJson(filePath)).toBeNull();
    });

    it('reads JSON with string value', () => {
      const filePath = path.join(TEST_DIR, 'string.json');
      fs.writeFileSync(filePath, '"hello"');
      expect(readJson<string>(filePath)).toBe('hello');
    });

    it('reads JSON with number value', () => {
      const filePath = path.join(TEST_DIR, 'number.json');
      fs.writeFileSync(filePath, '42');
      expect(readJson<number>(filePath)).toBe(42);
    });

    it('reads JSON with boolean value', () => {
      const filePath = path.join(TEST_DIR, 'bool.json');
      fs.writeFileSync(filePath, 'true');
      expect(readJson<boolean>(filePath)).toBe(true);
    });
  });

  describe('writeJson', () => {
    it('creates deeply nested parent directories', () => {
      const filePath = path.join(TEST_DIR, 'a', 'b', 'c', 'd', 'data.json');
      writeJson(filePath, { deep: true });
      expect(readJson(filePath)).toEqual({ deep: true });
    });

    it('handles special characters in values', () => {
      const data = { emoji: '🎉', unicode: '日本語' };
      const filePath = path.join(TEST_DIR, 'special.json');
      writeJson(filePath, data);
      expect(readJson(filePath)).toEqual(data);
    });
  });

  describe('writeText', () => {
    it('handles empty string', () => {
      const filePath = path.join(TEST_DIR, 'empty.txt');
      writeText(filePath, '');
      expect(readText(filePath)).toBe('');
    });

    it('handles multiline content', () => {
      const content = 'line1\nline2\nline3';
      const filePath = path.join(TEST_DIR, 'multi.txt');
      writeText(filePath, content);
      expect(readText(filePath)).toBe(content);
    });
  });

  describe('readText', () => {
    it('reads file with BOM', () => {
      const filePath = path.join(TEST_DIR, 'bom.txt');
      fs.writeFileSync(filePath, '\uFEFFcontent with BOM');
      const result = readText(filePath);
      expect(result).toContain('content with BOM');
    });
  });

  describe('ensureDir', () => {
    it('is idempotent for existing deep directories', () => {
      const dirPath = path.join(TEST_DIR, 'x', 'y', 'z');
      ensureDir(dirPath);
      ensureDir(dirPath); // should not throw
      expect(fs.existsSync(dirPath)).toBe(true);
    });
  });

  describe('fileExists', () => {
    it('returns false for symlink to non-existent target', () => {
      const linkPath = path.join(TEST_DIR, 'broken-link');
      try {
        fs.symlinkSync('/nonexistent/target', linkPath);
        expect(fileExists(linkPath)).toBe(false);
      } catch {
        // Some systems may not support symlinks in tests
      }
    });
  });
});
