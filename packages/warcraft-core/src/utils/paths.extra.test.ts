import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { getFeaturePath, getTaskPath, listFeatureDirectories, normalizePath, sanitizeName } from './paths.js';

const TEST_DIR = `/tmp/warcraft-paths-extra-${process.pid}`;

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('paths extra edge cases', () => {
  describe('listFeatureDirectories', () => {
    it('returns empty array when warcraft dir does not exist', () => {
      const result = listFeatureDirectories(TEST_DIR, 'off');
      expect(result).toEqual([]);
    });

    it('excludes hidden directories (dotfiles)', () => {
      const docsDir = path.join(TEST_DIR, 'docs');
      fs.mkdirSync(path.join(docsDir, '.hidden'), { recursive: true });
      fs.mkdirSync(path.join(docsDir, 'visible'), { recursive: true });
      const result = listFeatureDirectories(TEST_DIR, 'off');
      expect(result).toContain('visible');
      expect(result).not.toContain('.hidden');
    });

    it('excludes .worktrees directory', () => {
      const docsDir = path.join(TEST_DIR, 'docs');
      fs.mkdirSync(path.join(docsDir, '.worktrees'), { recursive: true });
      fs.mkdirSync(path.join(docsDir, 'my-feature'), { recursive: true });
      const result = listFeatureDirectories(TEST_DIR, 'off');
      expect(result).toContain('my-feature');
      expect(result).not.toContain('.worktrees');
    });

    it('excludes files (only directories)', () => {
      const docsDir = path.join(TEST_DIR, 'docs');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, 'README.md'), '# Readme');
      fs.mkdirSync(path.join(docsDir, 'feature-a'));
      const result = listFeatureDirectories(TEST_DIR, 'off');
      expect(result).toEqual(['feature-a']);
    });

    it('works with beadsMode on', () => {
      const beadsDir = path.join(TEST_DIR, '.beads', 'artifacts');
      fs.mkdirSync(path.join(beadsDir, 'feat-1'), { recursive: true });
      const result = listFeatureDirectories(TEST_DIR, 'on');
      expect(result).toContain('feat-1');
    });
  });

  describe('sanitizeName edge cases', () => {
    it('throws on empty input', () => {
      expect(() => sanitizeName('')).toThrow('Name cannot be empty');
    });

    it('throws on whitespace-only input', () => {
      expect(() => sanitizeName('   ')).toThrow('Name cannot be empty');
    });

    it('handles already-clean names', () => {
      expect(sanitizeName('clean-name-123')).toBe('clean-name-123');
    });
  });

  describe('normalizePath edge cases', () => {
    it('handles empty string', () => {
      expect(normalizePath('')).toBe('');
    });

    it('handles path with mixed separators', () => {
      expect(normalizePath('C:\\Users/mixed\\path/here')).toBe('C:/Users/mixed/path/here');
    });

    it('handles UNC paths', () => {
      const result = normalizePath('\\\\server\\share\\file');
      expect(result).toBe('//server/share/file');
    });
  });

  describe('path consistency between modes', () => {
    it('on and off modes produce different base paths', () => {
      const onPath = getFeaturePath('/root', 'feat', 'on');
      const offPath = getFeaturePath('/root', 'feat', 'off');
      expect(onPath).not.toBe(offPath);
      expect(onPath).toContain('.beads');
      expect(offPath).toContain('docs');
    });

    it('task paths include feature name in off mode', () => {
      const offPath = getTaskPath('/root', 'feat', '01-task', 'off');
      expect(offPath).toContain('feat');
      expect(offPath).toContain('01-task');
    });

    it('task paths throw in on mode (beads mode uses bead artifacts)', () => {
      expect(() => getTaskPath('/root', 'feat', '01-task', 'on')).toThrow(
        'Task filesystem paths are only available when beadsMode is off',
      );
    });
  });
});
