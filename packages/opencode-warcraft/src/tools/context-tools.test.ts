import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type {
  AgentsMdService,
  BvTriageService,
  ContextService,
  FeatureService,
  PlanService,
  StaleWorktreeInfo,
  TaskService,
  WorktreeService,
} from 'warcraft-core';
import { ContextTools } from './context-tools.js';

const TEST_DIR = `/tmp/opencode-warcraft-context-tools-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createMockDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const featureService = {
    get: () => ({
      name: 'test-feature',
      status: 'executing',
      ticket: null,
      createdAt: '2025-01-01T00:00:00Z',
    }),
    list: () => ['test-feature'],
  } as unknown as FeatureService;

  const planService = {
    read: () => ({ content: '# Plan', approved: true }),
  } as unknown as PlanService;

  const taskService = {
    list: () => [],
    getRawStatus: () => null,
    computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
  } as unknown as TaskService;

  const contextService = {
    list: () => [],
  } as unknown as ContextService;

  const agentsMdService = {} as unknown as AgentsMdService;

  const worktreeService = {
    listAll: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
  } as unknown as WorktreeService;

  const checkBlocked = () => ({ blocked: false }) as { blocked: false };

  const bvTriageService = {
    getBlockerTriageDetails: () => null,
    getGlobalTriageDetails: () => null,
    getHealth: () => ({ enabled: false, available: false, lastError: null }),
  } as unknown as BvTriageService;

  return {
    featureService,
    planService,
    taskService,
    contextService,
    agentsMdService,
    worktreeService,
    checkBlocked,
    bvTriageService,
    projectRoot: TEST_DIR,
    ...overrides,
  };
}

describe('ContextTools', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe('warcraft_status health field', () => {
    it('includes top-level health with expected keys when no event data exists', async () => {
      const deps = createMockDeps();
      const contextTools = new ContextTools(deps);
      const tool = contextTools.getStatusTool(() => 'test-feature');

      const rawResult = await tool.execute({ feature: 'test-feature' });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.data.health).toBeDefined();
      expect(result.data.health).toEqual({
        reopenRate: 0,
        totalCompleted: 0,
        reopenCount: 0,
        blockedMttrMs: null,
      });
    });

    it('includes health with computed values when event data exists', async () => {
      // Write events.jsonl with some events to compute metrics from
      const beadsDir = path.join(TEST_DIR, '.beads');
      fs.mkdirSync(beadsDir, { recursive: true });
      const events = [
        {
          type: 'commit',
          feature: 'f',
          task: 't1',
          timestamp: '2025-01-01T00:00:00Z',
          details: { status: 'completed' },
        },
        {
          type: 'commit',
          feature: 'f',
          task: 't2',
          timestamp: '2025-01-01T01:00:00Z',
          details: { status: 'completed' },
        },
        { type: 'reopen', feature: 'f', task: 't1', timestamp: '2025-01-01T02:00:00Z' },
      ];
      fs.writeFileSync(path.join(beadsDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const deps = createMockDeps();
      const contextTools = new ContextTools(deps);
      const tool = contextTools.getStatusTool(() => 'test-feature');

      const rawResult = await tool.execute({ feature: 'test-feature' });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      expect(result.data.health).toBeDefined();
      expect(result.data.health.reopenRate).toBe(0.5); // 1 reopen / 2 completed
      expect(result.data.health.totalCompleted).toBe(2);
      expect(result.data.health.reopenCount).toBe(1);
      expect(result.data.health.blockedMttrMs).toBeNull();
    });

    it('health is sibling of feature, plan, tasks, context, worktreeHygiene, nextAction', async () => {
      const deps = createMockDeps();
      const contextTools = new ContextTools(deps);
      const tool = contextTools.getStatusTool(() => 'test-feature');

      const rawResult = await tool.execute({ feature: 'test-feature' });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      const dataKeys = Object.keys(result.data);
      expect(dataKeys).toContain('feature');
      expect(dataKeys).toContain('plan');
      expect(dataKeys).toContain('tasks');
      expect(dataKeys).toContain('context');
      expect(dataKeys).toContain('worktreeHygiene');
      expect(dataKeys).toContain('nextAction');
      expect(dataKeys).toContain('health');
    });

    it('health only includes the 4 required keys', async () => {
      const deps = createMockDeps();
      const contextTools = new ContextTools(deps);
      const tool = contextTools.getStatusTool(() => 'test-feature');

      const rawResult = await tool.execute({ feature: 'test-feature' });
      const result = JSON.parse(rawResult);

      expect(result.success).toBe(true);
      const healthKeys = Object.keys(result.data.health);
      expect(healthKeys.sort()).toEqual(['blockedMttrMs', 'reopenCount', 'reopenRate', 'totalCompleted']);
    });
  });
});
