import type {
  BeadsMode,
  SpecData,
  TaskInfo,
  TaskStatus,
  TaskStatusType,
  TaskSyncReconciliation,
  TasksSyncResult,
  WorkerSession,
} from '../types.js';
import { readText } from '../utils/fs.js';
import type { LockOptions } from '../utils/json-lock.js';
import type { Logger } from '../utils/logger.js';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, sanitizeName } from '../utils/paths.js';
import { deriveTaskFolder, slugifyTaskName } from '../utils/slug.js';
import type { Diagnostic } from './outcomes.js';
import { fromError } from './outcomes.js';
import { formatSpecContent } from './specFormatter.js';
import type { TaskStore } from './state/types.js';
import { validateTransition } from './task-state-machine.js';
import type { RunnableBlockedResult, TaskWithDeps } from './taskDependencyGraph.js';
import { buildEffectiveDependencies, computeRunnableAndBlocked } from './taskDependencyGraph.js';

/** Current schema version for TaskStatus */
export const TASK_STATUS_SCHEMA_VERSION = 1;

/** Fields that can be updated by background workers without clobbering completion-owned fields */
export interface BackgroundPatchFields {
  idempotencyKey?: string;
  workerSession?: Partial<WorkerSession>;
}

/** Fields owned by the completion flow (not to be touched by background patches) */
export interface CompletionFields {
  status?: TaskStatusType;
  summary?: string;
  completedAt?: string;
}

interface ParsedTask {
  folder: string;
  order: number;
  name: string;
  description: string;
  /** Raw dependency numbers parsed from plan. null = not specified (use implicit), [] = explicit none */
  dependsOnNumbers: number[] | null;
}

export interface RunnableTask {
  folder: string;
  name: string;
  status: TaskStatusType;
  beadId?: string;
}

export interface RunnableTasksResult {
  /** Tasks that can be executed now (dependencies satisfied) */
  runnable: RunnableTask[];
  /** Tasks that are blocked by dependencies */
  blocked: RunnableTask[];
  /** Tasks already completed */
  completed: RunnableTask[];
  /** Tasks currently in progress */
  inProgress: RunnableTask[];
  /** Source of the result: 'beads' or 'filesystem' */
  source: 'beads' | 'filesystem';
}

/** Internal reconciliation action for an existing task that must be rewritten to canonical plan metadata. */
interface ReconciliationAction {
  currentTask: TaskInfo;
  planTask: ParsedTask;
  dependsOn: string[];
  currentStatus: TaskStatus | null;
}

/** Internal result from computing the sync delta between plan and existing tasks. */
interface SyncDelta {
  planTasks: ParsedTask[];
  planContent: string;
  kept: string[];
  removed: string[];
  created: string[];
  reconciled: ReconciliationAction[];
  manual: string[];
}

/** Options for TaskService behavior. */
export interface TaskServiceOptions {
  /** When true, enforce the state machine - reject invalid transitions. Default: false (compat mode). */
  strictTaskTransitions?: boolean;
}

function isLogger(value: unknown): value is Logger {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.debug === 'function' &&
    typeof candidate.info === 'function' &&
    typeof candidate.warn === 'function' &&
    typeof candidate.error === 'function'
  );
}

export class TaskService {
  private readonly logger: Logger;
  private readonly options: Required<TaskServiceOptions>;

  constructor(
    private projectRoot: string,
    private readonly store: TaskStore,
    private readonly beadsMode: BeadsMode = 'on',
    loggerOrOptions?: Logger | TaskServiceOptions,
    maybeOptions?: TaskServiceOptions,
  ) {
    const logger = isLogger(loggerOrOptions) ? loggerOrOptions : undefined;
    const options = isLogger(loggerOrOptions) ? maybeOptions : loggerOrOptions;

    this.logger = logger ?? createNoopLogger();
    this.options = {
      strictTaskTransitions: options?.strictTaskTransitions ?? false,
    };
  }

  /**
   * Preview what tasks_sync would create/remove without making changes.
   * Useful for dry-run validation before committing to sync.
   */
  previewSync(featureName: string): TasksSyncResult {
    const delta = this._computeSyncDelta(featureName);
    return this.buildSyncResult(delta);
  }

