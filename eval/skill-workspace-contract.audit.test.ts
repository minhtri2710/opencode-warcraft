import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const REGISTRY_PATH = path.resolve(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'skills',
  'registry.generated.ts',
);
const registrySource = readFileSync(REGISTRY_PATH, 'utf-8').replaceAll('\\`', '`');

describe('Skill workspace contract audit', () => {
  it('does not describe worktree creation as always creating an isolated worktree', () => {
    expect(registrySource).not.toContain('Create isolated worktree (`warcraft_worktree_create`)');
  });

  it('does not describe Mekkatorque as only executing tasks in worktrees', () => {
    expect(registrySource).not.toContain('Executes tasks in worktrees');
  });

  it('tells blocked-resume flows to issue the returned task() call after warcraft_worktree_create', () => {
    expect(registrySource).toContain('Issue the newly returned `task()` call to relaunch the worker');
  });
});
