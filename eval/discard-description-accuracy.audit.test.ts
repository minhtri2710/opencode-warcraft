/**
 * Fresh-eye audit: warcraft_worktree_discard tool description says "discard changes"
 * but in direct mode, changes to the project root are NOT reverted.
 * The description should clarify that only the task status is reset in direct mode.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const TOOLS_PATH = path.resolve(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'tools',
  'worktree-tools.ts',
);
const toolsSource = readFileSync(TOOLS_PATH, 'utf-8');

describe('warcraft_worktree_discard description accuracy audit', () => {
  it('should not unconditionally claim changes are discarded', () => {
    // Find the discard tool description
    const descMatch = toolsSource.match(/discardWorktreeTool[\s\S]*?description:\s*'([^']+)'/);
    expect(descMatch).toBeTruthy();
    const description = descMatch![1];
    // The description should not unconditionally say "discard changes"
    // since direct mode does NOT discard file changes.
    expect(description).not.toMatch(/discard changes/i);
  });
});