  sync(featureName: string): TasksSyncResult {
    const delta = this._computeSyncDelta(featureName);
    const supportsTransitionBatch =
      typeof this.store.beginTransitionBatch === 'function' && typeof this.store.endTransitionBatch === 'function';

    if (supportsTransitionBatch) {
      this.store.beginTransitionBatch!();
    }

    const createdFolders: string[] = [];
    const diagnostics: Diagnostic[] = [];

    try {
      for (const folder of delta.removed) {
        this.store.delete(featureName, folder);
      }

      for (const action of delta.reconciled) {
        this.applyTaskReconciliation(featureName, action);
      }

      const createdSet = new Set(delta.created);
      for (const planTask of delta.planTasks) {
        if (!createdSet.has(planTask.folder)) {
          continue;
        }

        const dependsOn = this.resolveDependencies(planTask, delta.planTasks);

        const status: TaskStatus = {
          status: 'pending',
          origin: 'plan',
          planTitle: planTask.name,
          dependsOn,
        };

        this.store.createTask(featureName, planTask.folder, planTask.name, status, 3);
        createdFolders.push(planTask.folder);

        const specData = this.buildSpecData({
          featureName,
          task: planTask,
          dependsOn,
          allTasks: delta.planTasks,
          planContent: delta.planContent,
        });
        const specContent = formatSpecContent(specData);
        this.store.writeArtifact(featureName, planTask.folder, 'spec', specContent);
      }

      this.store.flush();

      if (this.store.syncDependencies) {
        try {
          const dependencyDiagnostics = this.store.syncDependencies(featureName) ?? [];
          diagnostics.push(...dependencyDiagnostics);
          for (const diag of dependencyDiagnostics) {
            this.logger.warn(`Dependency sync issue for '${featureName}' (degraded): ${diag.message}`, {
              featureName,
              code: diag.code,
            });
          }
        } catch (depError) {
          const diag = fromError('dep_sync_failed', depError, 'degraded', { featureName });
          diagnostics.push(diag);
          this.logger.warn(`Dependency sync failed after task sync for '${featureName}' (degraded): ${diag.message}`, {
            featureName,
            code: diag.code,
          });
        }
      }
    } catch (error) {
      let rollbackSuccessCount = 0;
      let rollbackFailureCount = 0;

      for (const folder of createdFolders) {
        try {
          this.store.delete(featureName, folder);
          rollbackSuccessCount++;
        } catch (rollbackError) {
          rollbackFailureCount++;
          const diag = fromError('rollback_failed', rollbackError, 'degraded', { folder, featureName });
          diagnostics.push(diag);
          this.logger.warn(`Rollback failed for '${folder}' during sync recovery: ${diag.message}`, {
            featureName,
            folder,
            code: diag.code,
          });
        }
      }

      const reason = error instanceof Error ? error.message : String(error);
      const failureSuffix = rollbackFailureCount > 1 ? 's' : '';
      const rollbackDetail =
        rollbackFailureCount > 0
          ? `Rolled back ${rollbackSuccessCount} of ${createdFolders.length} created tasks` +
            ` (${rollbackFailureCount} rollback failure${failureSuffix}).`
          : `Rolled back ${createdFolders.length} created tasks.`;
      throw new Error(
        `Task sync failed for '${featureName}' after creating ${createdFolders.length} of ${delta.created.length} tasks. ` +
          `${rollbackDetail} Original error: ${reason}`,
      );
    } finally {
      if (supportsTransitionBatch) {
        this.store.endTransitionBatch!();
      }
    }

    return this.buildSyncResult(delta, diagnostics);
  }

