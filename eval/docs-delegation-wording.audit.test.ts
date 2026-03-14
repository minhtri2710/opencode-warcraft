import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('Root README.md delegation and workspace wording audit', () => {
  const readmeSrc = readFileSync('README.md', 'utf-8');

  it('should not say warcraft_worktree_create "creates isolated worktree"', () => {
    expect(readmeSrc).not.toMatch(/creates isolated worktree/i);
  });

  it('should not say workers "spawn" from worktree_create', () => {
    // Workers are launched via explicit task() calls, not spawned automatically.
    expect(readmeSrc).not.toMatch(/spawns? (Mekkatorque |a )?worker/i);
  });

  it('should not say Mekkatorque "executes tasks directly in isolated worktrees"', () => {
    expect(readmeSrc).not.toMatch(/executes tasks.*in isolated worktrees/i);
  });

  it('should not say "commits changes to task branch" unconditionally', () => {
    expect(readmeSrc).not.toMatch(/commits (changes )?to task branch/i);
  });
});

describe('docs/quickstart.md delegation wording audit', () => {
  const quickstartSrc = readFileSync('docs/quickstart.md', 'utf-8');

  it('should not say warcraft_worktree_create creates isolated worktree and spawns worker', () => {
    expect(quickstartSrc).not.toMatch(/creates an isolated.*worktree.*spawns/i);
  });

  it('should not say workers execute in isolated worktrees', () => {
    expect(quickstartSrc).not.toMatch(/execute in isolated worktrees/i);
  });
});
