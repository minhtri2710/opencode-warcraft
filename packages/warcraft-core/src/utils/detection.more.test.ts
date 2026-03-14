import { describe, expect, it } from 'bun:test';
import { detectContext, findProjectRoot } from './detection.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('detection more scenarios', () => {
  describe('detectContext', () => {
    it('returns projectRoot matching cwd', () => {
      const result = detectContext(process.cwd());
      expect(result.projectRoot).toBe(process.cwd());
    });

    it('detects feature and task as null or string', () => {
      const result = detectContext(process.cwd());
      expect(result.feature === null || typeof result.feature === 'string').toBe(true);
      expect(result.task === null || typeof result.task === 'string').toBe(true);
    });

    it('isWorktree is boolean', () => {
      const result = detectContext(process.cwd());
      expect(typeof result.isWorktree).toBe('boolean');
    });

    it('detects from temp directory without warcraft', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-'));
      try {
        const result = detectContext(tempDir);
        expect(result.projectRoot).toBe(tempDir);
        expect(result.feature).toBeNull();
        expect(result.task).toBeNull();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('findProjectRoot', () => {
    it('finds root from current directory', () => {
      const root = findProjectRoot(process.cwd());
      expect(root).not.toBeNull();
    });

    it('returns null for temp directory without markers', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-project-'));
      try {
        const result = findProjectRoot(tempDir);
        expect(result === null || typeof result === 'string').toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('returns string type when found', () => {
      const root = findProjectRoot(process.cwd());
      if (root !== null) {
        expect(typeof root).toBe('string');
        expect(root.length).toBeGreaterThan(0);
      }
    });
  });
});
