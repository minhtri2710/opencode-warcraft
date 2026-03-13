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

describe('Final skill workspace wording audit', () => {
  it('does not describe warcraft_worktree_create as creating the worktree unconditionally in skill docs', () => {
    expect(registrySource).not.toContain(
      'warcraft_worktree_create` creates the worktree and returns delegation instructions',
    );
    expect(registrySource).not.toContain('Create worktree + delegation instructions');
  });

  it('does not describe subagent-driven-development as requiring an isolated workspace before starting', () => {
    expect(registrySource).not.toContain('Set up isolated workspace before starting');
  });
});
