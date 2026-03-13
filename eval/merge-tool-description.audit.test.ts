/**
 * Fresh-eye audit: warcraft_merge tool description should not unconditionally
 * claim it merges a task branch — in direct mode there is no separate branch.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE_TOOLS_PATH = join(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'tools',
  'worktree-tools.ts',
);

const source = readFileSync(WORKTREE_TOOLS_PATH, 'utf-8');

describe('warcraft_merge tool description audit', () => {
  it('should not unconditionally claim "Merge completed task branch"', () => {
    // Find the merge tool description
    const mergeBlock = source.slice(source.indexOf("'Merge completed"), source.indexOf("'Merge completed") + 200);
    expect(mergeBlock).not.toMatch(/Merge completed task branch/i);
  });
});