  /**
   * Compute the sync delta between plan tasks and existing tasks.
   * Shared by previewSync() and sync() to ensure identical classification.
   */
  private _computeSyncDelta(featureName: string): SyncDelta {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
    const planContent = readText(planPath);

    if (!planContent) {
      throw new Error(`No plan.md found for feature '${featureName}'`);
    }

    const planTasks = this.parseTasksFromPlan(planContent);

    this.validateUniqueTaskNumbers(planTasks);
    this.validateDependencyGraph(planTasks);
    this.detectSlugCollisions(planTasks);

    const existingTasks = this.store.list(featureName);
    const supportsReconciliation = typeof this.store.reconcilePlanTask === 'function';
    const matchedExistingFolders = new Set<string>();

    const kept: string[] = [];
    const removed: string[] = [];
    const created: string[] = [];
    const reconciled: ReconciliationAction[] = [];
    const manual: string[] = [];

    for (const existing of existingTasks) {
      if (existing.origin === 'manual') {
        manual.push(existing.folder);
      }
    }

    for (const planTask of planTasks) {
      const dependsOn = this.resolveDependencies(planTask, planTasks);
      const occupiedFolder = existingTasks.find((existing) => existing.folder === planTask.folder);
      if (occupiedFolder && (occupiedFolder.origin === 'manual' || occupiedFolder.status === 'cancelled')) {
        continue;
      }

      const exactMatch = existingTasks.find(
        (existing) => this.isEligiblePlanMatch(existing, matchedExistingFolders) && existing.folder === planTask.folder,
      );
      const titleMatch = exactMatch ?? this.findTitleMatchCandidate(planTask, existingTasks, matchedExistingFolders);

      if (!titleMatch) {
        created.push(planTask.folder);
        continue;
      }

      matchedExistingFolders.add(titleMatch.folder);
      const currentStatus = this.store.getRawStatus(featureName, titleMatch.folder);

      if (supportsReconciliation && this.needsTaskReconciliation(titleMatch, currentStatus, planTask, dependsOn)) {
        reconciled.push({
          currentTask: titleMatch,
          planTask,
          dependsOn,
          currentStatus,
        });
      } else {
        kept.push(titleMatch.folder);
      }
    }

    for (const existing of existingTasks) {
      if (existing.origin === 'manual' || matchedExistingFolders.has(existing.folder)) {
        continue;
      }

      if (existing.status === 'done' || existing.status === 'in_progress') {
        kept.push(existing.folder);
        continue;
      }

      removed.push(existing.folder);
    }

    return {
      planTasks,
      planContent,
      kept,
      removed,
      created,
      reconciled,
      manual,
    };
  }

  private buildSyncResult(delta: SyncDelta, diagnostics?: Diagnostic[]): TasksSyncResult {
    const result: TasksSyncResult = {
      created: delta.created,
      removed: delta.removed,
      kept: delta.kept,
      reconciled: delta.reconciled.map((action) => this.toReconciliationSummary(action)),
      manual: delta.manual,
    };

    if (diagnostics) {
      result.diagnostics = diagnostics;
    }

    return result;
  }

  private toReconciliationSummary(action: ReconciliationAction): TaskSyncReconciliation {
    return {
      from: action.currentTask.folder,
      to: action.planTask.folder,
      planTitle: action.planTask.name,
      beadId: action.currentTask.beadId,
    };
  }

  private applyTaskReconciliation(featureName: string, action: ReconciliationAction): void {
    if (!this.store.reconcilePlanTask) {
      throw new Error(`Task store cannot reconcile '${action.currentTask.folder}' to '${action.planTask.folder}'`);
    }

    const baseStatus: TaskStatus =
      action.currentStatus ??
      ({
        status: action.currentTask.status,
        origin: action.currentTask.origin,
        planTitle: action.currentTask.planTitle ?? action.currentTask.name,
        summary: action.currentTask.summary,
        beadId: action.currentTask.beadId,
      } as TaskStatus);

    const canonicalStatus: TaskStatus = {
      ...baseStatus,
      origin: 'plan',
      planTitle: action.planTask.name,
      dependsOn: action.dependsOn,
      beadId: baseStatus.beadId ?? action.currentTask.beadId,
      folder: action.planTask.folder,
    };

    this.store.reconcilePlanTask(featureName, action.currentTask.folder, action.planTask.folder, canonicalStatus);
  }

