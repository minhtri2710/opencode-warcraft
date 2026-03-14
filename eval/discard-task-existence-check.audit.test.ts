/**
 * Audit: warcraft_worktree_discard should validate task existence
 * before attempting worktree removal and status transition.
 * Without this, a non-existent task defaults to workspaceMode='worktree'
 * and tries to remove a non-existent worktree, then crashes on transition.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const WORKTREE_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/worktree-tools.ts');
const worktreeContent = fs.readFileSync(WORKTREE_TOOLS_PATH, 'utf-8');

describe('warcraft_worktree_discard task existence check', () => {
  it('should check task existence before attempting worktree removal in discardWorktreeTool', () => {
    // Find the discardWorktreeTool method section
    const discardSection = worktreeContent.slice(
      worktreeContent.indexOf('discardWorktreeTool'),
      worktreeContent.indexOf('pruneWorktreeTool'),
    );
    // Should have a taskInfo/taskService.get check before worktreeService.remove
    const getIndex = discardSection.indexOf('taskService.get(');
    const removeIndex = discardSection.indexOf('worktreeService.remove(');
    expect(getIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(getIndex).toBeLessThan(removeIndex);
  });

  it('should return toolError for non-existent task in discardWorktreeTool', () => {
    const discardSection = worktreeContent.slice(
      worktreeContent.indexOf('discardWorktreeTool'),
      worktreeContent.indexOf('pruneWorktreeTool'),
    );
    // Should have an early return with toolError for missing task
    expect(discardSection).toMatch(/taskInfo.*toolError.*not found|!taskInfo.*toolError/s);
  });
});
