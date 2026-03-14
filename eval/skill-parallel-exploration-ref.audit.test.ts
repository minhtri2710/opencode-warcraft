import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('parallel-exploration skill references', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills', 'parallel-exploration', 'SKILL.md'),
    'utf-8',
  );

  it('should reference warcraft_batch_execute for parallel implementation, not warcraft_worktree_create', () => {
    // parallel-exploration is read-only; it should point to batch_execute for implementation work
    expect(content).toContain('warcraft_batch_execute');
    expect(content).not.toMatch(/with `warcraft_worktree_create`/);
  });
});
