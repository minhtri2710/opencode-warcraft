import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import {
  type DispatchOneTaskInput,
  type DispatchOneTaskServices,
  dispatchOneTask,
  getTaskDispatchLockPath,
  releaseAllDispatchLocks,
} from './dispatch-task.js';
import { fetchSharedDispatchData } from './task-dispatch.js';

// ============================================================================
// Test helpers
// ============================================================================

const TEST_DIR = `/tmp/opencode-warcraft-dispatch-task-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createMockServices(overrides: Partial<DispatchOneTaskServices> = {}): DispatchOneTaskServices {
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
    },
    checkBlocked: () => ({ blocked: false }),
    checkDependencies: () => ({ allowed: true }),
    verificationModel: 'tdd',
    lockDir: TEST_DIR,
    ...overrides,
  };
}

function createInput(overrides: Partial<DispatchOneTaskInput> = {}): DispatchOneTaskInput {
  return {
    feature: 'test-feature',
    task: '01-test-task',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('dispatch-task', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    releaseAllDispatchLocks();
  });

  afterEach(() => {
    releaseAllDispatchLocks();
    cleanup();
  });

  // --------------------------------------------------------------------------
  // getTaskDispatchLockPath
  // --------------------------------------------------------------------------

  describe('getTaskDispatchLockPath', () => {
    it('returns a lock path scoped to feature and task', () => {
      const lockPath = getTaskDispatchLockPath(TEST_DIR, 'my-feature', '01-setup');
      expect(lockPath).toContain('my-feature');
      expect(lockPath).toContain('01-setup');
      expect(lockPath).toEndWith('.dispatch.lock');
    });

    it('returns different paths for different tasks', () => {
      const a = getTaskDispatchLockPath(TEST_DIR, 'feat', '01-task-a');
      const b = getTaskDispatchLockPath(TEST_DIR, 'feat', '02-task-b');
      expect(a).not.toBe(b);
    });
  });

  // --------------------------------------------------------------------------
  // dispatchOneTask — happy path
  // --------------------------------------------------------------------------

  describe('dispatchOneTask happy path', () => {
    it('returns success with worktree info and task tool call', async () => {
      const services = createMockServices();
      const input = createInput();

      const result = await dispatchOneTask(input, services);

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

    it('updates task status to in_progress', async () => {
      let updatedStatus: string | undefined;
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          update: (_f: string, _t: string, patch: Record<string, unknown>) => {
            updatedStatus = patch.status as string;
          },
        },
      });

      await dispatchOneTask(createInput(), services);

      expect(updatedStatus).toBe('in_progress');
    });
  });

  // --------------------------------------------------------------------------
  // dispatchOneTask — guard checks
  // --------------------------------------------------------------------------

  describe('dispatchOneTask guards', () => {
    it('rejects when feature is blocked', async () => {
      const services = createMockServices({
        checkBlocked: () => ({ blocked: true, message: 'Feature blocked by commander' }),
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('rejects when task not found', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => null,
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('rejects when task already done', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'done' as const,
            origin: 'plan' as const,
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('done');
    });

    it('rejects when dependencies not met', async () => {
      const services = createMockServices({
        checkDependencies: () => ({ allowed: false, error: 'Dependency 01-setup not done' }),
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependency');
    });
  });

  // --------------------------------------------------------------------------
  // Per-task concurrency lock
  // --------------------------------------------------------------------------

  describe('per-task concurrency lock', () => {
    it('prevents duplicate concurrent dispatch of the same task', async () => {
      const services = createMockServices({
        worktreeService: {
          ...createMockServices().worktreeService,
          create: async () => {
            // Simulate slow worktree creation
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
      const input = createInput();

      // Launch two concurrent dispatches for the same task
      const [result1, result2] = await Promise.all([
        dispatchOneTask(input, services),
        dispatchOneTask(input, services),
      ]);

      // Exactly one should succeed and one should fail with lock contention
      const successes = [result1, result2].filter((r) => r.success);
      const failures = [result1, result2].filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].error).toContain('already being dispatched');
    });

    it('releases lock after successful dispatch', async () => {
      const services = createMockServices();
      const input = createInput();

      await dispatchOneTask(input, services);

      // Second dispatch should succeed because lock was released
      const result = await dispatchOneTask(input, services);
      expect(result.success).toBe(true);
    });

    it('releases lock after failed dispatch', async () => {
      const services = createMockServices({
        worktreeService: {
          ...createMockServices().worktreeService,
          create: async () => {
            throw new Error('git worktree failed');
          },
        },
      });
      const input = createInput();

      const result1 = await dispatchOneTask(input, services);
      expect(result1.success).toBe(false);

      // Fix the service and retry — lock should be released
      const fixedServices = createMockServices();
      const result2 = await dispatchOneTask(input, fixedServices);
      expect(result2.success).toBe(true);
    });

    it('allows concurrent dispatch of different tasks', async () => {
      const services = createMockServices();

      const [result1, result2] = await Promise.all([
        dispatchOneTask(createInput({ task: '01-task-a' }), services),
        dispatchOneTask(createInput({ task: '02-task-b' }), services),
      ]);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Invariant response shape
  // --------------------------------------------------------------------------

  describe('invariant response shape', () => {
    it('success result has all required fields', async () => {
      const services = createMockServices();
      const result = await dispatchOneTask(createInput(), services);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('task');
      expect(result).toHaveProperty('agent');
      // Success-specific fields
      expect(result).toHaveProperty('worktreePath');
      expect(result).toHaveProperty('branch');
      expect(result).toHaveProperty('taskToolCall');
    });

    it('failure result has all required fields', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => null,
        },
      });
      const result = await dispatchOneTask(createInput(), services);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('task');
      expect(result).toHaveProperty('agent');
      expect(result).toHaveProperty('error');
    });
  });

  // --------------------------------------------------------------------------
  // Continue from blocked
  // --------------------------------------------------------------------------

  describe('continueFrom blocked', () => {
    it('reuses existing worktree when continuing from blocked', async () => {
      let createCalled = false;
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'blocked' as const,
            origin: 'plan' as const,
            summary: 'Previous work summary',
          }),
        },
        worktreeService: {
          ...createMockServices().worktreeService,
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

      const result = await dispatchOneTask(
        createInput({ continueFrom: 'blocked', decision: 'Use option A' }),
        services,
      );

      expect(result.success).toBe(true);
      // Should use get() not create() for blocked tasks
      expect(createCalled).toBe(false);
    });

    it('rejects continueFrom=blocked when task is not blocked', async () => {
      const services = createMockServices(); // Default task status is 'pending'
      const result = await dispatchOneTask(
        createInput({ continueFrom: 'blocked', decision: 'some decision' }),
        services,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in blocked state');
    });
  });

  // --------------------------------------------------------------------------
  // No-lock-dir graceful degradation
  // --------------------------------------------------------------------------

  describe('lockDir omitted', () => {
    it('succeeds without lock when lockDir is undefined', async () => {
      const services = createMockServices({ lockDir: undefined });
      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.task).toBe('01-test-task');
    });

    it('allows concurrent dispatch of same task when lockDir is undefined', async () => {
      const services = createMockServices({
        lockDir: undefined,
        worktreeService: {
          ...createMockServices().worktreeService,
          create: async () => {
            await new Promise((r) => setTimeout(r, 50));
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
      const input = createInput();

      // Without lockDir, both should succeed (no lock contention)
      const [r1, r2] = await Promise.all([dispatchOneTask(input, services), dispatchOneTask(input, services)]);

      // Both succeed because there's no lock
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Guard order parity — same order as batch would use
  // --------------------------------------------------------------------------

  describe('guard order parity', () => {
    it('rejects feature-blocked before task-not-found', async () => {
      const services = createMockServices({
        checkBlocked: () => ({ blocked: true, message: 'Feature blocked' }),
        taskService: {
          ...createMockServices().taskService,
          get: () => null,
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('blocked');
      expect(result.error).not.toContain('not found');
    });

    it('rejects task-not-found before already-done', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => null,
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.error).not.toContain('done');
    });

    it('rejects already-done before dependency check', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          get: () => ({
            folder: '01-test-task',
            name: 'Test Task',
            status: 'done' as const,
            origin: 'plan' as const,
          }),
        },
        checkDependencies: () => ({ allowed: false, error: 'Deps not met' }),
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('done');
      expect(result.error).not.toContain('Deps');
    });

    it('rejects dependency failure before lock contention', async () => {
      const services = createMockServices({
        checkDependencies: () => ({ allowed: false, error: 'Dependencies not met' }),
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dependencies not met');
      expect(result.error).not.toContain('already being dispatched');
    });
  });

  // --------------------------------------------------------------------------
  // Invariant response shape — success and failure both have agent field
  // --------------------------------------------------------------------------

  describe('response shape invariants', () => {
    it('always includes task and agent fields regardless of success/failure', async () => {
      // Success case
      const successResult = await dispatchOneTask(createInput(), createMockServices());
      expect(successResult.task).toBe('01-test-task');
      expect(successResult.agent).toBe('mekkatorque');

      // Failure case: blocked feature
      const failResult = await dispatchOneTask(
        createInput(),
        createMockServices({ checkBlocked: () => ({ blocked: true, message: 'Blocked' }) }),
      );
      expect(failResult.task).toBe('01-test-task');
      expect(failResult.agent).toBe('mekkatorque');
    });

    it('success result has taskToolCall with required subfields', async () => {
      const result = await dispatchOneTask(createInput(), createMockServices());

      expect(result.success).toBe(true);
      expect(result.taskToolCall).toBeDefined();
      expect(result.taskToolCall!.subagent_type).toBe('mekkatorque');
      expect(typeof result.taskToolCall!.description).toBe('string');
      expect(typeof result.taskToolCall!.prompt).toBe('string');
      expect(result.taskToolCall!.prompt.length).toBeGreaterThan(0);
    });

    it('failure result has error string and no taskToolCall', async () => {
      const result = await dispatchOneTask(
        createInput(),
        createMockServices({ taskService: { ...createMockServices().taskService, get: () => null } }),
      );

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.taskToolCall).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Complexity classification wired into dispatch prompt
  // --------------------------------------------------------------------------

  describe('complexity classification in dispatch prompt', () => {
    it('includes complex task guidance when spec is large (specLength > 3000)', async () => {
      const longPlanSection = 'X'.repeat(3500);
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          buildSpecData: () => ({
            featureName: 'test-feature',
            task: { folder: '01-test-task', name: 'Test Task', order: 1 },
            dependsOn: [],
            allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
            planSection: longPlanSection,
            contextFiles: [],
            completedTasks: [],
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).toContain('Complex Task Guidance');
    });

    it('includes compact guidance for trivial tasks (small spec, few files, no deps, no retries)', async () => {
      // Trivial: specLength < 500, fileCount <= 2, dependencyCount === 0, previousAttempts === 0
      const tinySpec = '### 1. Test Task\n\nDo something small.';
      const services = createMockServices({
        planService: {
          read: () => ({ content: tinySpec, status: 'approved' as const, comments: [] }),
        },
        taskService: {
          ...createMockServices().taskService,
          getRawStatus: () => ({
            status: 'pending' as const,
            origin: 'plan' as const,
            dependsOn: [],
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      // Trivial mode should contain compact execution guidance
      expect(result.taskToolCall?.prompt).toContain('Read spec');
    });

    it('does NOT include complex guidance for standard tasks', async () => {
      // Standard: moderate specLength, moderate signals — default mock
      const services = createMockServices();

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).not.toContain('Complex Task Guidance');
    });

    it('classifies as complex when previousAttempts >= 2', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          getRawStatus: () => ({
            status: 'pending' as const,
            origin: 'plan' as const,
            dependsOn: [],
            workerSession: { attempt: 2 },
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).toContain('Complex Task Guidance');
    });
  });

  // --------------------------------------------------------------------------
  // Retry / failure context forwarding
  // --------------------------------------------------------------------------

  describe('retry context forwarding', () => {
    it('includes previous attempt context when previousAttempts > 0 and summary exists', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          getRawStatus: () => ({
            status: 'pending' as const,
            origin: 'plan' as const,
            dependsOn: [],
            workerSession: { attempt: 1 },
            summary: 'Failed because config was missing',
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).toContain('Previous Attempt Context');
      expect(result.taskToolCall?.prompt).toContain('Failed because config was missing');
    });

    it('does NOT include previous attempt context when previousAttempts is 0', async () => {
      const services = createMockServices();

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).not.toContain('Previous Attempt Context');
    });

    it('does NOT include previous attempt context when summary is missing', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          getRawStatus: () => ({
            status: 'pending' as const,
            origin: 'plan' as const,
            dependsOn: [],
            workerSession: { attempt: 1 },
            // no summary
          }),
        },
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).not.toContain('Previous Attempt Context');
    });
  });

  // --------------------------------------------------------------------------
  // Parity between batch (shared data) and single-task dispatch
  // --------------------------------------------------------------------------

  describe('batch vs single-task parity', () => {
    it('produces same complexity classification via shared and non-shared dispatch', async () => {
      // Use large planSection to trigger complex classification (specLength > 3000)
      const longPlanSection = 'Y'.repeat(3500);
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          buildSpecData: () => ({
            featureName: 'test-feature',
            task: { folder: '01-test-task', name: 'Test Task', order: 1 },
            dependsOn: [],
            allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
            planSection: longPlanSection,
            contextFiles: [],
            completedTasks: [],
          }),
        },
      });

      // Single-task dispatch (no shared data)
      const singleResult = await dispatchOneTask(createInput(), services);

      // Batch-style dispatch (with shared data pre-fetched)
      const shared = fetchSharedDispatchData('test-feature', {
        planService: services.planService as any,
        taskService: services.taskService as any,
        contextService: services.contextService,
        verificationModel: services.verificationModel,
      });

      // Release lock from single result so we can dispatch again
      releaseAllDispatchLocks();

      const batchResult = await dispatchOneTask(createInput(), services, shared);

      expect(singleResult.success).toBe(true);
      expect(batchResult.success).toBe(true);

      // Both should include complex guidance
      expect(singleResult.taskToolCall?.prompt).toContain('Complex Task Guidance');
      expect(batchResult.taskToolCall?.prompt).toContain('Complex Task Guidance');
    });

    it('produces same retry context via shared and non-shared dispatch', async () => {
      const services = createMockServices({
        taskService: {
          ...createMockServices().taskService,
          getRawStatus: () => ({
            status: 'pending' as const,
            origin: 'plan' as const,
            dependsOn: [],
            workerSession: { attempt: 1 },
            summary: 'Previous failure context',
          }),
        },
      });

      const singleResult = await dispatchOneTask(createInput(), services);

      const shared = fetchSharedDispatchData('test-feature', {
        planService: services.planService as any,
        taskService: services.taskService as any,
        contextService: services.contextService,
        verificationModel: services.verificationModel,
      });

      releaseAllDispatchLocks();

      const batchResult = await dispatchOneTask(createInput(), services, shared);

      expect(singleResult.success).toBe(true);
      expect(batchResult.success).toBe(true);

      // Both should include retry context
      expect(singleResult.taskToolCall?.prompt).toContain('Previous Attempt Context');
      expect(batchResult.taskToolCall?.prompt).toContain('Previous Attempt Context');
    });
  });

  // --------------------------------------------------------------------------
  // featureReopenRate wiring — ensures reopen rate reaches classifier
  // --------------------------------------------------------------------------

  describe('featureReopenRate wiring', () => {
    it('classifies as complex when featureReopenRate > 0.2 is provided', async () => {
      const services = createMockServices({
        featureReopenRate: 0.3,
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).toContain('Complex Task Guidance');
    });

    it('does NOT classify as complex when featureReopenRate <= 0.2', async () => {
      const services = createMockServices({
        featureReopenRate: 0.2,
      });

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).not.toContain('Complex Task Guidance');
    });

    it('treats missing featureReopenRate as 0 (not complex)', async () => {
      const services = createMockServices();
      // featureReopenRate is undefined by default

      const result = await dispatchOneTask(createInput(), services);

      expect(result.success).toBe(true);
      expect(result.taskToolCall?.prompt).not.toContain('Complex Task Guidance');
    });

    it('normalizes invalid featureReopenRate values (NaN, negative, >1)', async () => {
      // NaN should be normalized to 0, not trigger complex
      const nanServices = createMockServices({ featureReopenRate: NaN });
      const nanResult = await dispatchOneTask(createInput(), nanServices);
      expect(nanResult.success).toBe(true);
      expect(nanResult.taskToolCall?.prompt).not.toContain('Complex Task Guidance');

      releaseAllDispatchLocks();

      // Negative should be normalized to 0
      const negServices = createMockServices({ featureReopenRate: -0.5 });
      const negResult = await dispatchOneTask(createInput(), negServices);
      expect(negResult.success).toBe(true);
      expect(negResult.taskToolCall?.prompt).not.toContain('Complex Task Guidance');

      releaseAllDispatchLocks();

      // >1 should be normalized to 0
      const overServices = createMockServices({ featureReopenRate: 1.5 });
      const overResult = await dispatchOneTask(createInput(), overServices);
      expect(overResult.success).toBe(true);
      expect(overResult.taskToolCall?.prompt).not.toContain('Complex Task Guidance');
    });

    it('featureReopenRate parity: same classification via shared and non-shared dispatch', async () => {
      const services = createMockServices({
        featureReopenRate: 0.3,
      });

      // Single-task dispatch (no shared data)
      const singleResult = await dispatchOneTask(createInput(), services);

      // Batch-style dispatch (with shared data pre-fetched)
      const shared = fetchSharedDispatchData('test-feature', {
        planService: services.planService as any,
        taskService: services.taskService as any,
        contextService: services.contextService,
        verificationModel: services.verificationModel,
        featureReopenRate: 0.3,
      });

      releaseAllDispatchLocks();

      const batchResult = await dispatchOneTask(createInput(), services, shared);

      expect(singleResult.success).toBe(true);
      expect(batchResult.success).toBe(true);

      // Both should classify as complex due to high reopen rate
      expect(singleResult.taskToolCall?.prompt).toContain('Complex Task Guidance');
      expect(batchResult.taskToolCall?.prompt).toContain('Complex Task Guidance');
    });
  });
});
