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
const registrySource = readFileSync(REGISTRY_PATH, 'utf-8');

describe('Skill workspace contract audit', () => {
  it('does not describe worktree creation as always creating an isolated worktree', () => {
    expect(registrySource).not.toContain('Create isolated worktree (`warcraft_worktree_create`)');
  });

  it('does not describe Mekkatorque as only executing tasks in worktrees', () => {
    expect(registrySource).not.toContain('Executes tasks in worktrees');
  });

  it('tells blocked-resume flows to issue the returned task() call after warcraft_worktree_create', () => {
    expect(registrySource).toContain('continueFrom: "blocked", decision: "..."');
    expect(registrySource).toMatch(/Issue the (newly )?returned\s+`?task\(\)`? call/i);
  });
});
