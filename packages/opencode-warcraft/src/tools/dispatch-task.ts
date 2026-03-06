import * as fs from 'fs';
import * as path from 'path';
import type { PlanService, TaskInfo, TaskService, TaskStatusType, WorktreeService } from 'warcraft-core';
import { acquireLock } from 'warcraft-core';
import type { BlockedResult } from '../types.js';
import type { ContinueFromBlocked } from '../utils/worker-prompt.js';
import { fetchSharedDispatchData, prepareTaskDispatch, type SharedDispatchData } from './task-dispatch.js';

// ============================================================================
// Types
// ============================================================================

export interface DispatchOneTaskInput {
  feature: string;
  task: string;
  /** Resume a blocked task */
  continueFrom?: 'blocked';
  /** Answer to blocker question when continuing */
  decision?: string;
}

export interface DispatchOneTaskServices {
  taskService: {
    get: (feature: string, task: string) => TaskInfo | null;
    update: (feature: string, task: string, patch: Record<string, unknown>) => void;
    getRawStatus: (
      feature: string,
      task: string,
    ) => {
      status: TaskStatusType;
      origin: string;
      dependsOn?: string[];
      workerSession?: { attempt?: number };
      summary?: string;
    } | null;
    writeSpec: (feature: string, task: string, content: string) => string;
    writeWorkerPrompt: (feature: string, task: string, prompt: string) => void;
    buildSpecData: TaskService['buildSpecData'];
    list: TaskService['list'];
    patchBackgroundFields: (feature: string, task: string, patch: Record<string, unknown>) => void;
  };
  planService: {
    read: PlanService['read'];
  };
  contextService: {
    list: (feature: string) => Array<{ name: string; content: string }>;
  };
  worktreeService: {
    create: WorktreeService['create'];
    get: WorktreeService['get'];
  };
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (feature: string, taskFolder: string) => { allowed: boolean; error?: string };
  verificationModel: 'tdd' | 'best-effort';
  /** Directory for per-task dispatch locks. If omitted, locks are skipped. */
  lockDir?: string;
}

export interface DispatchOneTaskResult {
  task: string;
  success: boolean;
  agent: string;
  worktreePath?: string;
  branch?: string;
  error?: string;
  taskToolCall?: {
    subagent_type: string;
    description: string;
    prompt: string;
  };
}

// ============================================================================
// Per-task dispatch lock
// ============================================================================

/** In-process lock tracking to prevent duplicate concurrent dispatches. */
const activeLocks = new Map<string, () => void>();

/**
 * Get the filesystem path for a per-task dispatch lock.
 */
export function getTaskDispatchLockPath(lockDir: string, feature: string, task: string): string {
  return path.join(lockDir, `${feature}--${task}.dispatch.lock`);
}

/**
 * Release all held dispatch locks. Used in tests for cleanup.
 */
export function releaseAllDispatchLocks(): void {
  for (const release of activeLocks.values()) {
    try {
      release();
    } catch {
      // Best-effort cleanup
    }
  }
  activeLocks.clear();
}

/**
 * Acquire a per-task dispatch lock. Returns a release function, or null if
 * the task is already being dispatched.
 */
async function acquireDispatchLock(
  lockDir: string,
  feature: string,
  task: string,
): Promise<{ release: () => void } | null> {
  const lockKey = `${feature}/${task}`;

  // Fast in-process check
  if (activeLocks.has(lockKey)) {
    return null;
  }

  const lockPath = getTaskDispatchLockPath(lockDir, feature, task);

  // Ensure lock directory exists
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  try {
    const fsRelease = await acquireLock(lockPath, {
      timeout: 0, // Fail immediately — no waiting for concurrent dispatches
      retryInterval: 10,
      staleLockTTL: 60_000, // 1 minute stale TTL
    });

    const release = (): void => {
      activeLocks.delete(lockKey);
      fsRelease();
    };

    activeLocks.set(lockKey, release);
    return { release };
  } catch {
    // Lock acquisition failed — task is already being dispatched
    return null;
  }
}

// ============================================================================
// Unified dispatch
// ============================================================================

