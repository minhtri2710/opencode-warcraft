import type { PlanService, TaskService } from 'warcraft-core';
import { formatSpecContent } from 'warcraft-core';
import {
  applyContextBudget,
  applyTaskBudget,
  DEFAULT_BUDGET,
  type TruncationEvent,
} from '../utils/prompt-budgeting.js';
import { sanitizeLearnings } from '../utils/sanitize.js';
import { classifyComplexity, type TaskComplexity } from '../utils/task-complexity.js';
import type { CompletedTask, ContinueFromBlocked, WorkerContextFile } from '../utils/worker-prompt.js';
import { buildWorkerPrompt } from '../utils/worker-prompt.js';

// Re-export budget defaults for consumers that need them in response assembly
export { DEFAULT_BUDGET, type TruncationEvent };

export interface TaskDispatchInput {
  feature: string;
  task: string;
  taskInfo: { folder: string; name: string; planTitle?: string; summary?: string };
  workspace: { mode: 'worktree' | 'direct'; path: string; branch?: string };
  continueFrom?: ContinueFromBlocked;
}

export interface TaskDispatchServices {
  planService: PlanService;
  taskService: TaskService;
  contextService: { list: (feature: string) => Array<{ name: string; content: string }> };
  verificationModel: 'tdd' | 'best-effort';
  /** Feature-level reopen rate from trust metrics (0.0–1.0). Defaults to 0. */
  featureReopenRate?: number;
}

/**
 * Pre-fetched data shared across multiple task dispatches (batch path).
 * Avoids redundant reads of plan/tasks/context per task.
 */
export interface SharedDispatchData {
  planContent: string | null;
  allTasks: Array<{ folder: string; name: string; planTitle?: string }>;
  rawContextFiles: Array<{ name: string; content: string }>;
  rawPreviousTasks: Array<{ name: string; summary: string; learnings?: string[] }>;
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
  /** Classified task complexity level. */
  complexity: TaskComplexity;
  /** Prior-attempt context (present when previousAttempts > 0 and summary exists). */
  failureContext?: string;
}

/**
 * Normalize an optional reopen rate to a valid 0–1 number.
 * Returns 0 for missing, NaN, negative, or out-of-range values.
 */
function normalizeReopenRate(rate: number | undefined | null): number {
  if (rate == null || !Number.isFinite(rate) || rate < 0 || rate > 1) return 0;
  return rate;
}

/**
 * Fetch plan, tasks, and context for a feature.
 * Call once and pass the result to multiple `prepareTaskDispatch` calls
 * when dispatching a batch of tasks.
 */
export function fetchSharedDispatchData(feature: string, services: TaskDispatchServices): SharedDispatchData {
  const planResult = services.planService.read(feature);
  const allTasks = services.taskService.list(feature);

  const rawContextFiles = services.contextService.list(feature).map((f: { name: string; content: string }) => ({
    name: f.name,
    content: f.content,
  }));

  const rawPreviousTasks = allTasks
    .filter((t: { status: string; summary?: string }) => t.status === 'done' && t.summary)
    .map((t: { folder: string; summary?: string }) => {
      // Extract learnings from raw status for done tasks, with runtime sanitization
      const rawStatus = services.taskService.getRawStatus(feature, t.folder);
      const learnings = sanitizeLearnings(rawStatus?.learnings);

      // Fold learnings into summary for budget-aware rendering
      let summary = t.summary!;
      if (learnings) {
        const bullets = learnings.map((l) => `- ${l}`).join('\n');
        summary = `${summary}\n\nLearnings:\n${bullets}`;
      }

      return { name: t.folder, summary, learnings };
    });

  return {
    planContent: planResult?.content ?? null,
    allTasks: allTasks.map((t) => ({ folder: t.folder, name: t.name, planTitle: t.planTitle })),
    rawContextFiles,
    rawPreviousTasks,
  };
}

/**
 * Prepare spec, worker prompt, and budget metadata for a task dispatch.
 * Shared by both single-task and batch dispatch paths.
 *
 * @param input - Task-specific input (feature, task, workspace info)
 * @param services - Service dependencies for reading/writing
 * @param shared - Optional pre-fetched data (batch optimization); fetched on demand if omitted
 */
export function prepareTaskDispatch(
  input: TaskDispatchInput,
  services: TaskDispatchServices,
  shared?: SharedDispatchData,
): TaskDispatchPrep {
  const { feature, task, taskInfo, workspace, continueFrom } = input;
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

  const contextFiles: WorkerContextFile[] = contextBudgetResult.files.map((f: { name: string; content: string }) => ({
    name: f.name,
    content: f.content,
  }));

  // Build a lookup for learnings by task name (from pre-budget data)
  const learningsMap = new Map<string, string[]>();
  for (const t of data.rawPreviousTasks) {
    if (t.learnings) {
      learningsMap.set(t.name, t.learnings);
    }
  }

  const previousTasks: CompletedTask[] = taskBudgetResult.tasks.map((t: { name: string; summary: string }) => ({
    name: t.name,
    summary: t.summary,
    ...(learningsMap.has(t.name) ? { learnings: learningsMap.get(t.name) } : {}),
  }));

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

  // --- Compute complexity signals (FR-001 through FR-004, FR-009) ---
  const previousAttempts = status?.workerSession?.attempt ?? 0;
  const featureReopenRate = normalizeReopenRate(services.featureReopenRate);

  // Count file references in spec: paths like `src/foo.ts`, `file:`, or backtick-quoted paths
  const fileReferencePattern = /(?:`[^`]*\/[^`]+\.\w+`|[\w-]+\/[\w./-]+\.\w+)/g;
  const fileCount = (specContent.match(fileReferencePattern) || []).length;

  const complexity = classifyComplexity({
    specLength: specContent.length,
    fileCount,
    dependencyCount: dependsOn.length,
    previousAttempts,
    featureReopenRate,
  });

  // --- Build failure context (FR-008) ---
  const failureContext = previousAttempts > 0 && status?.summary ? status.summary : undefined;

  // Build and write worker prompt
  const workerPrompt = buildWorkerPrompt({
    feature,
    task,
    taskOrder,
    workspacePath: workspace.path,
    workspaceMode: workspace.mode,
    branch: workspace.branch,
    plan: data.planContent || 'No plan available',
    contextFiles,
    spec: specContent,
    previousTasks,
    continueFrom,
    verificationModel: services.verificationModel,
    complexity,
    failureContext,
  });

  taskService.writeWorkerPrompt(feature, task, workerPrompt);

  const persistedWorkerPrompt = workerPrompt;

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
    complexity,
    failureContext,
  };
}
