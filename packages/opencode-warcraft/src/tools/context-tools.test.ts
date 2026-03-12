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
  fs.writeFileSync(path.join(beadsDir, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
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
    staleDispatches: Array<{
      folder: string;
      name: string;
      preparedAt: string;
      staleForSeconds: number;
      hint: string;
    }> | null;
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

  describe('warcraft_context_write', () => {
    function createAppendAwareContextService() {
      const files = new Map<string, string>();
      const normalizeEntry = (value: string): string =>
        value.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');

      const contextService = {
        write: (_feature: string, name: string, content: string, mode: 'replace' | 'append' = 'replace') => {
          const normalizedContent = normalizeEntry(content);
          if (mode === 'append') {
            const existing = files.get(name);
            files.set(name, existing ? `${existing}\n\n${normalizedContent}` : normalizedContent);
          } else {
            files.set(name, content);
          }

          return `/repo/.beads/artifacts/test-feature/context/${name}.md`;
        },
        list: () => [],
      } as unknown as ContextService;

      return { contextService, files };
    }

    it('returns the resolved file path in the success message', async () => {
      const contextService = {
        write: () => '/repo/.beads/artifacts/test-feature/context/notes.md',
        list: () => [],
      } as unknown as ContextService;

      const tool = new ContextTools(createMockDeps({ contextService })).writeContextTool(() => 'test-feature');
      const result = JSON.parse(await tool.execute({ name: 'notes', content: 'hello', feature: 'test-feature' }));

      expect(result).toEqual({
        success: true,
        data: {
          message: 'Context file written:\n/repo/.beads/artifacts/test-feature/context/notes.md',
        },
      });
    });

    it('creates a missing file when append mode is requested', async () => {
      const { contextService, files } = createAppendAwareContextService();
      const tool = new ContextTools(createMockDeps({ contextService })).writeContextTool(() => 'test-feature');

      await tool.execute({
        name: 'execution-decisions',
        content: '### 2026-03-12\n- Decision: proceed sequentially',
        mode: 'append',
        feature: 'test-feature',
      });

      expect(files.get('execution-decisions')).toBe('### 2026-03-12\n- Decision: proceed sequentially');
    });

    it('appends new entries with a single blank line separator', async () => {
      const { contextService, files } = createAppendAwareContextService();
      const tool = new ContextTools(createMockDeps({ contextService })).writeContextTool(() => 'test-feature');

      await tool.execute({
        name: 'execution-decisions',
        content: '### 2026-03-12\n- Decision: proceed sequentially',
        mode: 'append',
        feature: 'test-feature',
      });
      await tool.execute({
        name: 'execution-decisions',
        content: '\n\n### 2026-03-13\n- Decision: parallelize review',
        mode: 'append',
        feature: 'test-feature',
      });

      expect(files.get('execution-decisions')).toBe(
        '### 2026-03-12\n- Decision: proceed sequentially\n\n### 2026-03-13\n- Decision: parallelize review',
      );
    });

    it('preserves warning text in the success message when the context budget is exceeded', async () => {
      const contextService = {
        write: () =>
          '/repo/.beads/artifacts/test-feature/context/notes.md\n\n⚠️ Context total: 21000 chars (exceeds 20,000 char budget). Consider moving older notes into a smaller context file or deleting stale context files before writing more.',
        list: () => [],
      } as unknown as ContextService;

      const tool = new ContextTools(createMockDeps({ contextService })).writeContextTool(() => 'test-feature');
      const result = JSON.parse(await tool.execute({ name: 'notes', content: 'hello', feature: 'test-feature' }));

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('/repo/.beads/artifacts/test-feature/context/notes.md');
      expect(result.data.message).toContain('⚠️ Context total: 21000 chars');
      expect(result.data.message).toContain('smaller context file');
      expect(result.data.message).not.toContain('contextService.archive()');
    });

    it('returns a standard error response when feature resolution fails', async () => {
      let writeCalled = false;
      const contextService = {
        write: () => {
          writeCalled = true;
          return '/repo/should-not-write.md';
        },
        list: () => [],
      } as unknown as ContextService;

      const tool = new ContextTools(createMockDeps({ contextService })).writeContextTool(() => null);
      const result = JSON.parse(await tool.execute({ name: 'notes', content: 'hello' }));

      expect(result).toEqual({
        success: false,
        error: 'No feature specified. Create a feature or provide feature param.',
      });
      expect(writeCalled).toBe(false);
    });
  });

  describe('warcraft_status task workspace summaries', () => {
    it('returns blocked feature details instead of failing the tool when the feature is blocked', async () => {
      const taskService = {
        list: () => [{ folder: '01-task', name: 'Blocked Task', status: 'blocked' as const, origin: 'plan' as const }],
        getRawStatus: () => ({
          dependsOn: ['00-prereq'],
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/blocked' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({
        taskService,
        checkBlocked: () => ({
          blocked: true,
          reason: 'Awaiting operator decision',
          message: 'Feature is blocked',
          blockedPath: '/repo/docs/test-feature/BLOCKED',
        }),
      });
      const tasks = result.data.tasks as {
        blockedFeature: {
          feature: string;
          reason: string | null;
          blockedPath: string | null;
          tasks: Array<{
            folder: string;
            name: string;
            status: string;
            dependsOn: string[] | null;
            workspace: { mode: string; path: string | null; hasChanges: boolean | null } | null;
          }>;
        } | null;
      };

      expect(result.success).toBe(true);
      expect(tasks.blockedFeature).toEqual({
        feature: 'test-feature',
        reason: 'Awaiting operator decision',
        blockedPath: '/repo/docs/test-feature/BLOCKED',
        tasks: [
          {
            folder: '01-task',
            name: 'Blocked Task',
            status: 'blocked',
            origin: 'plan',
            dependsOn: ['00-prereq'],
            workspace: { mode: 'direct', path: '/repo/blocked', hasChanges: null },
          },
        ],
      });
    });

    it('returns a successful status payload for blocked features while preserving blocked-task parity fields', async () => {
      const taskService = {
        list: () => [
          { folder: '01-blocked', name: 'Blocked Task', status: 'blocked' as const, origin: 'plan' as const },
          { folder: '02-pending', name: 'Pending Task', status: 'pending' as const, origin: 'plan' as const },
        ],
        getRawStatus: (_feature: string, folder: string) =>
          folder === '01-blocked'
            ? {
                dependsOn: ['00-prereq'],
                workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/blocked-workspace' },
              }
            : null,
        computeRunnableStatus: () => ({ runnable: [], blocked: { '02-pending': ['01-blocked'] } }),
      } as unknown as TaskService;

      const result = await getStatusHealth({
        taskService,
        checkBlocked: () => ({
          blocked: true,
          reason: 'Awaiting operator decision',
          message: 'Feature is blocked',
          blockedPath: '/repo/docs/test-feature/BLOCKED',
        }),
      });

      expect(result.success).toBe(true);
      expect(result).not.toHaveProperty('error');
      expect(result.data.tasks.blockedFeature).toEqual({
        feature: 'test-feature',
        reason: 'Awaiting operator decision',
        blockedPath: '/repo/docs/test-feature/BLOCKED',
        tasks: [
          {
            folder: '01-blocked',
            name: 'Blocked Task',
            status: 'blocked',
            origin: 'plan',
            dependsOn: ['00-prereq'],
            workspace: { mode: 'direct', path: '/repo/blocked-workspace', hasChanges: null },
          },
        ],
      });
      expect(result.data.tasks.blockedBy).toEqual({ '02-pending': ['01-blocked'] });
      expect(result.data.tasks.list).toEqual([
        {
          folder: '01-blocked',
          name: 'Blocked Task',
          status: 'blocked',
          origin: 'plan',
          dependsOn: ['00-prereq'],
          workspace: { mode: 'direct', path: '/repo/blocked-workspace', hasChanges: null },
        },
        {
          folder: '02-pending',
          name: 'Pending Task',
          status: 'pending',
          origin: 'plan',
          dependsOn: null,
          workspace: null,
        },
      ]);
      expect(result.data.nextAction).toBe(
        'Pending tasks exist but are blocked by dependencies. Check blockedBy for details.',
      );
    });

    it('keeps blocked tasks visible with their persisted workspace details', async () => {
      const taskService = {
        list: () => [{ folder: '01-task', name: 'Task', status: 'blocked' as const, origin: 'plan' as const }],
        getRawStatus: () => ({
          dependsOn: ['00-prereq'],
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });
      const tasks = result.data.tasks as {
        total: number;
        pending: number;
        inProgress: number;
        done: number;
        list: Array<{
          folder: string;
          status: string;
          workspace: { mode: string; path: string | null; hasChanges: boolean | null } | null;
          dependsOn: string[] | null;
        }>;
      };

      expect(tasks.total).toBe(1);
      expect(tasks.pending).toBe(0);
      expect(tasks.inProgress).toBe(0);
      expect(tasks.done).toBe(0);
      expect(tasks.list).toHaveLength(1);
      expect(tasks.list[0]).toMatchObject({
        folder: '01-task',
        status: 'blocked',
        dependsOn: ['00-prereq'],
        workspace: { mode: 'direct', path: '/repo/root', hasChanges: null },
      });
      expect((result.data.tasks as { blockedFeature: unknown }).blockedFeature).toBeNull();
    });

    it('keeps blocked tasks visible while continuing to prioritize other active work', async () => {
      const taskService = {
        list: () => [
          { folder: '01-blocked', name: 'Blocked Task', status: 'blocked' as const, origin: 'plan' as const },
          { folder: '02-active', name: 'Active Task', status: 'in_progress' as const, origin: 'plan' as const },
        ],
        getRawStatus: (_feature: string, folder: string) =>
          folder === '01-blocked'
            ? {
                dependsOn: ['00-prereq'],
                workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/blocked' },
              }
            : {
                workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/active' },
              },
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });
      const tasks = result.data.tasks as {
        total: number;
        pending: number;
        inProgress: number;
        done: number;
        list: Array<{
          folder: string;
          status: string;
          workspace: { mode: string; path: string | null; hasChanges: boolean | null } | null;
        }>;
      };

      expect(tasks.total).toBe(2);
      expect(tasks.pending).toBe(0);
      expect(tasks.inProgress).toBe(1);
      expect(tasks.done).toBe(0);
      expect(tasks.list).toEqual([
        {
          folder: '01-blocked',
          name: 'Blocked Task',
          status: 'blocked',
          origin: 'plan',
          dependsOn: ['00-prereq'],
          workspace: { mode: 'direct', path: '/repo/blocked', hasChanges: null },
        },
        {
          folder: '02-active',
          name: 'Active Task',
          status: 'in_progress',
          origin: 'plan',
          dependsOn: null,
          workspace: { mode: 'direct', path: '/repo/active', hasChanges: null },
        },
      ]);
      expect(result.data.nextAction).toBe('Continue work on task: 02-active');
    });

    it('reports direct workspace details without probing worktrees', async () => {
      let getCalled = false;
      let hasChangesCalled = false;
      const taskService = {
        list: () => [{ folder: '01-task', name: 'Task', status: 'in_progress' as const, origin: 'plan' as const }],
        getRawStatus: () => ({
          dependsOn: ['00-prereq'],
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;
      const worktreeService = {
        listAll: () => Promise.resolve([]),
        get: async () => {
          getCalled = true;
          return null;
        },
        hasUncommittedChanges: async () => {
          hasChangesCalled = true;
          return false;
        },
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ taskService, worktreeService });
      const tasks = result.data.tasks as {
        list: Array<{
          folder: string;
          workspace: { mode: string; path: string | null; hasChanges: boolean | null } | null;
          dependsOn: string[] | null;
        }>;
      };

      expect(tasks.list).toHaveLength(1);
      expect(tasks.list[0]).toMatchObject({
        folder: '01-task',
        dependsOn: ['00-prereq'],
        workspace: { mode: 'direct', path: '/repo/root', hasChanges: null },
      });
      expect(getCalled).toBe(false);
      expect(hasChangesCalled).toBe(false);
    });

    it('counts dispatch_prepared tasks as active work and recommends continuing them first', async () => {
      const taskService = {
        list: () => [
          { folder: '01-task', name: 'Task', status: 'dispatch_prepared' as const, origin: 'plan' as const },
        ],
        getRawStatus: () => ({
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });
      const tasks = result.data.tasks as {
        total: number;
        pending: number;
        inProgress: number;
        done: number;
        list: Array<{ folder: string; status: string }>;
      };

      expect(tasks.total).toBe(1);
      expect(tasks.pending).toBe(0);
      expect(tasks.inProgress).toBe(1);
      expect(tasks.done).toBe(0);
      expect(tasks.list[0]).toMatchObject({
        folder: '01-task',
        status: 'dispatch_prepared',
      });
      expect(result.data.nextAction).toBe('Continue work on task: 01-task');
    });

    it('treats dispatch_prepared tasks as active before suggesting runnable pending work', async () => {
      const taskService = {
        list: () => [
          { folder: '01-task', name: 'Prepared Task', status: 'dispatch_prepared' as const, origin: 'plan' as const },
          { folder: '02-task', name: 'Pending Task', status: 'pending' as const, origin: 'plan' as const },
        ],
        getRawStatus: (_feature: string, folder: string) => ({
          workerSession:
            folder === '01-task' ? { workspaceMode: 'direct' as const, workspacePath: '/repo/root' } : undefined,
        }),
        computeRunnableStatus: () => ({ runnable: ['02-task'], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });
      const tasks = result.data.tasks as {
        pending: number;
        inProgress: number;
      };

      expect(tasks.pending).toBe(1);
      expect(tasks.inProgress).toBe(1);
      expect(result.data.nextAction).toBe('Continue work on task: 01-task');
    });
  });

  describe('warcraft_agents_md', () => {
    function getAgentsMdTool(overrides: Partial<Record<string, unknown>> = {}) {
      return new ContextTools(createMockDeps(overrides)).agentsMdTool();
    }

    it('init existing-file branch explicitly says preview-only and non-mutating', async () => {
      const agentsMdService = {
        init: async () => ({ existed: true, content: '# Existing' }),
      } as unknown as AgentsMdService;

      const result = JSON.parse(await getAgentsMdTool({ agentsMdService }).execute({ action: 'init' }));

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('preview-only');
      expect(result.data.message).toContain('did not modify AGENTS.md');
    });

    it('init generated branch explicitly says preview-only and non-mutating', async () => {
      const agentsMdService = {
        init: async () => ({ existed: false, content: '# Generated' }),
      } as unknown as AgentsMdService;

      const result = JSON.parse(await getAgentsMdTool({ agentsMdService }).execute({ action: 'init' }));

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('Generated AGENTS.md preview');
      expect(result.data.message).toContain('did NOT modify AGENTS.md');
    });

    it('sync no-op branch explicitly says there are no new actionable findings and that nothing was modified', async () => {
      const agentsMdService = {
        sync: async () => ({ proposals: [], diff: '' }),
      } as unknown as AgentsMdService;

      const result = JSON.parse(
        await getAgentsMdTool({ agentsMdService }).execute({ action: 'sync', feature: 'test-feature' }),
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('No new actionable findings');
      expect(result.data.message).toContain('did not modify AGENTS.md');
    });

    it('sync proposal branch explicitly says preview-only and non-mutating', async () => {
      const agentsMdService = {
        sync: async () => ({ proposals: ['Prefer async/await'], diff: '+ Prefer async/await' }),
      } as unknown as AgentsMdService;

      const result = JSON.parse(
        await getAgentsMdTool({ agentsMdService }).execute({ action: 'sync', feature: 'test-feature' }),
      );

      expect(result.success).toBe(true);
      expect(result.data.message).toContain('preview updates');
      expect(result.data.message).toContain('did NOT modify AGENTS.md');
    });

    it('apply rejects whitespace-only content', async () => {
      let applyCalled = false;
      const agentsMdService = {
        apply: () => {
          applyCalled = true;
          return { path: '/tmp/AGENTS.md', chars: 0, isNew: false };
        },
      } as unknown as AgentsMdService;

      const result = JSON.parse(
        await getAgentsMdTool({ agentsMdService }).execute({ action: 'apply', content: '   ' }),
      );

      expect(result).toEqual({
        success: false,
        error:
          'content required for apply action. Use init or sync first to get content, then apply with the approved content.',
      });
      expect(applyCalled).toBe(false);
    });

    it('apply reports whether AGENTS.md was created or updated', async () => {
      const createdService = {
        apply: () => ({ path: '/tmp/AGENTS.md', chars: 12, isNew: true }),
      } as unknown as AgentsMdService;
      const updatedService = {
        apply: () => ({ path: '/tmp/AGENTS.md', chars: 20, isNew: false }),
      } as unknown as AgentsMdService;

      const created = JSON.parse(
        await getAgentsMdTool({ agentsMdService: createdService }).execute({ action: 'apply', content: '# Content' }),
      );
      const updated = JSON.parse(
        await getAgentsMdTool({ agentsMdService: updatedService }).execute({ action: 'apply', content: '# Content 2' }),
      );

      expect(created.data.message).toContain('AGENTS.md created');
      expect(updated.data.message).toContain('AGENTS.md updated');
    });
  });

  describe('stale worktree age context', () => {
    it('includes ageInDays for stale worktrees with known lastCommitAge', async () => {
      const threeDaysMs = 3 * 86_400_000;
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: 'abc123',
              feature: 'feat',
              step: 'step1',
              isStale: true,
              lastCommitAge: threeDaysMs,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      expect(result.data.worktreeHygiene).not.toBeNull();
      const hygiene = result.data.worktreeHygiene as {
        count: number;
        message: string;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      expect(hygiene.count).toBe(1);
      expect(hygiene.worktrees[0].ageInDays).toBe(3);
    });

    it('omits ageInDays when lastCommitAge is null', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: '',
              feature: 'feat',
              step: 'step1',
              isStale: true,
              lastCommitAge: null,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        count: number;
        message: string;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      expect(hygiene.worktrees[0]).not.toHaveProperty('ageInDays');
    });

    it('includes oldest stale age and actionable guidance in warning message', async () => {
      const fiveDaysMs = 5 * 86_400_000;
      const twoDaysMs = 2 * 86_400_000;
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: 'abc123',
              feature: 'feat',
              step: 'step1',
              isStale: true,
              lastCommitAge: fiveDaysMs,
            },
            {
              path: '/tmp/wt/feat/step2',
              branch: 'warcraft/feat/step2',
              commit: 'def456',
              feature: 'feat',
              step: 'step2',
              isStale: true,
              lastCommitAge: twoDaysMs,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        count: number;
        message: string;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      expect(hygiene.message).toContain('oldest: 5 days');
      expect(hygiene.message).toContain('warcraft_worktree_prune');
      expect(hygiene.message).toContain('warcraft_merge');
      expect(hygiene.message).toContain('cleanup: true');
    });

    it('uses floor for ageInDays computation', async () => {
      // 2.9 days should floor to 2
      const almostThreeDaysMs = 2.9 * 86_400_000;
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: 'abc123',
              feature: 'feat',
              step: 'step1',
              isStale: true,
              lastCommitAge: almostThreeDaysMs,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        count: number;
        message: string;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      expect(hygiene.worktrees[0].ageInDays).toBe(2);
    });

    it('worktreeHygiene is null when no stale worktrees exist', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: 'abc123',
              feature: 'feat',
              step: 'step1',
              isStale: false,
              lastCommitAge: 1000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      expect(result.data.worktreeHygiene).toBeNull();
    });

    it('preserves existing worktree fields (feature, step, path) in stale response', async () => {
      const oneDayMs = 86_400_000;
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/my-feat/my-step',
              branch: 'warcraft/my-feat/my-step',
              commit: 'abc',
              feature: 'my-feat',
              step: 'my-step',
              isStale: true,
              lastCommitAge: oneDayMs,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        count: number;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      expect(hygiene.worktrees[0].feature).toBe('my-feat');
      expect(hygiene.worktrees[0].step).toBe('my-step');
      expect(hygiene.worktrees[0].path).toBe('/tmp/wt/my-feat/my-step');
      expect(hygiene.worktrees[0].ageInDays).toBe(1);
    });
  });

  describe('stale warning payload shape and content', () => {
    it('stale warning has exactly the keys: count, message, worktrees', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/step1',
              branch: 'warcraft/feat/step1',
              commit: 'abc123',
              feature: 'feat',
              step: 'step1',
              isStale: true,
              lastCommitAge: 2 * 86_400_000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      expect(result.data.worktreeHygiene).not.toBeNull();
      const hygiene = result.data.worktreeHygiene as Record<string, unknown>;
      const keys = Object.keys(hygiene).sort();
      expect(keys).toEqual(['count', 'message', 'worktrees']);
    });

    it('each worktree entry has exactly feature, step, path, and ageInDays when age is known', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: 'abc',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: 86_400_000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        worktrees: Array<Record<string, unknown>>;
      };
      const entryKeys = Object.keys(hygiene.worktrees[0]).sort();
      expect(entryKeys).toEqual(['ageInDays', 'feature', 'path', 'step']);
    });

    it('worktree entry without lastCommitAge has exactly feature, step, path (no ageInDays)', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: '',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: null,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        worktrees: Array<Record<string, unknown>>;
      };
      const entryKeys = Object.keys(hygiene.worktrees[0]).sort();
      expect(entryKeys).toEqual(['feature', 'path', 'step']);
    });

    it('message uses singular "day" when oldest worktree is exactly 1 day old', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: 'abc',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: 86_400_000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as { message: string };
      expect(hygiene.message).toContain('oldest: 1 day');
      expect(hygiene.message).not.toContain('1 days');
    });

    it('message uses plural "days" when oldest worktree is more than 1 day old', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: 'abc',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: 3 * 86_400_000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as { message: string };
      expect(hygiene.message).toContain('oldest: 3 days');
    });

    it('worktreeHygiene is null when worktreeService returns empty array', async () => {
      const worktreeService = {
        listAll: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      expect(result.data.worktreeHygiene).toBeNull();
    });

    it('worktreeHygiene is null with default mock (no stale worktrees)', async () => {
      // Default createMockDeps returns empty array from listAll
      const result = await getStatusHealth();

      expect(result.data.worktreeHygiene).toBeNull();
    });

    it('count matches the number of stale worktrees excluding non-stale ones', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: 'abc',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: 7 * 86_400_000,
            },
            {
              path: '/tmp/wt/feat/s2',
              branch: 'warcraft/feat/s2',
              commit: 'def',
              feature: 'feat',
              step: 's2',
              isStale: true,
              lastCommitAge: 2 * 86_400_000,
            },
            {
              path: '/tmp/wt/feat/s3',
              branch: 'warcraft/feat/s3',
              commit: 'ghi',
              feature: 'feat',
              step: 's3',
              isStale: false,
              lastCommitAge: 1000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as {
        count: number;
        message: string;
        worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
      };
      // Only 2 stale worktrees (s3 is not stale)
      expect(hygiene.count).toBe(2);
      expect(hygiene.worktrees).toHaveLength(2);
      expect(hygiene.worktrees[0].ageInDays).toBe(7);
      expect(hygiene.worktrees[1].ageInDays).toBe(2);
      // Oldest is 7 days
      expect(hygiene.message).toContain('oldest: 7 days');
      expect(hygiene.message).toContain('2 stale worktree(s)');
    });

    it('message omits age part when all stale worktrees have null lastCommitAge', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: '',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: null,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as { message: string };
      // No "(oldest: N day(s))" when age is unknown
      expect(hygiene.message).not.toContain('oldest');
      // But still contains the actionable guidance
      expect(hygiene.message).toContain('warcraft_worktree_prune');
      expect(hygiene.message).toContain('warcraft_merge');
    });

    it('message starts with the stale count and includes full actionable guidance', async () => {
      const worktreeService = {
        listAll: () =>
          Promise.resolve([
            {
              path: '/tmp/wt/feat/s1',
              branch: 'warcraft/feat/s1',
              commit: 'abc',
              feature: 'feat',
              step: 's1',
              isStale: true,
              lastCommitAge: 4 * 86_400_000,
            },
            {
              path: '/tmp/wt/feat/s2',
              branch: 'warcraft/feat/s2',
              commit: 'def',
              feature: 'feat',
              step: 's2',
              isStale: true,
              lastCommitAge: 1 * 86_400_000,
            },
          ]),
        get: () => Promise.resolve(null),
      } as unknown as WorktreeService;

      const result = await getStatusHealth({ worktreeService });

      const hygiene = result.data.worktreeHygiene as { message: string };
      // Message format: "{N} stale worktree(s) detected (oldest: M day(s)). Run warcraft_worktree_prune ... or use warcraft_merge with cleanup: true ..."
      expect(hygiene.message).toMatch(/^2 stale worktree\(s\) detected/);
      expect(hygiene.message).toContain('oldest: 4 days');
      expect(hygiene.message).toContain('Run warcraft_worktree_prune to review and clean up');
      expect(hygiene.message).toContain('warcraft_merge with cleanup: true');
    });
  });

  describe('stale dispatch_prepared detection', () => {
    it('detects tasks stuck in dispatch_prepared for more than 60 seconds', async () => {
      const staleTimestamp = new Date(Date.now() - 90_000).toISOString(); // 90s ago
      const taskService = {
        list: () => [{ folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' }],
        getRawStatus: () => ({
          status: 'dispatch_prepared',
          origin: 'plan',
          preparedAt: staleTimestamp,
          workerSession: { sessionId: 'sess-1', workspaceMode: 'worktree' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });

      expect(result.data).toHaveProperty('staleDispatches');
      const staleDispatches = result.data.staleDispatches as Array<{
        folder: string;
        name: string;
        preparedAt: string;
        staleForSeconds: number;
        hint: string;
      }>;
      expect(staleDispatches).toHaveLength(1);
      expect(staleDispatches[0].folder).toBe('01-setup');
      expect(staleDispatches[0].name).toBe('Setup');
      expect(staleDispatches[0].preparedAt).toBe(staleTimestamp);
      expect(staleDispatches[0].staleForSeconds).toBeGreaterThanOrEqual(90);
      expect(staleDispatches[0].hint).toContain('dispatch_prepared');
      expect(staleDispatches[0].hint).toContain('>60s');
    });

    it('does not flag dispatch_prepared tasks within 60 seconds', async () => {
      const recentTimestamp = new Date(Date.now() - 30_000).toISOString(); // 30s ago
      const taskService = {
        list: () => [{ folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' }],
        getRawStatus: () => ({
          status: 'dispatch_prepared',
          origin: 'plan',
          preparedAt: recentTimestamp,
          workerSession: { sessionId: 'sess-1', workspaceMode: 'worktree' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });

      const staleDispatches = (result.data as Record<string, unknown>).staleDispatches;
      expect(staleDispatches).toBeNull();
    });

    it('does not flag dispatch_prepared tasks without preparedAt', async () => {
      const taskService = {
        list: () => [{ folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' }],
        getRawStatus: () => ({
          status: 'dispatch_prepared',
          origin: 'plan',
          workerSession: { sessionId: 'sess-1', workspaceMode: 'worktree' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });

      const staleDispatches = (result.data as Record<string, unknown>).staleDispatches;
      expect(staleDispatches).toBeNull();
    });

    it('includes recovery hint suggesting retry or reset to pending', async () => {
      const staleTimestamp = new Date(Date.now() - 120_000).toISOString(); // 2min ago
      const taskService = {
        list: () => [{ folder: '02-core', name: 'Core API', status: 'dispatch_prepared', origin: 'plan' }],
        getRawStatus: () => ({
          status: 'dispatch_prepared',
          origin: 'plan',
          preparedAt: staleTimestamp,
          workerSession: { sessionId: 'sess-2', workspaceMode: 'worktree' },
        }),
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });

      const staleDispatches = result.data.staleDispatches as Array<{ hint: string }>;
      expect(staleDispatches[0].hint).toContain('retry dispatch');
      expect(staleDispatches[0].hint).toContain('reset to pending');
    });

    it('detects multiple stale dispatches', async () => {
      const staleTimestamp1 = new Date(Date.now() - 90_000).toISOString();
      const staleTimestamp2 = new Date(Date.now() - 180_000).toISOString();
      const taskService = {
        list: () => [
          { folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' },
          { folder: '02-core', name: 'Core', status: 'dispatch_prepared', origin: 'plan' },
          { folder: '03-done', name: 'Done', status: 'done', origin: 'plan' },
        ],
        getRawStatus: (feature: string, folder: string) => {
          if (folder === '01-setup') {
            return {
              status: 'dispatch_prepared',
              origin: 'plan',
              preparedAt: staleTimestamp1,
              workerSession: { sessionId: 's1', workspaceMode: 'worktree' },
            };
          }
          if (folder === '02-core') {
            return {
              status: 'dispatch_prepared',
              origin: 'plan',
              preparedAt: staleTimestamp2,
              workerSession: { sessionId: 's2', workspaceMode: 'worktree' },
            };
          }
          return { status: 'done', origin: 'plan' };
        },
        computeRunnableStatus: () => ({ runnable: [], blocked: {} }),
      } as unknown as TaskService;

      const result = await getStatusHealth({ taskService });

      const staleDispatches = result.data.staleDispatches as Array<{ folder: string }>;
      expect(staleDispatches).toHaveLength(2);
      expect(staleDispatches.map((s) => s.folder)).toEqual(['01-setup', '02-core']);
    });
  });
});
