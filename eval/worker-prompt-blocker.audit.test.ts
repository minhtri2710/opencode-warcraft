/**
 * Fresh-eye audit: worker-prompt blocker protocol should not unconditionally
 * say "Save your progress to the worktree" — in direct mode there is no
 * worktree.
 */
import { describe, expect, it } from 'bun:test';
import { buildWorkerPrompt } from '../packages/opencode-warcraft/src/utils/worker-prompt.js';

describe('Worker prompt blocker protocol audit', () => {
  it('should not say "to the worktree" in direct mode', () => {
    const prompt = buildWorkerPrompt({
      feature: 'test-feature',
      task: '01-task',
      taskOrder: 1,
      workspacePath: '/project',
      workspaceMode: 'direct',
      plan: '# Plan',
      contextFiles: [],
      spec: '# Spec',
      previousTasks: [],
      verificationModel: 'tdd',
      complexity: 'standard',
    });

    // In direct mode, the blocker protocol should not say "to the worktree"
    const blockerSection = prompt.slice(prompt.indexOf('Blocker Protocol'), prompt.indexOf('Blocker Protocol') + 400);
    expect(blockerSection).not.toMatch(/to the worktree/i);
  });
});
