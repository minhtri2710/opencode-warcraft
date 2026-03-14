import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type DetectionResult, detectContext, findProjectRoot } from './detection.js';

describe('detection exhaustive', () => {
  describe('detectContext properties', () => {
    it('returns projectRoot as cwd', () => {
      const result = detectContext(process.cwd());
      expect(result.projectRoot).toBe(process.cwd());
    });

    it('feature is null at project root', () => {
      expect(detectContext(process.cwd()).feature).toBeNull();
    });

    it('task is null at project root', () => {
      expect(detectContext(process.cwd()).task).toBeNull();
    });

    it('isWorktree is false at main project', () => {
      expect(detectContext(process.cwd()).isWorktree).toBe(false);
    });

    it('mainProjectRoot is null when not in worktree', () => {
      expect(detectContext(process.cwd()).mainProjectRoot).toBeNull();
    });
  });

  describe('detectContext with various paths', () => {
    it('handles /tmp', () => {
      const result = detectContext('/tmp');
      expect(result.projectRoot).toBe('/tmp');
    });

    it('handles home directory', () => {
      const home = os.homedir();
      const result = detectContext(home);
      expect(result.projectRoot).toBe(home);
    });

    it('handles temp directory', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-ex-'));
      try {
        const result = detectContext(tempDir);
        expect(result.projectRoot).toBe(tempDir);
        expect(result.feature).toBeNull();
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('findProjectRoot variations', () => {
    it('finds root from nested dir', () => {
      const nested = path.join(process.cwd(), 'packages', 'warcraft-core');
      if (fs.existsSync(nested)) {
        const root = findProjectRoot(nested);
        expect(root).not.toBeNull();
      }
    });

    it('handles root dir', () => {
      const result = findProjectRoot('/');
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });
});