  private isEligiblePlanMatch(existing: TaskInfo, matchedExistingFolders: Set<string>): boolean {
    return (
      existing.origin !== 'manual' && existing.status !== 'cancelled' && !matchedExistingFolders.has(existing.folder)
    );
  }

  private findTitleMatchCandidate(
    planTask: ParsedTask,
    existingTasks: TaskInfo[],
    matchedExistingFolders: Set<string>,
  ): TaskInfo | null {
    const matches = existingTasks.filter(
      (existing) => this.isEligiblePlanMatch(existing, matchedExistingFolders) && existing.planTitle === planTask.name,
    );

    return matches.length === 1 ? matches[0] : null;
  }

  private needsTaskReconciliation(
    existing: TaskInfo,
    currentStatus: TaskStatus | null,
    planTask: ParsedTask,
    dependsOn: string[],
  ): boolean {
    if (existing.folder !== planTask.folder) {
      return true;
    }

    if (existing.folderSource === 'derived') {
      return true;
    }

    if (!currentStatus) {
      return true;
    }

    if (currentStatus.folder !== planTask.folder) {
      return true;
    }

    if (currentStatus.planTitle !== planTask.name) {
      return true;
    }

    if (currentStatus.origin !== 'plan') {
      return true;
    }

    return !this.haveSameDependencies(currentStatus.dependsOn, dependsOn);
  }

  private haveSameDependencies(current: string[] | undefined, desired: string[]): boolean {
    if (!current) {
      return false;
    }

    if (current.length !== desired.length) {
      return false;
    }

    return current.every((folder, index) => folder === desired[index]);
  }

  /**
   * Create a manual task with auto-incrementing index.
   * Folder format: "01-task-name", "02-task-name", etc.
   * Index ensures alphabetical sort = chronological order.
   */
  create(featureName: string, name: string, order?: number, priority: number = 3): string {
    name = sanitizeName(name);

    // Validate priority
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error(`Priority must be an integer between 1 and 5 (inclusive), got: ${priority}`);
    }

    const nextOrder = order ?? this.store.getNextOrder(featureName);
    const folder = deriveTaskFolder(nextOrder, name);
    const slug = slugifyTaskName(name);

    // Check for slug collision with existing tasks
    const existingTasks = this.store.list(featureName);
    for (const existing of existingTasks) {
      // Extract slug portion from existing folder (strip "NN-" prefix)
      const existingSlug = existing.folder.replace(/^\d+-/, '');
      if (existingSlug === slug && existing.planTitle !== name) {
        throw new Error(
          `Task name '${name}' collides with existing task after slugification (folder: ${slug}). Please rename the task.`,
        );
      }
    }

    const status: TaskStatus = {
      status: 'pending',
      origin: 'manual',
      planTitle: name,
    };

    this.store.createTask(featureName, folder, name, status, priority);

