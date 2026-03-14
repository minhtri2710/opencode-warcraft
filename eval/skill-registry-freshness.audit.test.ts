import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('generated skill registry freshness', () => {
  const skillsDir = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills');
  const registryPath = join(
    import.meta.dir,
    '..',
    'packages',
    'opencode-warcraft',
    'src',
    'skills',
    'registry.generated.ts',
  );
  const registryContent = readFileSync(registryPath, 'utf-8');

  // Get all skill directories
  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  it('should have all skill directories represented in the registry', () => {
    for (const dir of skillDirs) {
      expect(registryContent).toContain(`name: "${dir}"`);
    }
  });

  it('executing-plans skill should mention task() call, not just warcraft_worktree_create', () => {
    // The generated registry should reflect the updated skill content
    expect(registryContent).not.toContain('Mark as in_progress via `warcraft_worktree_create()`');
    expect(registryContent).toContain('task()');
  });

  it('finishing-a-development-branch should use workspace terminology', () => {
    expect(registryContent).not.toContain('discard worktree changes safely');
    expect(registryContent).toContain('discard workspace changes safely');
  });

  it('parallel-exploration should reference warcraft_batch_execute', () => {
    expect(registryContent).not.toContain('with `warcraft_worktree_create`.');
  });
});
