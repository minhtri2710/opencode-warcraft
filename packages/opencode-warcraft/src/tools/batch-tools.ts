import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type {
  FeatureService,
  PlanService,
  TaskService,
  WorktreeService,
} from 'warcraft-core';
import {
  buildEffectiveDependencies,
  computeRunnableAndBlocked,
  formatSpecContent,
  type TaskWithDeps,
} from 'warcraft-core';
import { validatePathSegment } from './index.js';
import type { ContextFile, CompletedTask } from '../utils/worker-prompt.js';
import {
  applyTaskBudget,
  applyContextBudget,
  DEFAULT_BUDGET,
} from '../utils/prompt-budgeting.js';
import { buildWorkerPrompt } from '../utils/worker-prompt.js';
import type { BlockedResult } from '../types.js';
import { toolError, toolSuccess } from '../types.js';

export interface BatchToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  contextService: {
    list: (feature: string) => Array<{ name: string; content: string }>;
  };
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (
    feature: string,
    taskFolder: string,
  ) => { allowed: boolean; error?: string };
  parallelExecution?: {
    strategy?: 'unbounded' | 'bounded';
    maxConcurrency?: number;
  };
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
  const configuredMax = Number.isInteger(config?.maxConcurrency)
    ? (config?.maxConcurrency as number)
    : 4;
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
  worktreePath?: string;
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
    const { featureService, planService, taskService, worktreeService, contextService, checkBlocked, checkDependencies } = this.deps;
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
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to active)'),
      },
      async execute({ mode, tasks: selectedTasks, feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return toolError('No feature specified. Create a feature or provide feature param.');

        const blockedResult = checkBlocked(feature);
        if (blockedResult.blocked) {
          return toolError(blockedResult.message || 'Feature is blocked');
        }

        const featureData = featureService.get(feature);
        if (!featureData)
          return toolError(`Feature '${feature}' not found`);

        const allTasks = taskService.list(feature);
        if (allTasks.length === 0)
          return toolError('No tasks found. Run warcraft_tasks_sync first.');

        const tasksWithDeps: TaskWithDeps[] = allTasks.map((t) => {
          const rawStatus = taskService.getRawStatus(feature, t.folder);
          return {
            folder: t.folder,
            status: t.status,
            dependsOn: rawStatus?.dependsOn,
          };
        });

        const effectiveDeps = buildEffectiveDependencies(tasksWithDeps);
        const normalizedTasks = tasksWithDeps.map((task) => ({
          ...task,
          dependsOn: effectiveDeps.get(task.folder),
        }));
        const { runnable, blocked: blockedBy } = computeRunnableAndBlocked(normalizedTasks);

        if (mode === 'preview') {
          const inProgress = allTasks.filter((t) => t.status === 'in_progress');
          const done = allTasks.filter((t) => t.status === 'done');
          const blockedTasks = Object.entries(blockedBy).map(([folder, deps]) => ({
            folder,
            waitingOn: deps,
          }));

          return JSON.stringify({
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
            inProgress: inProgress.length > 0
              ? inProgress.map((t) => ({ folder: t.folder, name: t.planTitle ?? t.name }))
              : undefined,
            nextAction: runnable.length > 0
              ? `Call warcraft_batch_execute with mode "execute" and tasks: [${runnable.map((f) => `"${f}"`).join(', ')}]`
              : inProgress.length > 0
                ? 'Wait for in-progress tasks to complete, then check again.'
                : 'All tasks complete or blocked by dependencies.',
          }, null, 2);
        }

        // Execute mode
        if (!selectedTasks || selectedTasks.length === 0)
          return toolError('tasks array is required for execute mode. Use preview mode first to see runnable tasks.');

        for (const task of selectedTasks) {
          validatePathSegment(task, 'task');
        }

        // Validate all selected tasks are actually runnable
        const notRunnable: string[] = [];
        for (const task of selectedTasks) {
          const taskInfo = taskService.get(feature, task);
          if (!taskInfo) {
            notRunnable.push(`${task} (not found)`);
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
          const depCheck = checkDependencies(feature, task);
          if (!depCheck.allowed) {
            notRunnable.push(`${task} (dependencies not met)`);
          }
        }

        if (notRunnable.length > 0) {
          return JSON.stringify({
            success: false,
            error: 'Some tasks cannot be dispatched',
            notRunnable,
            hint: 'Use preview mode to see which tasks are actually runnable.',
          }, null, 2);
        }

        // Dispatch all tasks in parallel
        const planResult = planService.read(feature);
        const allTaskInfos = taskService.list(feature);
        const rawContextFiles = contextService.list(feature).map((f) => ({
          name: f.name,
          content: f.content,
        }));
        const rawPreviousTasks = allTaskInfos
          .filter((t) => t.status === 'done' && t.summary)
          .map((t) => ({ name: t.folder, summary: t.summary! }));

        const dispatchTask = async (task: string): Promise<TaskDispatchResult> => {
          const taskInfo = taskService.get(feature, task);
          if (!taskInfo) {
            return { task, success: false, agent: 'mekkatorque', error: 'Task not found' };
          }

          try {
            const worktree = await worktreeService.create(feature, task);

            taskService.update(feature, task, {
              status: 'in_progress',
              baseCommit: worktree.commit,
            });

            const taskBudgetResult = applyTaskBudget(rawPreviousTasks, {
              ...DEFAULT_BUDGET,
              feature,
            });
            const contextBudgetResult = applyContextBudget(rawContextFiles, {
              ...DEFAULT_BUDGET,
              feature,
            });

            const contextFiles: ContextFile[] = contextBudgetResult.files.map((f) => ({
              name: f.name,
              content: f.content,
            }));
            const previousTasks: CompletedTask[] = taskBudgetResult.tasks.map((t) => ({
              name: t.name,
              summary: t.summary,
            }));

            const taskOrder = parseInt(taskInfo.folder.match(/^(\d+)/)?.[1] || '0', 10);
            const status = taskService.getRawStatus(feature, task);
            const dependsOn = status?.dependsOn ?? [];
            const specData = taskService.buildSpecData({
              featureName: feature,
              task: {
                folder: task,
                name: taskInfo.planTitle ?? taskInfo.name,
                order: taskOrder,
                description: undefined,
              },
              dependsOn,
              allTasks: allTaskInfos.map((t) => ({
                folder: t.folder,
                name: t.name,
                order: parseInt(t.folder.match(/^(\d+)/)?.[1] || '0', 10),
              })),
              planContent: planResult?.content ?? null,
              contextFiles,
              completedTasks: previousTasks,
            });
            const specContent = formatSpecContent(specData);

            taskService.writeSpec(feature, task, specContent);

            const workerPrompt = buildWorkerPrompt({
              feature,
              task,
              taskOrder,
              worktreePath: worktree.path,
              branch: worktree.branch,
              plan: planResult?.content || 'No plan available',
              contextFiles,
              spec: specContent,
              previousTasks,
            });

            taskService.writeWorkerPrompt(feature, task, workerPrompt);

            const persistedWorkerPrompt = taskService.readTaskBeadArtifact(
              feature,
              task,
              'worker_prompt',
            );
            if (!persistedWorkerPrompt || persistedWorkerPrompt.trim().length === 0) {
              return {
                task,
                success: false,
                agent: 'mekkatorque',
                error: 'Failed to persist worker prompt',
              };
            }

            const agent = 'mekkatorque';

            return {
              task,
              success: true,
              worktreePath: worktree.path,
              branch: worktree.branch,
              agent,
              taskToolCall: {
                subagent_type: agent,
                description: `Warcraft: ${task}`,
                prompt: persistedWorkerPrompt,
              },
            };
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            return { task, success: false, agent: 'mekkatorque', error: reason };
          }
        };

        const dispatched = parallelPolicy.strategy === 'bounded'
          ? await mapWithConcurrencyLimit(
            selectedTasks,
            parallelPolicy.maxConcurrency,
            async (task) => dispatchTask(task),
          )
          : await Promise.all(selectedTasks.map((task) => dispatchTask(task)));

        const succeeded = dispatched.filter((r) => r.success);
        const failed = dispatched.filter((r) => !r.success);

        const taskCalls = succeeded.map((r) => r.taskToolCall!);

        return JSON.stringify({
          success: failed.length === 0,
          feature,
          parallelPolicy,
          dispatched: {
            total: selectedTasks.length,
            succeeded: succeeded.length,
            failed: failed.length,
          },
          taskToolCalls: taskCalls,
          instructions: taskCalls.length > 0
            ? `## Parallel Dispatch Required\n\nIssue ALL ${taskCalls.length} task() calls in the SAME assistant message to run them in parallel:\n\n${taskCalls.map((tc, i) => `\`\`\`\ntask({\n  subagent_type: "${tc.subagent_type}",\n  description: "${tc.description}",\n  prompt: <prompt from taskToolCalls[${i}].prompt>\n})\n\`\`\``).join('\n\n')}`
            : undefined,
          failed: failed.length > 0
            ? failed.map((r) => ({ task: r.task, error: r.error }))
            : undefined,
        }, null, 2);
      },
    });
  }
}
