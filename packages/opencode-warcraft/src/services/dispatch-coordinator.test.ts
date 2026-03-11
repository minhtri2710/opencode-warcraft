import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as warcraftCore from 'warcraft-core';
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

/** Tracks all taskService.transition calls for assertions. */
function createTransitionTracker() {
  const calls: Array<{ feature: string; task: string; toStatus: string; extras?: Record<string, unknown> }> = [];
  return {
    calls,
    transition: (feature: string, task: string, toStatus: string, extras?: Record<string, unknown>) => {
      calls.push({ feature, task, toStatus, extras });
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
      transition: () => {},
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
        mode: 'worktree' as const,
        path: '/tmp/worktree',
        branch: 'warcraft/test-feature/01-test-task',
        commit: 'abc123',
        feature: 'test-feature',
        step: '01-test-task',
      }),
      get: async () => ({
        mode: 'worktree' as const,
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
    sessionId: 'sess-1',
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
    it('does NOT set task to dispatch_prepared when prepareTaskDispatch fails', async () => {
      const tracker = createTransitionTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          transition: tracker.transition,
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
      // CRITICAL: task should NOT have been set to dispatch_prepared or in_progress
      const dispatchPreparedTransitions = tracker.calls.filter((c) => c.toStatus === 'dispatch_prepared');
      expect(dispatchPreparedTransitions.length).toBe(0);
    });

    it('does NOT set task to dispatch_prepared when writeWorkerPrompt fails', async () => {
      const tracker = createTransitionTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          transition: tracker.transition,
          writeWorkerPrompt: () => {
            throw new Error('Prompt write failure');
          },
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      // CRITICAL: task should NOT have been set to dispatch_prepared or in_progress
      const dispatchPreparedTransitions = tracker.calls.filter((c) => c.toStatus === 'dispatch_prepared');
      expect(dispatchPreparedTransitions.length).toBe(0);
    });

    it('sets task to dispatch_prepared ONLY after prep succeeds', async () => {
      const tracker = createTransitionTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          transition: tracker.transition,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(true);
      // Task should now be dispatch_prepared via transition()
      const dispatchPreparedTransitions = tracker.calls.filter((c) => c.toStatus === 'dispatch_prepared');
      expect(dispatchPreparedTransitions.length).toBe(1);
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
              mode: 'worktree' as const,
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

    it('allows the same feature/task to dispatch concurrently when lock directories differ', async () => {
      const delayedCreate = async () => {
        await new Promise((r) => setTimeout(r, 100));
        return {
          mode: 'worktree' as const,
          path: '/tmp/worktree',
          branch: 'warcraft/test-feature/01-test-task',
          commit: 'abc123',
          feature: 'test-feature',
          step: '01-test-task',
        };
      };

      const coordinatorA = new DispatchCoordinator(
        createMockDeps({
          lockDir: `${TEST_DIR}/locks-a`,
          worktreeService: {
            ...createMockDeps().worktreeService,
            create: delayedCreate,
          },
        }),
      );
      const coordinatorB = new DispatchCoordinator(
        createMockDeps({
          lockDir: `${TEST_DIR}/locks-b`,
          worktreeService: {
            ...createMockDeps().worktreeService,
            create: delayedCreate,
          },
        }),
      );

      const [r1, r2] = await Promise.all([
        coordinatorA.dispatch(createRequest()),
        coordinatorB.dispatch(createRequest()),
      ]);

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('surfaces unexpected lock acquisition errors instead of reporting contention', async () => {
      const acquireLockSpy = spyOn(warcraftCore, 'acquireLock').mockImplementation(async () => {
        throw new Error('lock storage exploded');
      });

      try {
        const coordinator = new DispatchCoordinator(createMockDeps());
        const result = await coordinator.dispatch(createRequest());

        expect(result.success).toBe(false);
        expect(result.error).toContain('lock storage exploded');
        expect(result.error).not.toContain('already being dispatched');
      } finally {
        acquireLockSpy.mockRestore();
      }
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
              mode: 'worktree' as const,
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
      expect(result.workspaceMode).toBe('worktree');
      expect(result.workspacePath).toBeDefined();
      expect(result.branch).toBeDefined();
      expect(result.taskToolCall).toBeDefined();
      expect(result.taskToolCall?.subagent_type).toBe('mekkatorque');
      expect(result.taskToolCall?.prompt).toBeDefined();
      expect(typeof result.taskToolCall?.prompt).toBe('string');
      expect(result.taskToolCall!.prompt.length).toBeGreaterThan(0);
    });

    it('includes baseCommit in transition extras for fresh dispatch', async () => {
      const tracker = createTransitionTracker();
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          transition: tracker.transition,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      await coordinator.dispatch(createRequest());

      const dispatchPreparedTransition = tracker.calls.find((c) => c.toStatus === 'dispatch_prepared');
      expect(dispatchPreparedTransition).toBeDefined();
      expect(dispatchPreparedTransition!.extras?.baseCommit).toBe('abc123');
    });

    it('returns direct workspace info and omits baseCommit when creation falls back to direct mode', async () => {
      const tracker = createTransitionTracker();
      const patchCalls: Array<{ feature: string; task: string; patch: Record<string, unknown> }> = [];
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          transition: tracker.transition,
          patchBackgroundFields: (feature: string, task: string, patch: Record<string, unknown>) => {
            patchCalls.push({ feature, task, patch });
          },
        },
        worktreeService: {
          ...createMockDeps().worktreeService,
          create: async () => ({
            mode: 'direct' as const,
            path: '/repo/root',
            feature: 'test-feature',
            step: '01-test-task',
          }),
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(true);
      expect(result.workspaceMode).toBe('direct');
      expect(result.workspacePath).toBe('/repo/root');
      expect(result.branch).toBeUndefined();
      expect(result.createdWorktree).toBe(false);

      const dispatchPreparedTransition = tracker.calls.find((c) => c.toStatus === 'dispatch_prepared');
      expect(dispatchPreparedTransition).toBeDefined();
      expect(dispatchPreparedTransition!.extras?.baseCommit).toBeUndefined();
      expect(patchCalls).toEqual([
        {
          feature: 'test-feature',
          task: '01-test-task',
          patch: {
            workerSession: {
              sessionId: 'sess-1',
              agent: 'mekkatorque',
              mode: 'delegate',
              attempt: 1,
              workspaceMode: 'direct',
              workspacePath: '/repo/root',
            },
          },
        },
      ]);
    });

    it('resumes blocked tasks directly into in_progress without baseCommit', async () => {
      const tracker = createTransitionTracker();
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
          transition: tracker.transition,
        },
      });

      const coordinator = new DispatchCoordinator(deps);
      await coordinator.dispatch(createRequest({ continueFrom: 'blocked', decision: 'yes' }));

      const inProgressTransition = tracker.calls.find((c) => c.toStatus === 'in_progress');
      expect(inProgressTransition).toBeDefined();
      expect(inProgressTransition!.extras).toBeUndefined();
      expect(tracker.calls.some((c) => c.toStatus === 'dispatch_prepared')).toBe(false);
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

    it('rejects dispatch_prepared tasks for non-blocked resume', async () => {
      const deps = createMockDeps({
        taskService: {
          ...createMockDeps().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'dispatch_prepared' as const,
            origin: 'plan' as const,
          }),
        },
      });
      const coordinator = new DispatchCoordinator(deps);
      const result = await coordinator.dispatch(createRequest());

      expect(result.success).toBe(false);
      expect(result.error).toContain('already being dispatched');
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
              mode: 'worktree' as const,
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

    it('reuses the stored direct workspace when continuing a blocked direct-mode task', async () => {
      let createCalled = false;
      let getCalled = false;
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
          getRawStatus: () => ({
            status: 'blocked' as const,
            origin: 'plan' as const,
            dependsOn: [],
            workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
          }),
        },
        worktreeService: {
          ...createMockDeps().worktreeService,
          create: async () => {
            createCalled = true;
            return {
              mode: 'worktree' as const,
              path: '/tmp/worktree',
              branch: 'warcraft/test-feature/01-test-task',
              commit: 'abc123',
              feature: 'test-feature',
              step: '01-test-task',
            };
          },
          get: async () => {
            getCalled = true;
            return {
              mode: 'worktree' as const,
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
      expect(result.workspaceMode).toBe('direct');
      expect(result.workspacePath).toBe('/repo/root');
      expect(result.branch).toBeUndefined();
      expect(createCalled).toBe(false);
      expect(getCalled).toBe(false);
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
