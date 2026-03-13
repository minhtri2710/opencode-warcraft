import { describe, expect, it } from 'bun:test';
import { WorktreeTools } from '../packages/opencode-warcraft/src/tools/worktree-tools.js';

describe('Worktree tool description audit', () => {
  it('describes warcraft_worktree_create as returning a task() payload instead of auto-spawning Mekkatorque', () => {
    const tool = new WorktreeTools({
      featureService: {} as any,
      planService: {} as any,
      taskService: {} as any,
      worktreeService: {} as any,
      contextService: { list: () => [] },
      validateTaskStatus: ((status: string) => status) as any,
      checkBlocked: () => ({ blocked: false }),
      checkDependencies: () => ({ allowed: true }),
      hasCompletionGateEvidence: () => true,
      completionGates: ['build', 'test', 'lint'] as const,
      verificationModel: 'tdd',
      workflowGatesMode: 'warn',
      eventLogger: { emit: () => {}, getLatestTraceContext: () => undefined } as any,
    }).createWorktreeTool(() => 'test-feature');

    expect(tool.description).toContain('task() payload');
    expect(tool.description.toLowerCase()).not.toContain('automatically');
    expect(tool.description.toLowerCase()).not.toContain('spawns mekkatorque');
  });
});