    return folder;
  }

  readTaskBeadArtifact(
    featureName: string,
    taskFolder: string,
    kind: 'spec' | 'worker_prompt' | 'report',
  ): string | null {
    return this.store.readArtifact(featureName, taskFolder, kind);
  }

  /**
   * Update task status with locked atomic write.
   * Uses file locking to prevent race conditions between concurrent updates.
   *
   * @param featureName - Feature name
   * @param taskFolder - Task folder name
   * @param updates - Fields to update (status, summary, baseCommit, blocker)
   * @param lockOptions - Optional lock configuration
   * @returns Updated TaskStatus
   */
  update(
    featureName: string,
    taskFolder: string,
    updates: Partial<Pick<TaskStatus, 'status' | 'summary' | 'baseCommit' | 'blocker' | 'learnings'>>,
    _lockOptions?: LockOptions,
  ): TaskStatus {
    const current = this.store.getRawStatus(featureName, taskFolder);

    if (!current) {
      throw new Error(`Task '${taskFolder}' not found`);
    }

    const updated: TaskStatus = {
      ...current,
      ...updates,
      schemaVersion: TASK_STATUS_SCHEMA_VERSION,
    };

    if (updates.status === 'in_progress' && !current.startedAt) {
      updated.startedAt = new Date().toISOString();
    }
    if (updates.status === 'done' && !current.completedAt) {
      updated.completedAt = new Date().toISOString();
    }

    this.store.save(featureName, taskFolder, updated, { syncBeadStatus: updates.status !== undefined });

    return updated;
  }

  /**
   * Transition task status with state machine enforcement.
   * Validates the transition against the allowed-transition map when strict mode is enabled.
   * Stamps timestamps consistently (startedAt on in_progress, completedAt on done).
   *
   * @param featureName - Feature name
   * @param taskFolder - Task folder name
   * @param toStatus - Target status to transition to
   * @param extras - Optional additional fields (summary, blocker, baseCommit)
   * @returns Updated TaskStatus
   * @throws InvalidTransitionError when strict mode is enabled and transition is not allowed
   */
  transition(
    featureName: string,
    taskFolder: string,
    toStatus: TaskStatusType,
    extras?: Partial<Pick<TaskStatus, 'summary' | 'blocker' | 'baseCommit' | 'learnings'>>,
  ): TaskStatus {
    const current = this.store.getRawStatus(featureName, taskFolder);

    if (!current) {
      throw new Error(`Task '${taskFolder}' not found`);
    }

    // Validate transition when strict mode is enabled
    if (this.options.strictTaskTransitions) {
      validateTransition(current.status, toStatus);
    }

    // Delegate to update() for the actual state change + timestamp stamping
    return this.update(featureName, taskFolder, {
      status: toStatus,
      ...extras,
    });
  }

  /**
   * Patch only background-owned fields without clobbering completion-owned fields.
   * Safe for concurrent use by background workers.
   *
   * Uses deep merge for workerSession to allow partial updates like:
   * - patchBackgroundFields(..., { workerSession: { lastHeartbeatAt: '...' } })
   *   will update only lastHeartbeatAt, preserving other workerSession fields.
   *
   * @param featureName - Feature name
   * @param taskFolder - Task folder name
   * @param patch - Background-owned fields to update
   * @param lockOptions - Optional lock configuration
   * @returns Updated TaskStatus
   */
  patchBackgroundFields(
    featureName: string,
    taskFolder: string,
    patch: BackgroundPatchFields,
    lockOptions?: LockOptions,
  ): TaskStatus {
    return this.store.patchBackground(featureName, taskFolder, patch, lockOptions);
  }

  /**
   * Get raw TaskStatus including all fields (for internal use or debugging).
   */
  getRawStatus(featureName: string, taskFolder: string): TaskStatus | null {
    return this.store.getRawStatus(featureName, taskFolder);
  }

  get(featureName: string, taskFolder: string): TaskInfo | null {
    return this.store.get(featureName, taskFolder);
  }

  list(featureName: string): TaskInfo[] {
    return this.store.list(featureName);
  }

  writeSpec(featureName: string, taskFolder: string, content: string): string {
    return this.store.writeArtifact(featureName, taskFolder, 'spec', content);
  }

  writeWorkerPrompt(featureName: string, taskFolder: string, content: string): string {
    return this.store.writeArtifact(featureName, taskFolder, 'worker_prompt', content);
  }

  writeReport(featureName: string, taskFolder: string, report: string): string {
    return this.store.writeReport(featureName, taskFolder, report);
  }

  /**
   * Get tasks that are runnable (dependencies satisfied).
   * Tries store-specific strategy first, falls back to filesystem-based resolution.
   */
  getRunnableTasks(featureName: string): RunnableTasksResult {
    const beadsResult = this.store.getRunnableTasks(featureName);
    if (beadsResult !== null) {
      return beadsResult;
    }

    return this.getRunnableTasksFromFilesystem(featureName);
  }

  /**
   * Build structured SpecData for a task.
   * This separates data collection from markdown formatting.
   */
  buildSpecData(params: {
    featureName: string;
    task: { folder: string; name: string; order: number; description?: string };
    dependsOn: string[];
    allTasks: Array<{ folder: string; name: string; order: number }>;
    planContent?: string | null;
    contextFiles?: Array<{ name: string; content: string }>;
    completedTasks?: Array<{ name: string; summary: string }>;
  }): SpecData {
    const { featureName, task, dependsOn, allTasks, planContent, contextFiles = [], completedTasks = [] } = params;

    const planSection = this.extractPlanSection(planContent ?? null, task);

    return {
      featureName,
      task: {
        folder: task.folder,
        name: task.name,
        order: task.order,
      },
      dependsOn,
      allTasks,
      planSection,
      contextFiles,
      completedTasks,
    };
  }

  private extractPlanSection(
    planContent: string | null,
    task: { name: string; order: number; folder: string },
  ): string | null {
    if (!planContent) return null;

    const escapedTitle = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRegex = new RegExp(`###\\s*\\d+\\.\\s*${escapedTitle}[\\s\\S]*?(?=###|$)`, 'i');
    let taskMatch = planContent.match(titleRegex);

    if (!taskMatch && task.order > 0) {
      const orderRegex = new RegExp(`###\\s*${task.order}\\.\\s*[^\\n]+[\\s\\S]*?(?=###|$)`, 'i');
      taskMatch = planContent.match(orderRegex);
    }

    return taskMatch ? taskMatch[0].trim() : null;
  }

  /**
   * Resolve dependency numbers to folder names.
   * - If dependsOnNumbers is null (not specified), apply implicit sequential default (N-1 for N > 1).
   * - If dependsOnNumbers is [] (explicit "none"), return empty array.
   * - Otherwise, map numbers to corresponding task folders.
   */
  private resolveDependencies(task: ParsedTask, allTasks: ParsedTask[]): string[] {
    // Explicit "none" - no dependencies
    if (task.dependsOnNumbers !== null && task.dependsOnNumbers.length === 0) {
      return [];
    }

    // Explicit dependency numbers provided
    if (task.dependsOnNumbers !== null) {
      return task.dependsOnNumbers
        .map((num) => allTasks.find((t) => t.order === num)?.folder)
        .filter((folder): folder is string => folder !== undefined);
    }

    // Implicit sequential default: depend on previous task (N-1)
    if (task.order === 1) {
      return [];
    }

    const previousTask = allTasks.find((t) => t.order === task.order - 1);
    return previousTask ? [previousTask.folder] : [];
  }

  /**
   * Validate that no two parsed plan tasks share the same numeric order.
   * Duplicate numbered headers make implicit dependency ordering ambiguous
   * and must be rejected before task creation.
   */
  private validateUniqueTaskNumbers(tasks: ParsedTask[]): void {
    const seen = new Map<number, string>();
    const duplicates: Array<{ order: number; firstName: string; secondName: string }> = [];

    for (const task of tasks) {
      const existing = seen.get(task.order);
      if (existing !== undefined) {
        duplicates.push({ order: task.order, firstName: existing, secondName: task.name });
      } else {
        seen.set(task.order, task.name);
      }
    }

    if (duplicates.length > 0) {
      const details = duplicates
        .map((d) => `  - Task number ${d.order}: "${d.firstName}" and "${d.secondName}"`)
        .join('\n');
      throw new Error(
        `Duplicate numbered task headers in plan.md:\n${details}\n` +
          `Each task must have a unique number. Please renumber the tasks in plan.md.`,
      );
    }
  }

  /**
   * Detect slug collisions among parsed plan tasks.
   * Two tasks with different names that produce the same slug after slugification
   * would map to the same folder, causing confusion. Fail fast with a clear error.
   */
  private detectSlugCollisions(tasks: ParsedTask[]): void {
    const slugToName = new Map<string, string>();

    for (const task of tasks) {
      const slug = slugifyTaskName(task.name);
      const existingName = slugToName.get(slug);

      if (existingName !== undefined && existingName !== task.name) {
        throw new Error(
          `Task name '${task.name}' collides with existing task after slugification (folder: ${slug}). Please rename the task.`,
        );
      }

      slugToName.set(slug, task.name);
    }
  }

  /**
   * Validate the dependency graph for errors before creating tasks.
   * Throws descriptive errors pointing the operator to fix plan.md.
   *
   * Checks for:
   * - Unknown task numbers in dependencies
   * - Self-dependencies
   * - Cycles (using DFS topological sort)
   */
  private validateDependencyGraph(tasks: ParsedTask[]): void {
    const taskNumbers = new Set(tasks.map((t) => t.order));

    // Validate each task's dependencies
    for (const task of tasks) {
      if (task.dependsOnNumbers === null) {
        // Implicit dependencies - no validation needed
        continue;
      }

      for (const depNum of task.dependsOnNumbers) {
        // Check for self-dependency
        if (depNum === task.order) {
          throw new Error(
            `Invalid dependency graph in plan.md: Self-dependency detected for task ${task.order} ("${task.name}"). ` +
              `A task cannot depend on itself. Please fix the "Depends on:" line in plan.md.`,
          );
        }

        // Check for unknown task number
        if (!taskNumbers.has(depNum)) {
          throw new Error(
            `Invalid dependency graph in plan.md: Unknown task number ${depNum} referenced in dependencies for task ${task.order} ("${task.name}"). ` +
              `Available task numbers are: ${Array.from(taskNumbers)
                .sort((a, b) => a - b)
                .join(', ')}. ` +
              `Please fix the "Depends on:" line in plan.md.`,
          );
        }
      }
    }

    // Check for cycles using DFS
    this.detectCycles(tasks);
  }

  /**
   * Detect cycles in the dependency graph using DFS.
   * Throws a descriptive error if a cycle is found.
   */
  private detectCycles(tasks: ParsedTask[]): void {
    // Build adjacency list: task order -> [dependency orders]
    const taskByOrder = new Map(tasks.map((t) => [t.order, t]));

    // Build dependency graph with resolved implicit dependencies
    const getDependencies = (task: ParsedTask): number[] => {
      if (task.dependsOnNumbers !== null) {
        return task.dependsOnNumbers;
      }
      // Implicit sequential dependency
      if (task.order === 1) {
        return [];
      }
      return [task.order - 1];
    };

    // Track visited state: 0 = unvisited, 1 = in current path, 2 = fully processed
    const visited = new Map<number, number>();
    const path: number[] = [];

    const dfs = (taskOrder: number): void => {
      const state = visited.get(taskOrder);

      if (state === 2) {
        // Already fully processed, no cycle through here
        return;
      }

      if (state === 1) {
        // Found a cycle! Build the cycle path for the error message
        const cycleStart = path.indexOf(taskOrder);
        const cyclePath = [...path.slice(cycleStart), taskOrder];
        const cycleDesc = cyclePath.join(' -> ');

        throw new Error(
          `Invalid dependency graph in plan.md: Cycle detected in task dependencies: ${cycleDesc}. ` +
            `Tasks cannot have circular dependencies. Please fix the "Depends on:" lines in plan.md.`,
        );
      }

      // Mark as in current path
      visited.set(taskOrder, 1);
      path.push(taskOrder);

      const task = taskByOrder.get(taskOrder);
      if (task) {
        const deps = getDependencies(task);
        for (const depOrder of deps) {
          dfs(depOrder);
        }
      }

      // Mark as fully processed
      path.pop();
      visited.set(taskOrder, 2);
    };

    // Run DFS from each node
    for (const task of tasks) {
      if (!visited.has(task.order)) {
        dfs(task.order);
      }
    }
  }

  /**
   * Compute runnable and blocked tasks for a feature using the canonical dependency engine.
   * Centralizes the repeated pattern of building TaskWithDeps, computing effective dependencies,
   * and determining runnable/blocked status.
   */
  computeRunnableStatus(featureName: string): RunnableBlockedResult {
    const allTasks = this.store.list(featureName);

    const tasksWithDeps: TaskWithDeps[] = allTasks.map((task) => {
      const rawStatus = this.store.getRawStatus(featureName, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: rawStatus?.dependsOn,
      };
    });

    const effectiveDeps = buildEffectiveDependencies(tasksWithDeps);
    const normalizedTasks = tasksWithDeps.map((task) => ({
      ...task,
      dependsOn: effectiveDeps.get(task.folder),
    }));

    return computeRunnableAndBlocked(normalizedTasks);
  }

  /**
   * Get runnable tasks from filesystem using dependency resolution.
   */
  private getRunnableTasksFromFilesystem(featureName: string): RunnableTasksResult {
    const allTasks = this.store.list(featureName);

    // Build dependency-aware task list for canonical engine
    const tasksWithDeps: TaskWithDeps[] = allTasks.map((task) => {
      const rawStatus = this.store.getRawStatus(featureName, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: rawStatus?.dependsOn,
      };
    });

    const { runnable: runnableFolders } = computeRunnableAndBlocked(tasksWithDeps);
    const runnableSet = new Set(runnableFolders);

    const runnable: RunnableTask[] = [];
    const blocked: RunnableTask[] = [];
    const completed: RunnableTask[] = [];
    const inProgress: RunnableTask[] = [];

    for (const task of allTasks) {
      const runnableTask: RunnableTask = {
        folder: task.folder,
        name: task.name,
        status: task.status,
        beadId: task.beadId,
      };

      switch (task.status) {
        case 'done':
          completed.push(runnableTask);
          break;
        case 'dispatch_prepared':
        case 'in_progress':
          inProgress.push(runnableTask);
          break;
        case 'pending':
          if (runnableSet.has(task.folder)) {
            runnable.push(runnableTask);
          } else {
            blocked.push(runnableTask);
          }
          break;
        case 'blocked':
        case 'failed':
        case 'cancelled':
        case 'partial':
          blocked.push(runnableTask);
          break;
      }
    }

    return {
      runnable,
      blocked,
      completed,
      inProgress,
      source: 'filesystem',
    };
  }

  private parseTasksFromPlan(content: string): ParsedTask[] {
    const tasks: ParsedTask[] = [];
    const lines = content.split('\n');

    let currentTask: ParsedTask | null = null;
    let descriptionLines: string[] = [];

    // Regex to match "Depends on:" or "**Depends on**:" with optional markdown
    // Strips markdown formatting (**, *, etc.) and captures the value
    const dependsOnRegex = /^\s*\*{0,2}Depends\s+on\*{0,2}\s*:\s*(.+)$/i;

    for (const line of lines) {
      // Check for task header: ### N. Task Name
      const taskMatch = line.match(/^###\s+(\d+)\.\s+(.+)$/);

      if (taskMatch) {
        // Save previous task if exists
        if (currentTask) {
          currentTask.description = descriptionLines.join('\n').trim();
          tasks.push(currentTask);
        }

        const order = parseInt(taskMatch[1], 10);
        const rawName = taskMatch[2].trim();
        const folderName = slugifyTaskName(rawName);
        const folder = deriveTaskFolder(order, folderName);

        currentTask = {
          folder,
          order,
          name: rawName,
          description: '',
          dependsOnNumbers: null, // null = not specified, use implicit
        };
        descriptionLines = [];
      } else if (currentTask) {
        // Check for end of task section (next ## header or ### without number)
        if (line.match(/^##\s+/) || line.match(/^###\s+[^0-9]/)) {
          currentTask.description = descriptionLines.join('\n').trim();
          tasks.push(currentTask);
          currentTask = null;
          descriptionLines = [];
        } else {
          // Check for Depends on: annotation within task section
          const dependsMatch = line.match(dependsOnRegex);
          if (dependsMatch) {
            const value = dependsMatch[1].trim().toLowerCase();
            if (value === 'none') {
              currentTask.dependsOnNumbers = [];
            } else {
              // Parse comma-separated numbers
              const numbers = value
                .split(/[,\s]+/)
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => !Number.isNaN(n));
              currentTask.dependsOnNumbers = numbers;
            }
          }
          descriptionLines.push(line);
        }
      }
    }

    // Don't forget the last task
    if (currentTask) {
      currentTask.description = descriptionLines.join('\n').trim();
      tasks.push(currentTask);
    }

    return tasks;
  }
}
