import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { detectContext, findProjectRoot } from './detection.js';

const TEST_DIR = `/tmp/warcraft-detection-extra-${process.pid}`;

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('detection extra edge cases', () => {
  describe('detectContext', () => {
    it('returns isWorktree=false for non-worktree path with .git dir', () => {
      const projectDir = path.join(TEST_DIR, 'regular-repo');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      const result = detectContext(projectDir);
      expect(result.isWorktree).toBe(false);
      expect(result.feature).toBeNull();
      expect(result.task).toBeNull();
    });

    it('handles worktree path with extra subdirectories', () => {
      const worktreePath = path.join(TEST_DIR, '.beads', 'artifacts', '.worktrees', 'feat', 'task');
      fs.mkdirSync(worktreePath, { recursive: true });
      const deepPath = path.join(worktreePath, 'src', 'utils');
      fs.mkdirSync(deepPath, { recursive: true });
      // detectContext uses the provided cwd, not deeper paths
      const result = detectContext(worktreePath);
      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('feat');
      expect(result.task).toBe('task');
    });

    it('handles .git file with malformed content', () => {
      const dirPath = path.join(TEST_DIR, 'malformed-git');
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, '.git'), 'not a valid gitdir reference');
      const result = detectContext(dirPath);
      expect(result.isWorktree).toBe(false);
    });

    it('detects worktree from docs path pattern', () => {
      const worktreePath = path.join(TEST_DIR, 'docs', '.worktrees', 'my-feat', '01-my-task');
      fs.mkdirSync(worktreePath, { recursive: true });
      const result = detectContext(worktreePath);
      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('my-feat');
      expect(result.task).toBe('01-my-task');
      expect(result.mainProjectRoot).toBe(TEST_DIR);
    });
  });

  describe('findProjectRoot', () => {
    it('finds .beads/artifacts before .git when both present', () => {
      const projectDir = path.join(TEST_DIR, 'both-markers');
      fs.mkdirSync(path.join(projectDir, '.beads', 'artifacts'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      const nestedDir = path.join(projectDir, 'src', 'deep');
      fs.mkdirSync(nestedDir, { recursive: true });
      const result = findProjectRoot(nestedDir);
      expect(result).toBe(projectDir);
    });

    it('returns current directory when marker is at cwd', () => {
      const projectDir = path.join(TEST_DIR, 'at-cwd');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      const result = findProjectRoot(projectDir);
      expect(result).toBe(projectDir);
    });
  });
});
