/**
 * Fresh-eye audit: warcraft_worktree_commit tool description should not
 * unconditionally say "commit changes to branch" — in direct mode there
 * is no separate branch.
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

describe('worktree-commit tool description audit', () => {
  it('should not unconditionally claim "commit changes to branch"', () => {
    // The tool description says "commit changes to branch" but in direct
    // mode there's no separate branch — changes stay in the project root.
    const commitToolBlock = source.slice(source.indexOf("'Complete task:"), source.indexOf("'Complete task:") + 200);
    expect(commitToolBlock).not.toMatch(/commit changes to branch/i);
  });
});
