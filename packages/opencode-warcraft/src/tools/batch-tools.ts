import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { FeatureService, PlanService, TaskService, WorktreeService } from 'warcraft-core';
import type { BlockedResult, ToolContext } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { type DispatchOneTaskServices, dispatchOneTask } from './dispatch-task.js';
import { fetchSharedDispatchData } from './task-dispatch.js';
import { resolveFeatureInput, validateTaskInput } from './tool-input.js';

export interface BatchToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  contextService: {
    list: (feature: string) => Array<{ name: string; content: string }>;
  };
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (feature: string, taskFolder: string) => { allowed: boolean; error?: string };
  parallelExecution?: {
    strategy?: 'unbounded' | 'bounded';
    maxConcurrency?: number;
  };
  verificationModel: 'tdd' | 'best-effort';
  /** Lazy getter for feature-level reopen rate from trust metrics (0.0–1.0). Called at dispatch time. */
  getFeatureReopenRate?: () => number;
  /** Directory for per-task dispatch locks. */
  lockDir?: string;
}

export interface EffectiveParallelPolicy {
  strategy: 'unbounded' | 'bounded';
  maxConcurrency: number;
}

interface ParallelExecutionInput {
  strategy?: 'unbounded' | 'bounded';
  maxConcurrency?: number;
}

export function resolveParallelPolicy(config?: ParallelExecutionInput): EffectiveParallelPolicy {
  const strategy = config?.strategy === 'bounded' ? 'bounded' : 'unbounded';
  const configuredMax = Number.isInteger(config?.maxConcurrency) ? (config?.maxConcurrency as number) : 4;
  const maxConcurrency = Math.min(32, Math.max(1, configuredMax));

  return {
    strategy,
    maxConcurrency,
  };
}

