/**
 * Fresh-eye audit: WorktreeTools user-facing blocked/error messages must
 * include the full delegation contract — after calling warcraft_worktree_create,
 * the orchestrator must issue the returned task() call.
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

describe('WorktreeTools delegation messaging audit', () => {
  it('blocked-task message should mention the returned task() call after resume', () => {
    // The non-direct-mode blocked message tells users to resume with
    // warcraft_worktree_create(continueFrom: "blocked", ...) but omits
    // the required follow-up to issue the returned task() call.
    const blockedMsg = source.slice(
      source.indexOf('Task blocked. Warcraft Master'),
      source.indexOf('Task blocked. Warcraft Master') + 300,
    );
    expect(blockedMsg).toMatch(/task\(\)/);
  });

  it('missing baseCommit error should mention the returned task() call after recreation', () => {
    // The error about missing baseCommit tells users to recreate with
    // warcraft_worktree_create but doesn't mention issuing the returned
    // task() call.
    const baseCommitMsg = source.slice(
      source.indexOf('is missing baseCommit'),
      source.indexOf('is missing baseCommit') + 300,
    );
    expect(baseCommitMsg).toMatch(/task\(\)/);
  });
});
