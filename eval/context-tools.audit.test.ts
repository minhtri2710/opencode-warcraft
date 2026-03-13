import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
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

const TEST_DIR = `/tmp/opencode-warcraft-context-tools-audit-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createMockDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
      list: () => [],
      getRawStatus: () => null,
      computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
    } as unknown as TaskService,
    contextService: {
      list: () => [],
    } as unknown as ContextService,
    agentsMdService: {} as AgentsMdService,
    worktreeService: {
      listAll: () => Promise.reject(new Error('worktree inventory unavailable')),
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
    ...overrides,
  };
}

describe('ContextTools audit', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(path.join(TEST_DIR, '.beads'), { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('degrades gracefully when worktree inventory fails during status rendering', async () => {
    const tool = new ContextTools(createMockDeps()).getStatusTool(() => 'test-feature');
    const rawResult = await tool.execute({ feature: 'test-feature' });
    const result = JSON.parse(rawResult) as {
      success: boolean;
      data: { worktreeHygiene: { message: string } | null; nextAction: string };
    };

    expect(result.success).toBe(true);
    expect(result.data.worktreeHygiene).toBeDefined();
    expect(result.data.worktreeHygiene?.message).toContain('Failed to inspect worktrees');
    expect(result.data.nextAction).toBe('Generate tasks from plan with warcraft_tasks_sync');
  });
});