/**
 * Dispatch a single task with invariant guard checks and per-task concurrency lock.
 * This is the unified entry point used by both single-task (worktree) and batch dispatch.
 *
 * Invariants enforced:
 * 1. Feature not blocked
 * 2. Task exists
 * 3. Task not already done
 * 4. Dependencies met (unless continuing from blocked)
 * 5. Per-task concurrency lock prevents duplicate dispatch
 */
export async function dispatchOneTask(
  input: DispatchOneTaskInput,
  services: DispatchOneTaskServices,
  shared?: SharedDispatchData,
): Promise<DispatchOneTaskResult> {
  const { feature, task, continueFrom, decision } = input;
  const agent = 'mekkatorque';

  const fail = (error: string): DispatchOneTaskResult => ({
    task,
    success: false,
    agent,
    error,
  });

  // --- Guard 1: Feature blocked ---
  const blockedResult = services.checkBlocked(feature);
  if (blockedResult.blocked) {
    return fail(blockedResult.message || 'Feature is blocked');
  }

  // --- Guard 2: Task exists ---
  const taskInfo = services.taskService.get(feature, task);
  if (!taskInfo) {
    return fail(`Task "${task}" not found`);
  }

  // --- Guard 3: Task not already done ---
  if (taskInfo.status === 'done') {
    return fail(`Task "${task}" already done`);
  }

  // --- Guard 4: Continue-from-blocked validation ---
  if (continueFrom === 'blocked') {
    if (taskInfo.status !== 'blocked') {
      return fail(`Task "${task}" is not in blocked state. Cannot continue from blocked.`);
    }
  } else {
    // --- Guard 5: Dependencies ---
    const depCheck = services.checkDependencies(feature, task);
    if (!depCheck.allowed) {
      return fail(depCheck.error || 'Dependencies not met');
    }

    // Reject in-progress tasks only for non-blocked resumes
    if (taskInfo.status === 'in_progress') {
      return fail(`Task "${task}" already in progress`);
    }
  }

  // --- Guard 6: Per-task concurrency lock ---
  let lockHandle: { release: () => void } | null = null;
  if (services.lockDir) {
    lockHandle = await acquireDispatchLock(services.lockDir, feature, task);
    if (!lockHandle) {
      return fail(`Task "${task}" is already being dispatched (concurrency lock held)`);
    }
  }

  try {
    // --- Create or reuse worktree ---
    let worktree: Awaited<ReturnType<typeof services.worktreeService.create>>;
    if (continueFrom === 'blocked') {
      const existing = await services.worktreeService.get(feature, task);
      if (!existing) {
        return fail(`No worktree found for blocked task "${task}"`);
      }
      worktree = existing;
    } else {
      worktree = await services.worktreeService.create(feature, task);
    }

    // --- Update task status ---
    const updatePayload: Record<string, unknown> = { status: 'in_progress' };
    if (continueFrom !== 'blocked') {
      updatePayload.baseCommit = worktree.commit;
    }
    services.taskService.update(feature, task, updatePayload);

    // --- Prepare dispatch ---
    const continueFromData: ContinueFromBlocked | undefined =
      continueFrom === 'blocked'
        ? {
            status: 'blocked',
            previousSummary: taskInfo.summary || 'No previous summary',
            decision: decision || 'No decision provided',
          }
        : undefined;

    const prep = prepareTaskDispatch(
      {
        feature,
        task,
        taskInfo,
        worktree,
        continueFrom: continueFromData,
      },
      {
        planService: services.planService as PlanService,
        taskService: services.taskService as TaskService,
        contextService: services.contextService,
        verificationModel: services.verificationModel,
      },
      shared,
    );

    if (!prep.persistedWorkerPrompt || prep.persistedWorkerPrompt.trim().length === 0) {
      return fail(`Failed to persist worker prompt for task "${task}"`);
    }

    return {
      task,
      success: true,
      agent,
      worktreePath: worktree.path,
      branch: worktree.branch,
      taskToolCall: {
        subagent_type: agent,
        description: `Warcraft: ${task}`,
        prompt: prep.persistedWorkerPrompt,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(reason);
  } finally {
    // Always release lock
    lockHandle?.release();
  }
}
