import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('package README skill table accuracy', () => {
  const content = readFileSync(join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'README.md'), 'utf-8');

  it('finishing-a-development-branch should say workspace not worktree', () => {
    expect(content).not.toMatch(/finishing-a-development-branch.*worktree changes/);
    expect(content).toMatch(/finishing-a-development-branch.*workspace changes/);
  });
});
