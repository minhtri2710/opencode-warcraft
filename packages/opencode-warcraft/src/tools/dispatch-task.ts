import type { PlanService, TaskInfo, TaskService, TaskStatusType, WorktreeService } from 'warcraft-core';
import {
  DispatchCoordinator,
  type DispatchCoordinatorDeps,
  getTaskDispatchLockPath,
  releaseAllDispatchLocks,
} from '../services/dispatch-coordinator.js';
import type { BlockedResult } from '../types.js';
import type { SharedDispatchData } from './task-dispatch.js';

// ============================================================================
// Types — preserved for backward compatibility
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
    transition: (feature: string, task: string, toStatus: TaskStatusType, extras?: Record<string, unknown>) => void;
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
  /** Feature-level reopen rate from trust metrics (0.0–1.0). Defaults to 0. */
  featureReopenRate?: number;
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

// Re-export lock utilities from coordinator
export { getTaskDispatchLockPath, releaseAllDispatchLocks };

// ============================================================================
// Adapter: DispatchOneTaskServices → DispatchCoordinatorDeps
// ============================================================================

/**
 * Adapt `DispatchOneTaskServices` to `DispatchCoordinatorDeps`.
 *
 * The coordinator requires `worktreeService.remove` for rollback on prep failure.
 * If the caller's worktreeService doesn't have `remove`, we provide a no-op fallback
 * for backward compatibility.
 *
 * IMPORTANT: Methods are bound to preserve `this` context, since `WorktreeService`
 * is a class whose methods reference `this` internally.
 */
function toCoordinatorDeps(services: DispatchOneTaskServices): DispatchCoordinatorDeps {
  const ws = services.worktreeService as DispatchCoordinatorDeps['worktreeService'];
  const ts = services.taskService;
  return {
    taskService: {
      get: ts.get.bind(ts),
      update: ts.update.bind(ts),
      transition: ts.transition.bind(ts),
      getRawStatus: ts.getRawStatus.bind(ts),
      writeSpec: ts.writeSpec.bind(ts),
      writeWorkerPrompt: ts.writeWorkerPrompt.bind(ts),
      buildSpecData: ts.buildSpecData.bind(ts),
      list: ts.list.bind(ts),
      patchBackgroundFields: ts.patchBackgroundFields.bind(ts),
    },
    planService: services.planService,
    contextService: services.contextService,
    worktreeService: {
      create: ws.create.bind(ws),
      get: ws.get.bind(ws),
      remove: typeof ws.remove === 'function' ? ws.remove.bind(ws) : async () => {}, // no-op fallback for backward compat
    },
    checkBlocked: services.checkBlocked,
    checkDependencies: services.checkDependencies,
    verificationModel: services.verificationModel,
    featureReopenRate: services.featureReopenRate,
    lockDir: services.lockDir,
  };
}

// ============================================================================
// Unified dispatch — delegates to DispatchCoordinator
// ============================================================================

/**
 * Dispatch a single task with invariant guard checks and per-task concurrency lock.
 * This is the unified entry point used by both single-task (worktree) and batch dispatch.
 *
 * Delegates to {@link DispatchCoordinator} which fixes the premature state mutation
 * bug by transitioning to `in_progress` only after prompt/spec preparation succeeds.
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
  const coordinator = new DispatchCoordinator(toCoordinatorDeps(services));
  const result = await coordinator.dispatch(
    {
      feature: input.feature,
      task: input.task,
      continueFrom: input.continueFrom,
      decision: input.decision,
    },
    shared,
  );

  // Map coordinator result to the existing DispatchOneTaskResult shape
  // (strips the `prep` field that the coordinator exposes)
  return {
    task: result.task,
    success: result.success,
    agent: result.agent,
    worktreePath: result.worktreePath,
    branch: result.branch,
    error: result.error,
    taskToolCall: result.taskToolCall,
  };
}
