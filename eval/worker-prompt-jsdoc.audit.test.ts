/**
 * Fresh-eye audit: worker-prompt.ts JSDoc should not claim the assignment
 * details always include "worktree" — the workspace can be a worktree or
 * the project root in direct mode.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKER_PROMPT_PATH = join(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'utils',
  'worker-prompt.ts',
);

const source = readFileSync(WORKER_PROMPT_PATH, 'utf-8');

describe('worker-prompt JSDoc workspace wording audit', () => {
  it('buildWorkerPrompt JSDoc should not list "worktree" as an unconditional detail', () => {
    // The JSDoc says "Assignment details (feature, task, worktree, branch)"
    // but the workspace can be a worktree or the project root.
    const jsdocBlock = source.slice(source.indexOf('Assignment details'), source.indexOf('Assignment details') + 100);
    expect(jsdocBlock).not.toMatch(/worktree,/);
  });
});
