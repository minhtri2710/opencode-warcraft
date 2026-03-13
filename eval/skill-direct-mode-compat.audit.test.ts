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

describe('Skill direct-mode compatibility audit', () => {
  it('does not claim parallel Warcraft dispatch always runs in isolated worktrees', () => {
    expect(registrySource).not.toContain('All three run concurrently in isolated worktrees');
  });

  it('does not claim subagent-driven development always starts tasks in an isolated workspace via warcraft_worktree_create', () => {
    expect(registrySource).not.toContain('Start each task in isolated workspace via `warcraft_worktree_create`');
  });
});