export async function mapWithConcurrencyLimit<TInput, TOutput>(
  items: TInput[],
  maxConcurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

interface TaskDispatchResult {
  task: string;
  success: boolean;
  workspaceMode?: 'worktree' | 'direct';
  workspacePath?: string;
  branch?: string;
  agent: string;
  error?: string;
  taskToolCall?: {
    subagent_type: string;
    description: string;
    prompt: string;
  };
}

/**
 * Batch execution tools - Parallel task dispatch with operator approval
 */
export class BatchTools {
  constructor(private readonly deps: BatchToolsDependencies) {}

  /**
   * Identify and dispatch runnable tasks in parallel. Two modes:
   * - preview (default): show which tasks are ready for parallel execution
   * - execute: create worktrees and generate worker prompts for all specified tasks
   */
  batchExecuteTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    const {
      featureService,
      planService,
      taskService,
      worktreeService,
      contextService,
      checkBlocked,
      checkDependencies,
      verificationModel,
      getFeatureReopenRate,
      lockDir,
    } = this.deps;
    const parallelPolicy = resolveParallelPolicy(this.deps.parallelExecution);
    return tool({
      description:
        'Identify and dispatch runnable tasks in parallel. Use mode "preview" to see available tasks, then "execute" with selected tasks.',
      args: {
        mode: tool.schema
          .enum(['preview', 'execute'])
          .describe('preview: show runnable tasks. execute: dispatch selected tasks in parallel.'),
        tasks: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Task folders to execute in parallel (required for execute mode)'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
      },
      async execute({ mode, tasks: selectedTasks, feature: explicitFeature }, toolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const blockedResult = checkBlocked(feature);
        if (blockedResult.blocked) {
          return toolError(blockedResult.message || 'Feature is blocked');
        }

        const featureData = featureService.get(feature);
        if (!featureData) return toolError(`Feature '${feature}' not found`);

        const allTasks = taskService.list(feature);
        if (allTasks.length === 0) return toolError('No tasks found. Run warcraft_tasks_sync first.');

        const { runnable, blocked: blockedBy } = taskService.computeRunnableStatus(feature);

        if (mode === 'preview') {
          const inProgress = allTasks.filter((t) => t.status === 'in_progress');
          const done = allTasks.filter((t) => t.status === 'done');
          const blockedTasks = Object.entries(blockedBy).map(([folder, deps]) => ({
            folder,
            waitingOn: deps,
          }));

          return toolSuccess({
            feature,
            parallelPolicy,
            summary: {
              total: allTasks.length,
              done: done.length,
              inProgress: inProgress.length,
              runnable: runnable.length,
              blocked: blockedTasks.length,
            },
            runnable: runnable.map((folder) => {
              const task = allTasks.find((t) => t.folder === folder);
              return {
                folder,
                name: task?.planTitle ?? task?.name ?? folder,
              };
            }),
            blocked: blockedTasks.length > 0 ? blockedTasks : undefined,
            inProgress:
              inProgress.length > 0
                ? inProgress.map((t) => ({ folder: t.folder, name: t.planTitle ?? t.name }))
                : undefined,
            nextAction:
              runnable.length > 0
                ? `Call warcraft_batch_execute with mode "execute" and tasks: [${runnable.map((f) => `"${f}"`).join(', ')}]`
                : inProgress.length > 0
                  ? 'Wait for in-progress tasks to complete, then check again.'
                  : 'All tasks complete or blocked by dependencies.',
          });
        }

        // Execute mode
        if (!selectedTasks || selectedTasks.length === 0)
          return toolError('tasks array is required for execute mode. Use preview mode first to see runnable tasks.');

        for (const task of selectedTasks) {
          validateTaskInput(task);
        }

        // Validate all selected tasks are actually runnable using the same guard
        // semantics as single-task dispatch, but fail the entire request before
        // dispatching any work when the selection is mixed.
        const notRunnable: string[] = [];
        for (const task of selectedTasks) {
          const taskInfo = taskService.get(feature, task);
          if (!taskInfo) {
            notRunnable.push(`${task} (not found)`);
            continue;
          }
          if (taskInfo.status === 'blocked') {
            notRunnable.push(`${task} (blocked)`);
            continue;
          }
          if (taskInfo.status === 'done') {
            notRunnable.push(`${task} (already done)`);
            continue;
          }
          if (taskInfo.status === 'in_progress') {
            notRunnable.push(`${task} (already in progress)`);
            continue;
          }
          if (taskInfo.status === 'dispatch_prepared') {
            notRunnable.push(`${task} (already being dispatched)`);
            continue;
          }
          const depCheck = checkDependencies(feature, task);
          if (!depCheck.allowed) {
            notRunnable.push(`${task} (${depCheck.error || 'dependencies not met'})`);
          }
        }

        if (notRunnable.length > 0) {
          return toolError(`Some tasks cannot be dispatched: ${notRunnable.join(', ')}`, [
            'Use preview mode to see which tasks are actually runnable.',
          ]);
        }

        // Dispatch all tasks in parallel
        const featureReopenRate = getFeatureReopenRate?.();
        const sessionId = (toolContext as ToolContext | undefined)?.sessionID ?? featureService.getSession(feature);
        const shared = fetchSharedDispatchData(feature, {
          planService,
          taskService,
          contextService,
          verificationModel,
          featureReopenRate,
        });

        const dispatchTask = async (task: string): Promise<TaskDispatchResult> => {
          const unifiedServices: DispatchOneTaskServices = {
            taskService,
            planService,
            contextService,
            worktreeService,
            checkBlocked,
            checkDependencies,
            verificationModel,
            featureReopenRate,
            lockDir,
          };
          return dispatchOneTask({ feature, task, sessionId }, unifiedServices, shared);
        };

        const dispatched =
          parallelPolicy.strategy === 'bounded'
            ? await mapWithConcurrencyLimit(selectedTasks, parallelPolicy.maxConcurrency, async (task) =>
                dispatchTask(task),
              )
            : await Promise.all(selectedTasks.map((task) => dispatchTask(task)));

        const succeeded = dispatched.filter((r) => r.success);
        const failed = dispatched.filter((r) => !r.success);

        const taskCalls = succeeded.map((r) => r.taskToolCall!);

        return toolSuccess({
          feature,
          parallelPolicy,
          dispatched: {
            total: selectedTasks.length,
            succeeded: succeeded.length,
            failed: failed.length,
          },
          taskToolCalls: taskCalls,
          instructions:
            taskCalls.length > 0
              ? `## Parallel Dispatch Required\n\nIssue ALL ${taskCalls.length} task() calls in the SAME assistant message to run them in parallel:\n\n${taskCalls.map((tc, i) => `\`\`\`\ntask({\n  subagent_type: "${tc.subagent_type}",\n  description: "${tc.description}",\n  prompt: <prompt from taskToolCalls[${i}].prompt>\n})\n\`\`\``).join('\n\n')}`
              : undefined,
          failed: failed.length > 0 ? failed.map((r) => ({ task: r.task, error: r.error })) : undefined,
        });
      },
    });
  }
}
