import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import type {
  AgentsMdService,
  BvTriageService,
  ContextService,
  FeatureService,
  PlanService,
  TaskService,
  WorktreeService,
} from 'warcraft-core';
import { ContextTools } from '../packages/opencode-warcraft/src/tools/context-tools.js';

const TEST_DIR = `/tmp/opencode-warcraft-context-next-action-audit-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

describe('Context nextAction audit', () => {
  it('tells users to issue the returned task() call after warcraft_worktree_create for the next runnable task', async () => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const tool = new ContextTools({
      featureService: {
        get: () => ({ name: 'test-feature', status: 'executing', ticket: null, createdAt: '2025-01-01T00:00:00Z' }),
        list: () => ['test-feature'],
      } as unknown as FeatureService,
      planService: {
        read: () => ({ content: '# Plan', approved: true }),
      } as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-task', name: 'Task', status: 'pending', origin: 'plan' }],
        getRawStatus: () => null,
        computeRunnableStatus: () => ({ runnable: ['01-task'], blocked: {} }),
      } as unknown as TaskService,
      contextService: {
        list: () => [],
      } as unknown as ContextService,
      agentsMdService: {} as AgentsMdService,
      worktreeService: {
        listAll: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
        hasUncommittedChanges: () => Promise.resolve(false),
      } as unknown as WorktreeService,
      checkBlocked: () => ({ blocked: false }),
      bvTriageService: {
        getBlockerTriageDetails: () => null,
        getGlobalTriageDetails: () => null,
        getHealth: () => ({ enabled: false, available: false, lastError: null }),
      } as unknown as BvTriageService,
      projectRoot: TEST_DIR,
    }).getStatusTool(() => 'test-feature');

    const rawResult = await tool.execute({ feature: 'test-feature' });
    const result = JSON.parse(rawResult) as { success: boolean; data: { nextAction: string } };

    expect(result.success).toBe(true);
    expect(result.data.nextAction).toBe(
      'Start next task with warcraft_worktree_create, then issue the returned task() call: 01-task',
    );
  });
});
