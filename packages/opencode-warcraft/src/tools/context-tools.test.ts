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
import { ContextTools } from './context-tools.js';

const TEST_DIR = `/tmp/opencode-warcraft-context-tools-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function writeEventsJsonl(events: Record<string, unknown>[]): void {
  const beadsDir = path.join(TEST_DIR, '.beads');
  fs.mkdirSync(beadsDir, { recursive: true });
  fs.writeFileSync(path.join(beadsDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
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

async function getStatusHealth(overrides: Partial<Record<string, unknown>> = {}): Promise<{
  success: boolean;
  data: {
    health: { reopenRate: number; totalCompleted: number; reopenCount: number; blockedMttrMs: number | null };
    feature: unknown;
    plan: unknown;
    tasks: unknown;
    context: unknown;
    worktreeHygiene: unknown;
    nextAction: string;
  };
}> {
  const deps = createMockDeps(overrides);
  const contextTools = new ContextTools(deps);
  const tool = contextTools.getStatusTool(() => 'test-feature');
  const rawResult = await tool.execute({ feature: 'test-feature' });
  return JSON.parse(rawResult);
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
      const result = await getStatusHealth();

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
      writeEventsJsonl([
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
      ]);

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      expect(result.data.health).toBeDefined();
      expect(result.data.health.reopenRate).toBe(0.5); // 1 reopen / 2 completed
      expect(result.data.health.totalCompleted).toBe(2);
      expect(result.data.health.reopenCount).toBe(1);
      expect(result.data.health.blockedMttrMs).toBeNull();
    });

    it('health is sibling of feature, plan, tasks, context, worktreeHygiene, nextAction', async () => {
      const result = await getStatusHealth();

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
      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      const healthKeys = Object.keys(result.data.health);
      expect(healthKeys.sort()).toEqual(['blockedMttrMs', 'reopenCount', 'reopenRate', 'totalCompleted']);
    });

    it('health returns defaults when .beads directory does not exist', async () => {
      // Remove the .beads directory entirely to simulate a fresh project
      const beadsDir = path.join(TEST_DIR, '.beads');
      if (fs.existsSync(beadsDir)) {
        fs.rmSync(beadsDir, { recursive: true });
      }

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      expect(result.data.health).toEqual({
        reopenRate: 0,
        totalCompleted: 0,
        reopenCount: 0,
        blockedMttrMs: null,
      });
    });

    it('health does not expose excluded metric keys', async () => {
      // Write events that produce non-zero values for excluded metrics
      writeEventsJsonl([
        {
          type: 'commit',
          feature: 'f',
          task: 't1',
          timestamp: '2025-01-01T00:00:00Z',
          details: { status: 'completed' },
        },
        { type: 'duplicate_dispatch_prevented', feature: 'f', task: 't1', timestamp: '2025-01-01T01:00:00Z' },
        { type: 'prune', feature: 'f', task: '', timestamp: '2025-01-01T02:00:00Z', details: { dryRun: true } },
        { type: 'prune', feature: 'f', task: '', timestamp: '2025-01-01T03:00:00Z', details: { confirmed: true } },
      ]);

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      const healthKeys = Object.keys(result.data.health);
      // Excluded per plan non-goals
      expect(healthKeys).not.toContain('duplicateDispatchPreventedCount');
      expect(healthKeys).not.toContain('pruneDryRunCount');
      expect(healthKeys).not.toContain('pruneConfirmedCount');
      expect(healthKeys).not.toContain('pruneAcceptanceRate');
    });

    it('health returns blockedMttrMs as a number when blocked/commit pairs exist', async () => {
      writeEventsJsonl([
        { type: 'blocked', feature: 'f', task: 't1', timestamp: '2025-06-01T10:00:00.000Z' },
        {
          type: 'commit',
          feature: 'f',
          task: 't1',
          timestamp: '2025-06-01T10:15:00.000Z',
          details: { status: 'completed' },
        },
      ]);

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      expect(typeof result.data.health.blockedMttrMs).toBe('number');
      // 15 minutes = 900000ms
      expect(result.data.health.blockedMttrMs).toBe(900000);
    });

    it('health reflects deterministic values from a complex fixture', async () => {
      // Fixture: 4 completions, 2 reopens, 2 blocked/resolved pairs (5min + 15min avg = 10min)
      writeEventsJsonl([
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
        {
          type: 'commit',
          feature: 'f',
          task: 't3',
          timestamp: '2025-01-01T02:00:00Z',
          details: { status: 'completed' },
        },
        {
          type: 'commit',
          feature: 'f',
          task: 't4',
          timestamp: '2025-01-01T03:00:00Z',
          details: { status: 'completed' },
        },
        { type: 'reopen', feature: 'f', task: 't1', timestamp: '2025-01-01T04:00:00Z' },
        { type: 'reopen', feature: 'f', task: 't2', timestamp: '2025-01-01T05:00:00Z' },
        // Blocked/resolved pair 1: 5 minutes
        { type: 'blocked', feature: 'f', task: 't5', timestamp: '2025-01-01T06:00:00.000Z' },
        {
          type: 'commit',
          feature: 'f',
          task: 't5',
          timestamp: '2025-01-01T06:05:00.000Z',
          details: { status: 'completed' },
        },
        // Blocked/resolved pair 2: 15 minutes
        { type: 'blocked', feature: 'f', task: 't6', timestamp: '2025-01-01T07:00:00.000Z' },
        {
          type: 'commit',
          feature: 'f',
          task: 't6',
          timestamp: '2025-01-01T07:15:00.000Z',
          details: { status: 'completed' },
        },
      ]);

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      // 6 total completed (t1-t4 + t5 + t6)
      expect(result.data.health.totalCompleted).toBe(6);
      expect(result.data.health.reopenCount).toBe(2);
      // reopenRate = 2 reopens / 6 completed
      expect(result.data.health.reopenRate).toBeCloseTo(2 / 6);
      // MTTR avg of 300000ms (5min) and 900000ms (15min) = 600000ms (10min)
      expect(result.data.health.blockedMttrMs).toBe(600000);
    });

    it('health value types are correct', async () => {
      // With no events, verify types of default values
      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      expect(typeof result.data.health.reopenRate).toBe('number');
      expect(typeof result.data.health.totalCompleted).toBe('number');
      expect(typeof result.data.health.reopenCount).toBe('number');
      // blockedMttrMs is null when no blocked pairs exist
      expect(result.data.health.blockedMttrMs).toBeNull();
    });

    it('health value types with event data produce number for blockedMttrMs', async () => {
      writeEventsJsonl([
        { type: 'blocked', feature: 'f', task: 't1', timestamp: '2025-01-01T00:00:00.000Z' },
        {
          type: 'commit',
          feature: 'f',
          task: 't1',
          timestamp: '2025-01-01T00:10:00.000Z',
          details: { status: 'completed' },
        },
      ]);

      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      expect(typeof result.data.health.reopenRate).toBe('number');
      expect(typeof result.data.health.totalCompleted).toBe('number');
      expect(typeof result.data.health.reopenCount).toBe('number');
      expect(typeof result.data.health.blockedMttrMs).toBe('number');
    });

    it('existing status fields are not altered by health addition', async () => {
      const result = await getStatusHealth();

      expect(result.success).toBe(true);
      // Verify existing fields retain their expected structure
      expect(result.data.feature).toEqual({
        name: 'test-feature',
        status: 'executing',
        ticket: null,
        createdAt: '2025-01-01T00:00:00Z',
      });
      expect(result.data.plan).toEqual({
        exists: true,
        status: 'locked',
        approved: true,
      });
      expect(result.data.tasks).toBeDefined();
      expect(result.data.tasks).toHaveProperty('total');
      expect(result.data.tasks).toHaveProperty('pending');
      expect(result.data.tasks).toHaveProperty('inProgress');
      expect(result.data.tasks).toHaveProperty('done');
      expect(result.data.tasks).toHaveProperty('list');
      expect(result.data.tasks).toHaveProperty('runnable');
      expect(result.data.tasks).toHaveProperty('blockedBy');
      expect(result.data.context).toEqual({
        fileCount: 0,
        files: [],
      });
      expect(typeof result.data.nextAction).toBe('string');
    });
  });
});
