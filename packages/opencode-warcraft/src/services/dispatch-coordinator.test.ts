import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import { DispatchCoordinator, type DispatchCoordinatorDeps, type DispatchRequest } from './dispatch-coordinator.js';

// ============================================================================
// Test helpers
// ============================================================================

const TEST_DIR = `/tmp/opencode-warcraft-dispatch-coordinator-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

/** Tracks all taskService.update calls for assertions. */
function createUpdateTracker() {
  const calls: Array<{ feature: string; task: string; patch: Record<string, unknown> }> = [];
  return {
    calls,
    update: (feature: string, task: string, patch: Record<string, unknown>) => {
      calls.push({ feature, task, patch });
    },
  };
}

function createMockDeps(overrides: Partial<DispatchCoordinatorDeps> = {}): DispatchCoordinatorDeps {
  return {
    taskService: {
      get: () => ({
        folder: '01-test-task',
        name: 'Test Task',
        status: 'pending',
        origin: 'plan' as const,
        planTitle: 'Test Task',
      }),
      update: () => {},
      getRawStatus: () => ({
        status: 'pending' as const,
        origin: 'plan' as const,
        dependsOn: [],
      }),
      writeSpec: () => 'bd-spec-123',
      writeWorkerPrompt: () => {},
      buildSpecData: () => ({
        featureName: 'test-feature',
        task: { folder: '01-test-task', name: 'Test Task', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
        planSection: '### 1. Test Task\n\nDo something.',
        contextFiles: [],
        completedTasks: [],
      }),
      list: () => [
        {
          folder: '01-test-task',
          name: 'Test Task',
          status: 'pending' as const,
          origin: 'plan' as const,
          planTitle: 'Test Task',
        },
      ],
      patchBackgroundFields: () => {},
    },
    planService: {
      read: () => ({ content: '# Plan\n\n### 1. Test Task\n\nDo it.', status: 'approved' as const, comments: [] }),
    },
    contextService: {
      list: () => [],
    },
    worktreeService: {
      create: async () => ({
        path: '/tmp/worktree',
        branch: 'warcraft/test-feature/01-test-task',
        commit: 'abc123',
        feature: 'test-feature',
        step: '01-test-task',
      }),
      get: async () => ({
        path: '/tmp/worktree',
        branch: 'warcraft/test-feature/01-test-task',
        commit: 'abc123',
        feature: 'test-feature',
        step: '01-test-task',
      }),
      remove: async () => {},
    },
    checkBlocked: () => ({ blocked: false }),
    checkDependencies: () => ({ allowed: true }),
    verificationModel: 'tdd',
    lockDir: TEST_DIR,
    ...overrides,
  };
}

function createRequest(overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    feature: 'test-feature',
    task: '01-test-task',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('DispatchCoordinator', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  // --------------------------------------------------------------------------
  // REGRESSION: Prep failure must NOT leave task in_progress
  // --------------------------------------------------------------------------

  describe('premature state mutation regression', () => {
    it('does NOT set task to in_progress when prepareTaskDispatch fails', async () => {
      const tracker = createUpdateTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          update: tracker.update,
          // Make buildSpecData throw to simulate prep failure
          buildSpecData: () => {
            throw new Error('Spec assembly explosion');
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Spec assembly explosion');
      // CRITICAL: task should NOT have been set to in_progress
      const inProgressUpdates = tracker.calls.filter((c) => c.patch.status === 'in_progress');
      expect(inProgressUpdates.length).toBe(0);
    });

    it('does NOT set task to in_progress when writeWorkerPrompt fails', async () => {
      const tracker = createUpdateTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          update: tracker.update,
          writeWorkerPrompt: () => {
            throw new Error('Prompt write failure');
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      // CRITICAL: task should NOT have been set to in_progress
      const inProgressUpdates = tracker.calls.filter((c) => c.patch.status === 'in_progress');
      expect(inProgressUpdates.length).toBe(0);
    });

    it('sets task to in_progress ONLY after prep succeeds', async () => {
      const tracker = createUpdateTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          update: tracker.update,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(true);
      // Task should now be in_progress
      const inProgressUpdates = tracker.calls.filter((c) => c.patch.status === 'in_progress');
      expect(inProgressUpdates.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Worktree rollback on prep failure
  // --------------------------------------------------------------------------

  describe('worktree rollback on prep failure', () => {
    it('removes freshly created worktree when prep fails', async () => {
      const removeCalls: Array<{ feature: string; task: string }> = [];
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          buildSpecData: () => {
            throw new Error('Spec assembly failure');
          },
        },
        worktreeService: {
          ...createMockDeps().worktreeService,
          remove: async (feature: string, task: string) => {
            removeCalls.push({ feature, task });
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      // Freshly created worktree should be cleaned up
      expect(removeCalls.length).toBe(1);
      expect(removeCalls[0].feature).toBe('test-feature');
      expect(removeCalls[0].task).toBe('01-test-task');
    });

    it('does NOT remove worktree when continuing from blocked and prep fails', async () => {
      const removeCalls: Array<{ feature: string; task: string }> = [];
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'blocked' as const,
            origin: 'plan' as const,
            summary: 'Previous summary',
          }),
          buildSpecData: () => {
            throw new Error('Spec assembly failure');
          },
        },
        worktreeService: {
          ...createMockDeps().worktreeService,
          remove: async (feature: string, task: string) => {
            removeCalls.push({ feature, task });
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest({ continueFrom: 'blocked', decision: 'Some answer' }));

      expect(result.success).toBe(false);
      // Should NOT remove existing worktree for a blocked resume
      expect(removeCalls.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Duplicate dispatch protection (concurrency lock)
  // --------------------------------------------------------------------------

  describe('duplicate dispatch protection', () => {
    it('prevents concurrent dispatch of the same task', async () => {
      const deps = createMockDeps({
        worktreeService: {
          ...createMockDeps().worktreeService,
          create: async () => {
            await new Promise((r) => setTimeout(r, 100));
            return {
              path: '/tmp/worktree',
              branch: 'warcraft/test-feature/01-test-task',
              commit: 'abc123',
              feature: 'test-feature',
              step: '01-test-task',
            };
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const [r1, r2] = await Promise.all([
        coordinator.dispatch(createRequest()),
        coordinator.dispatch(createRequest()),
      ]);

      const successes = [r1, r2].filter((r) => r.success);
      const failures = [r1, r2].filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].error).toContain('already being dispatched');
    });

    it('allows concurrent dispatch of different tasks', async () => {
      const deps = createMockDeps();
      const coordinator = new DispatchCoordinator(deps);

      const [r1, r2] = await Promise.all([
        coordinator.dispatch(createRequest({ task: '01-task-a' })),
        coordinator.dispatch(createRequest({ task: '02-task-b' })),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('releases lock after failure so retry can proceed', async () => {
      let failOnce = true;
      const deps = createMockDeps({
        worktreeService: {
          ...createMockDeps().worktreeService,
          create: async () => {
            if (failOnce) {
              failOnce = false;
              throw new Error('git worktree create failed');
            }
            return {
              path: '/tmp/worktree',
              branch: 'warcraft/test-feature/01-test-task',
              commit: 'abc123',
              feature: 'test-feature',
              step: '01-test-task',
            };
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);

      const first = await coordinator.dispatch(createRequest());
      expect(first.success).toBe(false);

      // Lock should be released, so retry succeeds
      const second = await coordinator.dispatch(createRequest());
      expect(second.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Happy path
  // --------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns success with worktree info and task tool call', async () => {
      const coordinator = new DispatchCoordinator(createMockDeps());
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(true);
      expect(result.task).toBe('01-test-task');
      expect(result.worktreePath).toBeDefined();
      expect(result.branch).toBeDefined();
      expect(result.taskToolCall).toBeDefined();
      expect(result.taskToolCall?.subagent_type).toBe('mekkatorque');
      expect(result.taskToolCall?.prompt).toBeDefined();
      expect(typeof result.taskToolCall?.prompt).toBe('string');
      expect(result.taskToolCall!.prompt.length).toBeGreaterThan(0);
    });

    it('includes baseCommit in status update for fresh dispatch', async () => {
      const tracker = createUpdateTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          update: tracker.update,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      await coordinator.dispatch(createRequest());

      const inProgressUpdate = tracker.calls.find((c) => c.patch.status === 'in_progress');
      expect(inProgressUpdate).toBeDefined();
      expect(inProgressUpdate!.patch.baseCommit).toBe('abc123');
    });

    it('does NOT include baseCommit when continuing from blocked', async () => {
      const tracker = createUpdateTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'blocked' as const,
            origin: 'plan' as const,
            summary: 'Previous work',
          }),
          update: tracker.update,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      await coordinator.dispatch(createRequest({ continueFrom: 'blocked', decision: 'yes' }));

      const inProgressUpdate = tracker.calls.find((c) => c.patch.status === 'in_progress');
      expect(inProgressUpdate).toBeDefined();
      expect(inProgressUpdate!.patch.baseCommit).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Guard checks
  // --------------------------------------------------------------------------

  describe('guard checks', () => {
    it('rejects when feature is blocked', async () => {
      const deps = createMockDeps({
        checkBlocked: () => ({ blocked: true, message: 'Feature blocked' }),
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('rejects when task not found', async () => {
      const deps = createMockDeps({
        taskService: { ...createMockDeps().taskService, get: () => null },
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('rejects when task already done', async () => {
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'done' as const,
            origin: 'plan' as const,
          }),
        },
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('done');
    });

    it('rejects when dependencies not met', async () => {
      const deps = createMockDeps({
        checkDependencies: () => ({ allowed: false, error: 'Deps not met' }),
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Deps not met');
    });

    it('rejects in_progress tasks for non-blocked resume', async () => {
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'in_progress' as const,
            origin: 'plan' as const,
          }),
        },
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });
  });

  // --------------------------------------------------------------------------
  // Continue from blocked
  // --------------------------------------------------------------------------

  describe('continue from blocked', () => {
    it('reuses existing worktree when continuing from blocked', async () => {
      let createCalled = false;
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'blocked' as const,
            origin: 'plan' as const,
            summary: 'Previous summary',
          }),
        },
        worktreeService: {
          ...createMockDeps().worktreeService,
          create: async () => {
            createCalled = true;
            return {
              path: '/tmp/worktree',
              branch: 'warcraft/test-feature/01-test-task',
              commit: 'abc123',
              feature: 'test-feature',
              step: '01-test-task',
            };
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest({ continueFrom: 'blocked', decision: 'Use option A' }));

      expect(result.success).toBe(true);
      expect(createCalled).toBe(false);
    });

    it('rejects continueFrom=blocked when task is not blocked', async () => {
      const coordinator = new DispatchCoordinator(createMockDeps());
      const result = await coordinator.dispatch(createRequest({ continueFrom: 'blocked', decision: 'yes' }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in blocked state');
    });
  });

  // --------------------------------------------------------------------------
  // No-lock-dir graceful degradation
  // --------------------------------------------------------------------------

  describe('lockDir omitted', () => {
    it('succeeds without lock when lockDir is undefined', async () => {
      const deps = createMockDeps({ lockDir: undefined });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(true);
    });
  });
});
