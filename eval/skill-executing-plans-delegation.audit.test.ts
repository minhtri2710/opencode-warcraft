import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('executing-plans skill delegation contract', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills', 'executing-plans', 'SKILL.md'),
    'utf-8',
  );

  it('should mention task() call after warcraft_worktree_create', () => {
    // warcraft_worktree_create returns a task() payload that must be issued
    expect(content).toContain('task()');
    expect(content).not.toMatch(/Mark as in_progress via.*warcraft_worktree_create/);
  });
});
