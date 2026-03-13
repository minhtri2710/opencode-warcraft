/**
 * Fresh-eye audit: TaskTools user-facing messaging must reflect the real
 * delegation contract — warcraft_worktree_create returns a task() payload
 * that the orchestrator must issue, and workspace mode can be either
 * worktree or direct.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TASK_TOOLS_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'tools', 'task-tools.ts');

const source = readFileSync(TASK_TOOLS_PATH, 'utf-8');

describe('TaskTools delegation contract audit', () => {
  it('createTaskTool success message should not promise a worktree unconditionally', () => {
    // The message currently says "to use its worktree" — but direct mode is
    // a supported runtime path, so the message should reference the assigned
    // workspace generically.
    expect(source).not.toMatch(/to use its worktree/i);
  });

  it('createTaskTool success message should mention issuing the returned task() call', () => {
    // After calling warcraft_worktree_create, the orchestrator must issue the
    // returned task() call. The reminder message should include this step.
    const createToolBlock = source.slice(source.indexOf('createTaskTool'), source.indexOf('updateTaskTool'));
    expect(createToolBlock).toMatch(/task\(\)/);
  });

  it('updateTaskTool reopen-rejection should mention issuing the returned task() call', () => {
    // The error tells users to "use warcraft_worktree_create" but omits the
    // required follow-up: issue the returned task() call.
    const updateToolBlock = source.slice(source.indexOf('updateTaskTool'));
    const reopenBlock = updateToolBlock.slice(
      updateToolBlock.indexOf('Cannot reopen'),
      updateToolBlock.indexOf('Detect reopen') > -1
        ? updateToolBlock.indexOf('Detect reopen')
        : updateToolBlock.indexOf('Cannot reopen') + 400,
    );
    expect(reopenBlock).toMatch(/task\(\)/);
  });
});
