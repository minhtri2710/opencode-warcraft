import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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

const TEST_DIR = `/tmp/opencode-warcraft-context-tools-workspace-audit-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createTool(worktreeService: WorktreeService): ReturnType<ContextTools['getStatusTool']> {
  return new ContextTools({
    featureService: {
      get: () => ({
        name: 'test-feature',
        status: 'executing',
        ticket: null,
        createdAt: '2025-01-01T00:00:00Z',
      }),
      list: () => ['test-feature'],
    } as unknown as FeatureService,
    planService: {
      read: () => ({ content: '# Plan', approved: true }),
    } as unknown as PlanService,
    taskService: {
      list: () => [{ folder: '01-task', name: 'Task', status: 'in_progress', origin: 'plan' }],
      getRawStatus: () => ({ workerSession: { workspaceMode: 'worktree' as const } }),
      computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
    } as unknown as TaskService,
    contextService: {
      list: () => [],
    } as unknown as ContextService,
    agentsMdService: {} as AgentsMdService,
    worktreeService,
    checkBlocked: () => ({ blocked: false }),
    bvTriageService: {
      getBlockerTriageDetails: () => null,
      getGlobalTriageDetails: () => null,
      getHealth: () => ({ enabled: false, available: false, lastError: null }),
    } as unknown as BvTriageService,
    projectRoot: TEST_DIR,
  }).getStatusTool(() => 'test-feature');
}

describe('ContextTools workspace audit', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('degrades gracefully when per-task worktree lookup fails', async () => {
    const tool = createTool({
      listAll: () => Promise.resolve([]),
      get: () => Promise.reject(new Error('worktree lookup unavailable')),
      hasUncommittedChanges: () => Promise.resolve(false),
    } as unknown as WorktreeService);

    const rawResult = await tool.execute({ feature: 'test-feature' });
    const result = JSON.parse(rawResult) as {
      success: boolean;
      data: { tasks: { list: Array<{ folder: string; workspace: unknown }> } };
    };

    expect(result.success).toBe(true);
    expect(result.data.tasks.list).toEqual([
      {
        folder: '01-task',
        name: 'Task',
        status: 'in_progress',
        origin: 'plan',
        dependsOn: null,
        workspace: null,
      },
    ]);
  });
});
