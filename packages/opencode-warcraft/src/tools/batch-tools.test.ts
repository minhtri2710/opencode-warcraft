import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import { mapWithConcurrencyLimit, resolveParallelPolicy } from './batch-tools.js';
import {
  type DispatchOneTaskInput,
  type DispatchOneTaskServices,
  dispatchOneTask,
  releaseAllDispatchLocks,
} from './dispatch-task.js';

// ============================================================================
// Shared test helpers
// ============================================================================

const TEST_DIR = `/tmp/opencode-warcraft-batch-parity-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createMockServices(overrides: Partial<DispatchOneTaskServices> = {}): DispatchOneTaskServices {
  return {
    taskService: {
      get: (_f: string, task: string) => ({
        folder: task,
        name: 'Test Task',
        status: 'pending' as const,
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
        {
          folder: '02-test-task',
          name: 'Test Task 2',
          status: 'pending' as const,
          origin: 'plan' as const,
          planTitle: 'Test Task 2',
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

function createInput(task = '01-test-task'): DispatchOneTaskInput {
  return { feature: 'test-feature', task };
}

// ============================================================================
// Parallel helpers
// ============================================================================

describe('batch-tools parallel helpers', () => {
  test('resolveParallelPolicy defaults to unbounded', () => {
    expect(resolveParallelPolicy(undefined)).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
  });

  test('resolveParallelPolicy clamps maxConcurrency', () => {
    expect(resolveParallelPolicy({ strategy: 'bounded', maxConcurrency: 0 })).toEqual({
      strategy: 'bounded',
      maxConcurrency: 1,
    });
    expect(resolveParallelPolicy({ strategy: 'bounded', maxConcurrency: 99 })).toEqual({
      strategy: 'bounded',
      maxConcurrency: 32,
    });
  });

  test('mapWithConcurrencyLimit enforces bounded parallelism', async () => {
    const items = [1, 2, 3, 4, 5];
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrencyLimit(items, 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return item * 2;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});

// ============================================================================
// Batch dispatch parity with single dispatch
// ============================================================================

describe('batch-single dispatch parity', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    releaseAllDispatchLocks();
  });

  afterEach(() => {
    releaseAllDispatchLocks();
    cleanup();
  });

  test('single and batch dispatch produce identical response shapes on success', async () => {
    const services = createMockServices();

    // Single dispatch
    const singleResult = await dispatchOneTask(createInput('01-test-task'), services);
    // Batch dispatch (simulated — same function, different task)
    const batchResult = await dispatchOneTask(createInput('02-test-task'), services);

    // Both should have same shape
    expect(singleResult.success).toBe(true);
    expect(batchResult.success).toBe(true);

    // Same structural fields
    const singleKeys = Object.keys(singleResult).sort();
    const batchKeys = Object.keys(batchResult).sort();
    expect(singleKeys).toEqual(batchKeys);

    // Same agent
    expect(singleResult.agent).toBe(batchResult.agent);

    // Both have taskToolCall
    expect(singleResult.taskToolCall).toBeDefined();
    expect(batchResult.taskToolCall).toBeDefined();
    expect(singleResult.taskToolCall!.subagent_type).toBe(batchResult.taskToolCall!.subagent_type);
  });

  test('single and batch dispatch produce identical guard failures', async () => {
    // Guard: feature blocked
    const blockedServices = createMockServices({
      checkBlocked: () => ({ blocked: true, message: 'Feature blocked' }),
    });

    const singleBlocked = await dispatchOneTask(createInput('01-test-task'), blockedServices);
    const batchBlocked = await dispatchOneTask(createInput('02-test-task'), blockedServices);

    expect(singleBlocked.success).toBe(false);
    expect(batchBlocked.success).toBe(false);
    expect(singleBlocked.error).toBe(batchBlocked.error);

    // Guard: task not found
    const notFoundServices = createMockServices({
      taskService: {
        ...createMockServices().taskService,
        get: () => null,
      },
    });

    const singleNotFound = await dispatchOneTask(createInput('01-test-task'), notFoundServices);
    const batchNotFound = await dispatchOneTask(createInput('02-test-task'), notFoundServices);

    expect(singleNotFound.success).toBe(false);
    expect(batchNotFound.success).toBe(false);
    // Both should say "not found" (with different task names)
    expect(singleNotFound.error).toContain('not found');
    expect(batchNotFound.error).toContain('not found');
  });

  test('parallel dispatch of multiple tasks via dispatchOneTask succeeds independently', async () => {
    const services = createMockServices();

    // Simulate batch dispatch — fire multiple tasks in parallel
    const results = await Promise.all([
      dispatchOneTask(createInput('01-test-task'), services),
      dispatchOneTask(createInput('02-test-task'), services),
    ]);

    // All should succeed independently
    expect(results.every((r) => r.success)).toBe(true);

    // Each result identifies its own task
    expect(results[0].task).toBe('01-test-task');
    expect(results[1].task).toBe('02-test-task');
  });

  test('per-task lock prevents double dispatch in batch scenario', async () => {
    const services = createMockServices({
      worktreeService: {
        ...createMockServices().worktreeService,
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

    // Batch accidentally dispatches the same task twice
    const results = await Promise.all([
      dispatchOneTask(createInput('01-test-task'), services),
      dispatchOneTask(createInput('01-test-task'), services),
    ]);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error).toContain('already being dispatched');
  });
});
