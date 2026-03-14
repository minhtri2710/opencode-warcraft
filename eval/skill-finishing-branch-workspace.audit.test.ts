import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('finishing-a-development-branch skill workspace neutrality', () => {
  const content = readFileSync(
    join(
      import.meta.dir,
      '..',
      'packages',
      'opencode-warcraft',
      'skills',
      'finishing-a-development-branch',
      'SKILL.md',
    ),
    'utf-8',
  );

  it('should not describe options as branch/worktree unconditionally', () => {
    // Options should use mode-neutral 'workspace' terminology
    expect(content).not.toMatch(/Keep branch\/worktree/);
    expect(content).not.toMatch(/Discard branch\/worktree/);
    expect(content).not.toMatch(/Merge task branch now/);
  });

  it('description should say workspace not worktree', () => {
    const descLine = content.split('\n').find((l) => l.startsWith('description:'));
    expect(descLine).toBeDefined();
    expect(descLine).toContain('workspace');
    expect(descLine).not.toMatch(/worktree changes/);
  });

  it('preconditions should say assigned workspace', () => {
    expect(content).toContain('assigned workspace');
    expect(content).not.toMatch(/done in its worktree/);
  });
});
