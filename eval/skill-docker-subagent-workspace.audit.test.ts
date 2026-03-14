import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('docker-mastery skill workspace neutrality', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills', 'docker-mastery', 'SKILL.md'),
    'utf-8',
  );

  it('should not claim worktrees are mounted unconditionally', () => {
    expect(content).not.toMatch(/Warcraft worktrees are mounted automatically/);
  });

  it('should describe workspace mounting generically', () => {
    expect(content).toContain('workspace');
    expect(content).not.toMatch(/<worktree>:\/workspace/);
  });
});

describe('subagent-driven-development skill worktree requirement', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills', 'subagent-driven-development', 'SKILL.md'),
    'utf-8',
  );

  it('should not mark using-git-worktrees as unconditionally REQUIRED', () => {
    // In direct mode, worktree setup is not needed
    expect(content).not.toMatch(/REQUIRED.*Set up.*workspace before starting/);
  });
});
