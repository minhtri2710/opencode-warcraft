import type { PlanService, TaskService } from 'warcraft-core';
import { formatSpecContent } from 'warcraft-core';
import type { WorkerContextFile, CompletedTask, ContinueFromBlocked } from '../utils/worker-prompt.js';
import { buildWorkerPrompt } from '../utils/worker-prompt.js';
import {
  applyTaskBudget,
  applyContextBudget,
  DEFAULT_BUDGET,
  type TruncationEvent,
} from '../utils/prompt-budgeting.js';

// Re-export budget defaults for consumers that need them in response assembly
export { DEFAULT_BUDGET, type TruncationEvent };

export interface TaskDispatchInput {
  feature: string;
  task: string;
  taskInfo: { folder: string; name: string; planTitle?: string; summary?: string };
  worktree: { path: string; branch: string };
  continueFrom?: ContinueFromBlocked;
}

export interface TaskDispatchServices {
  planService: PlanService;
  taskService: TaskService;
  contextService: { list: (feature: string) => Array<{ name: string; content: string }> };
}

/**
 * Pre-fetched data shared across multiple task dispatches (batch path).
 * Avoids redundant reads of plan/tasks/context per task.
 */
export interface SharedDispatchData {
  planContent: string | null;
  allTasks: Array<{ folder: string; name: string; planTitle?: string }>;
  rawContextFiles: Array<{ name: string; content: string }>;
  rawPreviousTasks: Array<{ name: string; summary: string }>;
}

export interface TaskDispatchPrep {
  specContent: string;
  workerPrompt: string;
  persistedWorkerPrompt: string | null;
  contextFiles: WorkerContextFile[];
  previousTasks: CompletedTask[];
  truncationEvents: TruncationEvent[];
  droppedTasksHint?: string;
  taskBeadId: string;
  planContent: string | null;
}

/**
 * Fetch plan, tasks, and context for a feature.
 * Call once and pass the result to multiple `prepareTaskDispatch` calls
 * when dispatching a batch of tasks.
 */
export function fetchSharedDispatchData(
  feature: string,
  services: TaskDispatchServices,
): SharedDispatchData {
  const planResult = services.planService.read(feature);
  const allTasks = services.taskService.list(feature);

  const rawContextFiles = services.contextService.list(feature).map((f: { name: string; content: string }) => ({
    name: f.name,
    content: f.content,
  }));

  const rawPreviousTasks = allTasks
    .filter((t: { status: string; summary?: string }) => t.status === 'done' && t.summary)
    .map((t: { folder: string; summary?: string }) => ({ name: t.folder, summary: t.summary! }));

  return {
    planContent: planResult?.content ?? null,
    allTasks: allTasks.map((t) => ({ folder: t.folder, name: t.name, planTitle: t.planTitle })),
    rawContextFiles,
    rawPreviousTasks,
  };
}

/**
 * Prepare spec, worker prompt, and budget metadata for a task dispatch.
 * Shared by both single-task (worktree) and batch dispatch paths.
 *
 * @param input - Task-specific input (feature, task, worktree info)
 * @param services - Service dependencies for reading/writing
 * @param shared - Optional pre-fetched data (batch optimization); fetched on demand if omitted
 */
export function prepareTaskDispatch(
  input: TaskDispatchInput,
  services: TaskDispatchServices,
  shared?: SharedDispatchData,
): TaskDispatchPrep {
  const { feature, task, taskInfo, worktree, continueFrom } = input;
  const { taskService } = services;

  // Use pre-fetched data or fetch fresh
  const data = shared ?? fetchSharedDispatchData(feature, services);

  // Apply budgets
  const taskBudgetResult = applyTaskBudget(data.rawPreviousTasks, {
    ...DEFAULT_BUDGET,
    feature,
  });

  const contextBudgetResult = applyContextBudget(data.rawContextFiles, {
    ...DEFAULT_BUDGET,
    feature,
  });

  const contextFiles: WorkerContextFile[] = contextBudgetResult.files.map(
    (f: { name: string; content: string }) => ({
      name: f.name,
      content: f.content,
    }),
  );

  const previousTasks: CompletedTask[] = taskBudgetResult.tasks.map(
    (t: { name: string; summary: string }) => ({
      name: t.name,
      summary: t.summary,
    }),
  );

  const truncationEvents: TruncationEvent[] = [
    ...taskBudgetResult.truncationEvents,
    ...contextBudgetResult.truncationEvents,
  ];

  const droppedTasksHint = taskBudgetResult.droppedTasksHint;

  // Parse task order from folder name
  const taskOrder = parseInt(taskInfo.folder.match(/^(\d+)/)?.[1] || '0', 10);

  // Get raw status / dependsOn
  const status = taskService.getRawStatus(feature, task);
  const dependsOn = status?.dependsOn ?? [];

  // Build structured spec data and format
  const specData = taskService.buildSpecData({
    featureName: feature,
    task: {
      folder: task,
      name: taskInfo.planTitle ?? taskInfo.name,
      order: taskOrder,
    },
    dependsOn,
    allTasks: data.allTasks.map((t) => ({
      folder: t.folder,
      name: t.name,
      order: parseInt(t.folder.match(/^(\d+)/)?.[1] || '0', 10),
    })),
    planContent: data.planContent,
    contextFiles,
    completedTasks: previousTasks,
  });
  const specContent = formatSpecContent(specData);

  // Write spec and get bead ID
  const taskBeadId = taskService.writeSpec(feature, task, specContent);

  // Build and write worker prompt
  const workerPrompt = buildWorkerPrompt({
    feature,
    task,
    taskOrder,
    worktreePath: worktree.path,
    branch: worktree.branch,
    plan: data.planContent || 'No plan available',
    contextFiles,
    spec: specContent,
    previousTasks,
    continueFrom,
  });

  taskService.writeWorkerPrompt(feature, task, workerPrompt);

  // Read persisted worker prompt back (bead round-trip verification)
  const persistedWorkerPrompt = taskService.readTaskBeadArtifact(
    feature,
    task,
    'worker_prompt',
  );

  return {
    specContent,
    workerPrompt,
    persistedWorkerPrompt,
    contextFiles,
    previousTasks,
    truncationEvents,
    droppedTasksHint,
    taskBeadId,
    planContent: data.planContent,
  };
}
