import * as fs from 'fs';
import * as path from 'path';
import type { PlanService, TaskInfo, TaskService, TaskStatusType, WorktreeService } from 'warcraft-core';
import { acquireLock } from 'warcraft-core';
import { prepareTaskDispatch, type SharedDispatchData, type TaskDispatchPrep } from '../tools/task-dispatch.js';
import type { BlockedResult } from '../types.js';
import type { ContinueFromBlocked } from '../utils/worker-prompt.js';

// ============================================================================
// Types
// ============================================================================

export interface DispatchRequest {
  feature: string;
  task: string;
  /** Resume a blocked task */
  continueFrom?: 'blocked';
  /** Answer to blocker question when continuing */
  decision?: string;
}

export interface DispatchResult {
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
  /** Full prep metadata (available on success) for callers that need prompt/spec details. */
  prep?: TaskDispatchPrep;
}

export interface DispatchCoordinatorDeps {
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
      learnings?: unknown;
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
    remove: (feature: string, step: string, deleteBranch?: boolean) => Promise<void>;
  };
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (feature: string, taskFolder: string) => { allowed: boolean; error?: string };
  verificationModel: 'tdd' | 'best-effort';
  /** Feature-level reopen rate from trust metrics (0.0–1.0). Defaults to 0. */
  featureReopenRate?: number;
  /** Directory for per-task dispatch locks. If omitted, locks are skipped. */
  lockDir?: string;
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
// DispatchCoordinator
// ============================================================================

/**
 * Single dispatch path that performs:
 * 1. Lock/acquire → 2. Validate → 3. Create/reuse worktree →
 * 4. Build prompt/spec → 5. Transition to `in_progress` ONLY AFTER prep succeeds →
 * 6. Emit dispatch result metadata.
 *
 * Fixes the premature state mutation bug where tasks were set to `in_progress`
 * before prompt preparation, which could strand tasks if prep failed.
 */
export class DispatchCoordinator {
  constructor(private readonly deps: DispatchCoordinatorDeps) {}

  /**
   * Dispatch a single task. This is the unified entry point used by both
   * single-task (worktree) and batch dispatch.
   *
   * @param request - Task dispatch request
   * @param shared - Optional pre-fetched data (batch optimization)
   */
  async dispatch(request: DispatchRequest, shared?: SharedDispatchData): Promise<DispatchResult> {
    const { feature, task, continueFrom, decision } = request;
    const agent = 'mekkatorque';

    const fail = (error: string): DispatchResult => ({
      task,
      success: false,
      agent,
      error,
    });

    // --- Guard 1: Feature blocked ---
    const blockedResult = this.deps.checkBlocked(feature);
    if (blockedResult.blocked) {
      return fail(blockedResult.message || 'Feature is blocked');
    }

    // --- Guard 2: Task exists ---
    const taskInfo = this.deps.taskService.get(feature, task);
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
      const depCheck = this.deps.checkDependencies(feature, task);
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
    if (this.deps.lockDir) {
      lockHandle = await acquireDispatchLock(this.deps.lockDir, feature, task);
      if (!lockHandle) {
        return fail(`Task "${task}" is already being dispatched (concurrency lock held)`);
      }
    }

    // Track whether we created a new worktree (for rollback on failure)
    const isNewWorktree = continueFrom !== 'blocked';

    try {
      // --- Create or reuse worktree ---
      let worktree: Awaited<ReturnType<typeof this.deps.worktreeService.create>>;
      if (continueFrom === 'blocked') {
        const existing = await this.deps.worktreeService.get(feature, task);
        if (!existing) {
          return fail(`No worktree found for blocked task "${task}"`);
        }
        worktree = existing;
      } else {
        worktree = await this.deps.worktreeService.create(feature, task);
      }

      // --- Prepare dispatch (prompt/spec assembly) ---
      // CRITICAL: This happens BEFORE status transition to avoid stranding tasks
      let prep: TaskDispatchPrep;
      try {
        const continueFromData: ContinueFromBlocked | undefined =
          continueFrom === 'blocked'
            ? {
                status: 'blocked',
                previousSummary: taskInfo.summary || 'No previous summary',
                decision: decision || 'No decision provided',
              }
            : undefined;

        prep = prepareTaskDispatch(
          {
            feature,
            task,
            taskInfo,
            worktree,
            continueFrom: continueFromData,
          },
          {
            planService: this.deps.planService as PlanService,
            taskService: this.deps.taskService as TaskService,
            contextService: this.deps.contextService,
            verificationModel: this.deps.verificationModel,
            featureReopenRate: this.deps.featureReopenRate,
          },
          shared,
        );

        if (!prep.persistedWorkerPrompt || prep.persistedWorkerPrompt.trim().length === 0) {
          throw new Error(`Failed to persist worker prompt for task "${task}"`);
        }
      } catch (prepError) {
        // Prep failed — rollback freshly created worktree
        if (isNewWorktree) {
          try {
            await this.deps.worktreeService.remove(feature, task);
          } catch {
            // Best-effort rollback — don't mask the original error
          }
        }
        const reason = prepError instanceof Error ? prepError.message : String(prepError);
        return fail(reason);
      }

      // --- Transition to in_progress ONLY after prep succeeds ---
      const updatePayload: Record<string, unknown> = { status: 'in_progress' };
      if (continueFrom !== 'blocked') {
        updatePayload.baseCommit = worktree.commit;
      }
      this.deps.taskService.update(feature, task, updatePayload);

      return {
        task,
        success: true,
        agent,
        worktreePath: worktree.path,
        branch: worktree.branch,
        taskToolCall: {
          subagent_type: agent,
          description: `Warcraft: ${task}`,
          prompt: prep.persistedWorkerPrompt!,
        },
        prep,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(reason);
    } finally {
      // Always release lock
      lockHandle?.release();
    }
  }
}
