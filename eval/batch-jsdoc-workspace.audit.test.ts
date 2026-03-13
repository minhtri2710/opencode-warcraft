/**
 * Fresh-eye audit: batch-tools JSDoc should not claim the execute mode
 * always creates worktrees — in direct mode, workspaces are prepared
 * without creating worktrees.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BATCH_TOOLS_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'tools', 'batch-tools.ts');

const source = readFileSync(BATCH_TOOLS_PATH, 'utf-8');

describe('BatchTools JSDoc workspace wording audit', () => {
  it('batchExecuteTool JSDoc should not say "create worktrees" unconditionally', () => {
    // The JSDoc says "create worktrees and generate worker prompts" but in
    // direct mode no worktree is created. Should say "prepare workspaces".
    const jsdocBlock = source.slice(
      source.indexOf('Identify and dispatch'),
      source.indexOf('Identify and dispatch') + 300,
    );
    expect(jsdocBlock).not.toMatch(/create worktrees/i);
  });
});
