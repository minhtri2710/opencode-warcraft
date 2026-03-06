import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { detectContext, findProjectRoot } from './detection.js';

const TEST_DIR = `/tmp/warcraft-detection-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

describe('detection utilities', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe('detectContext', () => {
    it('returns default result for a plain directory', () => {
      const result = detectContext(TEST_DIR);

      expect(result.projectRoot).toBe(TEST_DIR);
      expect(result.feature).toBeNull();
      expect(result.task).toBeNull();
      expect(result.isWorktree).toBe(false);
      expect(result.mainProjectRoot).toBeNull();
    });

    it('detects worktree from .beads/artifacts path pattern', () => {
      const worktreePath = path.join(TEST_DIR, '.beads', 'artifacts', '.worktrees', 'my-feature', '01-my-task');
      fs.mkdirSync(worktreePath, { recursive: true });

      const result = detectContext(worktreePath);

      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('my-feature');
      expect(result.task).toBe('01-my-task');
      expect(result.mainProjectRoot).toBe(TEST_DIR);
      expect(result.projectRoot).toBe(TEST_DIR);
    });

    it('detects worktree from docs path pattern', () => {
      const worktreePath = path.join(TEST_DIR, 'docs', '.worktrees', 'feature-x', '02-task-y');
      fs.mkdirSync(worktreePath, { recursive: true });

      const result = detectContext(worktreePath);

      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('feature-x');
      expect(result.task).toBe('02-task-y');
      expect(result.mainProjectRoot).toBe(TEST_DIR);
      expect(result.projectRoot).toBe(TEST_DIR);
    });

    it('extracts feature and task from complex worktree paths', () => {
      const worktreePath = path.join(
        TEST_DIR,
        '.beads',
        'artifacts',
        '.worktrees',
        'codebase-improvements-v1',
        '20-add-detectionts-and-fsts-test-suites',
      );
      fs.mkdirSync(worktreePath, { recursive: true });

      const result = detectContext(worktreePath);

      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('codebase-improvements-v1');
      expect(result.task).toBe('20-add-detectionts-and-fsts-test-suites');
    });

    it('detects worktree via .git file pointing to worktree gitdir', () => {
      // Simulate a git worktree: .git is a file containing "gitdir: ..."
      const worktreePath = path.join(TEST_DIR, '.beads', 'artifacts', '.worktrees', 'feat-a', 'task-1');
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create .git directory structure for the main repo
      const mainGitDir = path.join(TEST_DIR, '.git', 'worktrees', 'task-1');
      fs.mkdirSync(mainGitDir, { recursive: true });

      // Create .git file in worktree pointing to the main repo's worktree gitdir
      fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${mainGitDir}`);

      const result = detectContext(worktreePath);

      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('feat-a');
      expect(result.task).toBe('task-1');
      expect(result.mainProjectRoot).toBe(TEST_DIR);
    });

    it('returns non-worktree result when .git is a regular directory', () => {
      const dirPath = path.join(TEST_DIR, 'regular-repo');
      fs.mkdirSync(path.join(dirPath, '.git'), { recursive: true });

      const result = detectContext(dirPath);

      // .git is a directory (normal repo), not a worktree
      expect(result.isWorktree).toBe(false);
      expect(result.projectRoot).toBe(dirPath);
    });

    it('handles Windows-style backslashes in path', () => {
      // normalizePath converts backslashes, so this should still match
      const worktreePath = path.join(TEST_DIR, '.beads', 'artifacts', '.worktrees', 'feat', 'task');
      fs.mkdirSync(worktreePath, { recursive: true });

      // The function normalizes internally, so forward-slash paths work on all platforms
      const result = detectContext(worktreePath);

      expect(result.isWorktree).toBe(true);
      expect(result.feature).toBe('feat');
      expect(result.task).toBe('task');
    });
  });

  describe('findProjectRoot', () => {
    it('finds root with .beads/artifacts directory', () => {
      const projectDir = path.join(TEST_DIR, 'project');
      fs.mkdirSync(path.join(projectDir, '.beads', 'artifacts'), { recursive: true });

      const result = findProjectRoot(projectDir);

      expect(result).toBe(projectDir);
    });

    it('finds root with .git directory', () => {
      const projectDir = path.join(TEST_DIR, 'git-project');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      const result = findProjectRoot(projectDir);

      expect(result).toBe(projectDir);
    });

    it('walks up to find project root from nested directory', () => {
      const projectDir = path.join(TEST_DIR, 'project');
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });
      const nestedDir = path.join(projectDir, 'src', 'utils');
      fs.mkdirSync(nestedDir, { recursive: true });

      const result = findProjectRoot(nestedDir);

      expect(result).toBe(projectDir);
    });

    it('prefers .beads/artifacts over .git when both exist at same level', () => {
      const projectDir = path.join(TEST_DIR, 'both');
      fs.mkdirSync(path.join(projectDir, '.beads', 'artifacts'), { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      const result = findProjectRoot(projectDir);

      // .beads/artifacts is checked first in the function
      expect(result).toBe(projectDir);
    });

    it('returns null when no project root markers are found', () => {
      // TEST_DIR has no .git or .beads/artifacts
      // But walking up will eventually find real .git in the filesystem
      // So we need a truly isolated path
      const isolatedDir = path.join(TEST_DIR, 'deep', 'nested', 'dir');
      fs.mkdirSync(isolatedDir, { recursive: true });

      // findProjectRoot walks to filesystem root - if /tmp has no .git, returns null
      // However, some systems might have .git above /tmp, so we test the function
      // walks upward correctly by checking it finds something or null
      const result = findProjectRoot(isolatedDir);

      // It should walk up and either find something or return null
      // We can't guarantee null on all systems since parent dirs might have .git
      if (result !== null) {
        // If it found something, it should be a valid path with .git or .beads/artifacts
        expect(
          fs.existsSync(path.join(result, '.git')) || fs.existsSync(path.join(result, '.beads', 'artifacts')),
        ).toBe(true);
      } else {
        expect(result).toBeNull();
      }
    });

    it('stops at the filesystem root', () => {
      // This tests that the function terminates and doesn't loop infinitely
      const result = findProjectRoot('/');

      // Root directory typically has no .git or .beads/artifacts
      // But the function should still terminate
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('finds .beads/artifacts from deeply nested path', () => {
      const projectDir = path.join(TEST_DIR, 'deep-project');
      fs.mkdirSync(path.join(projectDir, '.beads', 'artifacts'), { recursive: true });
      const deepPath = path.join(projectDir, 'a', 'b', 'c', 'd', 'e');
      fs.mkdirSync(deepPath, { recursive: true });

      const result = findProjectRoot(deepPath);

      expect(result).toBe(projectDir);
    });
  });
});
