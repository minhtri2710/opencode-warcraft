/**
 * Fresh-eye audit: worktree-response.ts formatBlockedResponse must include
 * the full delegation contract — after resume with warcraft_worktree_create,
 * the orchestrator must issue the returned task() call.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE_RESPONSE_PATH = join(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'tools',
  'worktree-response.ts',
);

const source = readFileSync(WORKTREE_RESPONSE_PATH, 'utf-8');

describe('worktree-response blocked delegation audit', () => {
  it('formatBlockedResponse worktree-mode message should mention the returned task() call', () => {
    // The formatBlockedResponse function builds a blocked message for worktree
    // mode that says "resume with warcraft_worktree_create(continueFrom...)"
    // but omits the required follow-up to issue the returned task() call.
    const fnBlock = source.slice(source.indexOf('formatBlockedResponse'));
    const worktreeMsg = fnBlock.slice(
      fnBlock.indexOf('Task blocked. Warcraft Master'),
      fnBlock.indexOf('Task blocked. Warcraft Master') + 300,
    );
    expect(worktreeMsg).toMatch(/task\(\)/);
  });
});
