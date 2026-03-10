import * as fs from 'fs';
import * as path from 'path';
import type { TaskInfo, TaskOrigin, TaskStatus, WorkerSession } from '../../types.js';
import { ensureDir, readJson, writeJson } from '../../utils/fs.js';
import type { LockOptions } from '../../utils/json-lock.js';
import { getTaskReportPath } from '../../utils/paths.js';
import { deriveTaskFolder, slugifyTaskName } from '../../utils/slug.js';
import { type BeadsRepository, throwIfInitFailure } from '../beads/BeadsRepository.js';
import { mapBeadStatusToTaskStatus } from '../beads/beadStatus.js';
import type { TaskWithDeps } from '../taskDependencyGraph.js';
import { computeRunnableAndBlocked } from '../taskDependencyGraph.js';
import type { Diagnostic } from '../outcomes.js';
import type { BackgroundPatchFields, RunnableTask, RunnableTasksResult } from '../taskService.js';
import { TASK_STATUS_SCHEMA_VERSION } from '../taskService.js';
import { TransitionJournal } from './transition-journal.js';
import type { TaskArtifactKind, TaskSaveOptions, TaskStore } from './types.js';

// ============================================================================
// Audit Trail Types
// ============================================================================

/**
 * Represents a task state transition event for audit logging.
 */
export interface TransitionEvent {
  /** Task bead ID */
  beadId: string;
  /** Previous status */
  from: string;
  /** New status */
  to: string;
  /** ISO timestamp of transition */
  timestamp: string;
  /** Optional summary/reason for transition */
  summary?: string;
  /** Journal sequence number for tracking comment write acknowledgment */
  journalSeq?: number;
}

interface LocalBackgroundState {
  idempotencyKey?: string;
  workerSession?: WorkerSession;
}


/**
 * TaskStore implementation for beadsMode='on'.
 *
 * All task state is canonical in bead artifacts.
 * Task filesystem paths are referenced only for compatibility return values.
 */
export class BeadsTaskStore implements TaskStore {
  /**
   * In-memory cache: featureId → folder → TaskInfo
   * Populated by list(), used by get() for O(1) lookups.
   * Invalidated on mutations (createTask, save, delete, patchBackground, syncDependencies).
   */
  private taskIndex = new Map<string, Map<string, TaskInfo>>();

  /**
   * In-memory cache: featureId → folder → beadId
   * Populated by list(), used by getRawStatus() to find beadId without O(n) search.
   * Invalidated on mutations (createTask, save, delete, patchBackground, syncDependencies).
   */
  private beadIdIndex = new Map<string, Map<string, string>>();

  private pendingTransitions: TransitionEvent[] = [];
  private transitionBatchMode = false;
  private readonly journal: TransitionJournal;

  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {
    this.journal = new TransitionJournal(projectRoot);
  }

  beginTransitionBatch(): void {
    this.transitionBatchMode = true;
  }

  endTransitionBatch(): void {
    this.transitionBatchMode = false;
    this.flushTransitionAudit();
  }

  /**
   * Explicitly refresh the index for a feature.
   * Called when external state may have changed or for manual invalidation.
   */
  refreshIndex(featureName: string): void {
    this.taskIndex.delete(featureName);
    this.beadIdIndex.delete(featureName);
  }

  createTask(featureName: string, folder: string, title: string, status: TaskStatus, priority: number): TaskStatus {
    const epicResult = this.repository.getEpicByFeatureName(featureName, true);
    if (epicResult.success === false) {
      throw new Error(`Failed to resolve epic for feature '${featureName}': ${epicResult.error.message}`);
    }
    const epicBeadId = epicResult.value!;

    const createResult = this.repository.createTask(title, epicBeadId, priority);
    if (createResult.success === false) {
      throw new Error(`Failed to create task bead: ${createResult.error.message}`);
    }
    const beadId = createResult.value;
    const statusWithBead: TaskStatus = { ...status, beadId };

    const setTaskStateResult = this.repository.setTaskState(beadId, { ...statusWithBead, folder } as TaskStatus);
    if (setTaskStateResult.success === false) {
      throwIfInitFailure(setTaskStateResult.error, `Failed to persist task state for '${beadId}'`);
      throw new Error(`Failed to persist task state for '${beadId}': ${setTaskStateResult.error.message}`);
    }

    let featureBeadIdIndex = this.beadIdIndex.get(featureName);
    if (!featureBeadIdIndex) {
      featureBeadIdIndex = new Map<string, string>();
      this.beadIdIndex.set(featureName, featureBeadIdIndex);
    }
    featureBeadIdIndex.set(folder, beadId);

    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      featureTaskIndex.set(folder, {
        folder,
        name: folder.replace(/^\d+-/, ''),
        beadId,
        status: statusWithBead.status,
        origin: statusWithBead.origin,
        planTitle: statusWithBead.planTitle,
        summary: statusWithBead.summary,
        folderSource: 'stored' as const,
      });
    }

    return statusWithBead;
  }

  reconcilePlanTask(featureName: string, currentFolder: string, nextFolder: string, status: TaskStatus): void {
    const beadId = status.beadId ?? this.resolveBeadId(featureName, currentFolder);
    if (!beadId) {
      throw new Error(`Cannot reconcile task '${currentFolder}' without beadId in beads mode`);
    }

    const reconciledStatus: TaskStatus = {
      ...status,
      beadId,
      origin: 'plan',
      folder: nextFolder,
    };

    const setResult = this.repository.setTaskState(beadId, reconciledStatus as TaskStatus);
    if (setResult.success === false) {
      throwIfInitFailure(setResult.error, `Failed to reconcile task state for '${beadId}'`);
      throw new Error(`Failed to reconcile task state for '${beadId}': ${setResult.error.message}`);
    }
    this.moveLocalBackgroundState(featureName, currentFolder, nextFolder);
    this.refreshIndex(featureName);
  }


  get(featureName: string, folder: string): TaskInfo | null {
    // Check cache first for O(1) lookup
    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      const cachedTask = featureTaskIndex.get(folder);
      if (cachedTask) {
        return cachedTask;
      }
      // Cache may be stale after external mutations; refresh and retry once
      this.refreshIndex(featureName);
      return this.list(featureName).find((t) => t.folder === folder) ?? null;
    }

    // Cache miss: populate index via list()
    return this.list(featureName).find((t) => t.folder === folder) ?? null;
  }

  getRawStatus(featureName: string, folder: string): TaskStatus | null {
    // Check beadId cache for O(1) lookup
    const featureBeadIdIndex = this.beadIdIndex.get(featureName);
    let beadId: string | undefined;

    if (featureBeadIdIndex) {
      beadId = featureBeadIdIndex.get(folder);
      if (!beadId) {
        const task = this.findTaskByFolder(featureName, folder);
        beadId = task?.beadId;
      }
    } else {
      // Cache miss: find task via list() to populate cache
      const task = this.findTaskByFolder(featureName, folder);
      beadId = task?.beadId;
    }

    if (beadId) {
      const taskState = this.readTaskState(beadId);
      if (taskState) {
        return this.applyLocalBackgroundState(featureName, folder, {
          ...taskState,
          beadId,
          folder: (taskState as TaskStatus & { folder?: string }).folder ?? folder,
        });
      }

      // Minimal fallback from bead info
      const beadsTask = this.findTaskByFolder(featureName, folder);
      if (beadsTask) {
        return this.applyLocalBackgroundState(featureName, folder, {
          status: beadsTask.status,
          origin: beadsTask.origin,
          planTitle: beadsTask.planTitle ?? beadsTask.name,
          beadId: beadsTask.beadId,
        });
      }
    }

    return null;
  }

  list(featureName: string): TaskInfo[] {
    try {
      // Return cached data if available (avoids O(n) listTaskBeadsForEpic call)
      const featureTaskIndex = this.taskIndex.get(featureName);
      if (featureTaskIndex) {
        return Array.from(featureTaskIndex.values());
      }

      const epicResult = this.repository.getEpicByFeatureName(featureName, true);
      if (epicResult.success === false) {
        throw epicResult.error;
      }
      const epicBeadId = epicResult.value!;
      const listResult = this.repository.listTaskBeadsForEpic(epicBeadId);
      if (listResult.success === false) {
        throwIfInitFailure(listResult.error, `Failed to list task beads for epic '${epicBeadId}'`);
      }
      const taskBeads = listResult.success ? listResult.value : [];
      const sortedTaskBeads = [...taskBeads].sort((a, b) => a.title.localeCompare(b.title));

      const tasks = sortedTaskBeads.map((bead, index) => {
        const beadStatus = mapBeadStatusToTaskStatus(bead.status);
        const taskState = this.readTaskState(bead.id);
        if (taskState) {
          const storedFolder = (taskState as TaskStatus & { folder?: string }).folder;
          return {
            folder: storedFolder ?? deriveTaskFolder(index + 1, slugifyTaskName(bead.title)),
            name: (storedFolder ?? '').replace(/^\d+-/, '') || slugifyTaskName(bead.title),
            beadId: bead.id,
            status: taskState.status,
            origin: taskState.origin,
            planTitle: taskState.planTitle ?? bead.title,
            summary: taskState.summary,
            folderSource: storedFolder ? ('stored' as const) : ('derived' as const),
          };
        }

        const order = index + 1;
        const folderName = slugifyTaskName(bead.title);
        const folder = deriveTaskFolder(order, folderName);

        return {
          folder,
          name: folderName,
          beadId: bead.id,
          status: beadStatus,
          origin: 'plan' as TaskOrigin,
          planTitle: bead.title,
          folderSource: 'derived' as const,
        };
      });

      const sortedTasks = tasks.sort((a, b) => {
        const aOrder = parseInt(a.folder.split('-')[0], 10);
        const bOrder = parseInt(b.folder.split('-')[0], 10);
        return aOrder - bOrder;
      });

      // Populate indexes after sorting
      const newFeatureTaskIndex = new Map<string, TaskInfo>();
      const newFeatureBeadIdIndex = new Map<string, string>();

      for (const task of sortedTasks) {
        newFeatureTaskIndex.set(task.folder, task);
        if (task.beadId) {
          newFeatureBeadIdIndex.set(task.folder, task.beadId);
        }
      }

      this.taskIndex.set(featureName, newFeatureTaskIndex);
      this.beadIdIndex.set(featureName, newFeatureBeadIdIndex);

      return sortedTasks;
    } catch (error) {
      throwIfInitFailure(error, `Failed to list tasks for feature '${featureName}'`);
      return [];
    }
  }

  getNextOrder(featureName: string): number {
    const tasks = this.list(featureName);
    if (tasks.length === 0) return 1;

    const orders = tasks.map((t) => parseInt(t.folder.split('-')[0], 10)).filter((n) => !Number.isNaN(n));

    return Math.max(...orders, 0) + 1;
  }

  save(featureName: string, folder: string, status: TaskStatus, options?: TaskSaveOptions): void {
    if (!status.beadId) {
      throw new Error(`Cannot save task '${folder}' without beadId in beads mode`);
    }

    // Get previous status for audit trail
    const prevStatus = this.readTaskState(status.beadId)?.status ?? 'pending';

    const setResult = this.repository.setTaskState(status.beadId, { ...status, folder } as TaskStatus);
    if (setResult.success === false) {
      throwIfInitFailure(setResult.error, `Failed to persist task state for '${status.beadId}'`);
      console.warn(`[warcraft] Failed to persist task state for '${status.beadId}': ${setResult.error.message}`);
    }

    // Invalidate cache entry for the modified task
    this.invalidateCacheEntry(featureName, folder);

    if (options?.syncBeadStatus && status.status) {
      const syncResult = this.repository.syncTaskStatus(status.beadId, status.status);
      if (syncResult.success === false) {
        throwIfInitFailure(syncResult.error, `[warcraft] Failed to sync bead status for '${status.beadId}'`);
        console.warn(`[warcraft] Failed to sync bead status for '${status.beadId}': ${syncResult.error.message}`);
      }

      // Append transition comment for audit trail
      this.appendTransitionComment(status.beadId, prevStatus, status.status, status.summary);
    }
  }

  patchBackground(
    featureName: string,
    folder: string,
    patch: BackgroundPatchFields,
    _lockOptions?: LockOptions,
  ): TaskStatus {
    const status = this.getRawStatus(featureName, folder);
    if (!status) {
      throw new Error(`Task '${folder}' not found`);
    }

    const updated: TaskStatus = {
      ...status,
      schemaVersion: TASK_STATUS_SCHEMA_VERSION,
    };

    if (patch.idempotencyKey !== undefined) {
      updated.idempotencyKey = patch.idempotencyKey;
    }

    if (patch.workerSession !== undefined) {
      updated.workerSession = {
        ...(status.workerSession ?? ({} as WorkerSession)),
        ...patch.workerSession,
      } as WorkerSession;
    }

    this.writeLocalBackgroundState(featureName, folder, {
      ...(patch.idempotencyKey !== undefined ? { idempotencyKey: updated.idempotencyKey } : {}),
      ...(patch.workerSession !== undefined ? { workerSession: updated.workerSession } : {}),
    });

    return updated;
  }

  delete(featureName: string, folder: string): void {
    // Canonical: close the bead to prevent resurrection as phantom pending task
    const beadId = this.resolveBeadId(featureName, folder);
    if (beadId) {
      try {
        this.repository.closeBead(beadId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          `[warcraft] Failed to close bead '${beadId}' during delete of '${folder}' (best-effort): ${reason}`,
        );
      }
    }
    this.deleteLocalBackgroundState(featureName, folder);

    // Invalidate cache entry for the deleted task
    this.invalidateCacheEntry(featureName, folder);
  }

  writeArtifact(featureName: string, folder: string, kind: TaskArtifactKind, content: string): string {
    const status = this.getRawStatus(featureName, folder);
    if (!status?.beadId) {
      throw new Error(`Task '${folder}' does not have beadId`);
    }

    const upsertResult = this.repository.upsertTaskArtifact(status.beadId, kind, content);
    if (upsertResult.success === false) {
      throwIfInitFailure(upsertResult.error, `[warcraft] Failed to write '${kind}' artifact for '${status.beadId}'`);
      console.warn(
        `[warcraft] Failed to write '${kind}' artifact for '${status.beadId}': ${upsertResult.error.message}`,
      );
      return folder;
    }

    return status.beadId;
  }

  readArtifact(featureName: string, folder: string, kind: TaskArtifactKind): string | null {
    const status = this.getRawStatus(featureName, folder);
    if (!status?.beadId) {
      return null;
    }

    const readResult = this.repository.readTaskArtifact(status.beadId, kind);
    if (readResult.success === false) {
      throwIfInitFailure(readResult.error, `[warcraft] Failed to read '${kind}' artifact for '${status.beadId}'`);
      return null;
    }
    return readResult.value;
  }

  writeReport(featureName: string, folder: string, report: string): string {
    this.writeArtifact(featureName, folder, 'report', report);
    return getTaskReportPath(this.projectRoot, featureName, folder, 'off');
  }

  getRunnableTasks(featureName: string): RunnableTasksResult | null {
    try {
      const planResult = this.repository.getRobotPlan();
      if (!planResult) {
        return null;
      }

      const allTasks = this.list(featureName);

      const taskByBeadId = new Map<string, TaskInfo>(
        allTasks.filter((t): t is TaskInfo & { beadId: string } => t.beadId !== undefined).map((t) => [t.beadId!, t]),
      );

      const runnable: RunnableTask[] = [];
      const blocked: RunnableTask[] = [];
      const completed: RunnableTask[] = [];
      const inProgress: RunnableTask[] = [];

      // Process tasks from robot plan tracks
      for (const track of planResult.tracks) {
        for (const beadId of track.tasks) {
          const task = taskByBeadId.get(beadId);
          if (!task) continue;

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
            case 'in_progress':
              inProgress.push(runnableTask);
              break;
            case 'pending':
              runnable.push(runnableTask);
              break;
            case 'blocked':
            case 'failed':
            case 'cancelled':
            case 'partial':
              blocked.push(runnableTask);
              break;
          }
        }
      }

      // Include tasks not in the robot plan (fallback via dependency graph)
      const plannedBeadIds = new Set(planResult.tracks.flatMap((t) => t.tasks));
      const nonPlannedTasks = allTasks.filter((t) => t.beadId && !plannedBeadIds.has(t.beadId));

      if (nonPlannedTasks.length > 0) {
        const allTasksWithDeps: TaskWithDeps[] = allTasks.map((task) => {
          const rawStatus = this.getRawStatus(featureName, task.folder);
          return {
            folder: task.folder,
            status: task.status,
            dependsOn: rawStatus?.dependsOn,
          };
        });
        const { runnable: runnableFolders } = computeRunnableAndBlocked(allTasksWithDeps);
        const runnableSet = new Set(runnableFolders);

        for (const task of nonPlannedTasks) {
          const runnableTask: RunnableTask = {
            folder: task.folder,
            name: task.name,
            status: task.status,
            beadId: task.beadId,
          };

          switch (task.status) {
            case 'done':
              if (!completed.find((t) => t.folder === task.folder)) {
                completed.push(runnableTask);
              }
              break;
            case 'in_progress':
              if (!inProgress.find((t) => t.folder === task.folder)) {
                inProgress.push(runnableTask);
              }
              break;
            case 'pending':
              if (runnableSet.has(task.folder)) {
                if (!runnable.find((t) => t.folder === task.folder)) {
                  runnable.push(runnableTask);
                }
              } else {
                if (!blocked.find((t) => t.folder === task.folder)) {
                  blocked.push(runnableTask);
                }
              }
              break;
            default:
              if (!blocked.find((t) => t.folder === task.folder)) {
                blocked.push(runnableTask);
              }
          }
        }
      }

      return {
        runnable,
        blocked,
        completed,
        inProgress,
        source: 'beads',
      };
    } catch (error) {
      throwIfInitFailure(error, `[warcraft] Failed to get runnable tasks for feature '${featureName}'`);
      const reason = error instanceof Error ? error.message : String(error);
      // Log at error level so issues are visible in agent output
      console.error(`[warcraft] Failed to get runnable tasks from beads: ${reason}`);
      return null;
    }
  }

  flush(): void {
    const flushResult = this.repository.flushArtifacts();
    if (flushResult.success === false) {
      throwIfInitFailure(flushResult.error, '[warcraft] Failed to flush bead artifacts');
    }
  }

  /**
   * Sync bead-level dependency edges to match task dependsOn relationships.
   * Idempotent: reads existing edges, computes desired edges, adds missing, removes stale.
   */
  syncDependencies(featureName: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const tasks = this.list(featureName);
    const beadIdToTask = new Map(
      tasks.filter((task): task is TaskInfo & { beadId: string } => task.beadId !== undefined).map((task) => [task.beadId, task]),
    );

    const folderToBeadId = new Map<string, string>();
    for (const task of tasks) {
      if (task.beadId) {
        folderToBeadId.set(task.folder, task.beadId);
      }
    }

    const desiredEdges = new Set<string>();
    for (const task of tasks) {
      if (!task.beadId) continue;
      const rawStatus = this.getRawStatus(featureName, task.folder);
      if (!rawStatus?.dependsOn) continue;

      for (const depFolder of rawStatus.dependsOn) {
        const depBeadId = folderToBeadId.get(depFolder);
        if (!depBeadId) {
          diagnostics.push(
            this.createDependencyDiagnostic(
              'dep_unresolved_task',
              `Dependency '${depFolder}' for task '${task.folder}' cannot be resolved to a bead ID`,
              { featureName, taskFolder: task.folder, dependsOnFolder: depFolder, beadId: task.beadId },
            ),
          );
          continue;
        }

        desiredEdges.add(`${task.beadId}->${depBeadId}`);
      }
    }

    const existingDepsByTask = new Map<string, Set<string>>();
    for (const task of tasks) {
      if (!task.beadId) continue;
      const depResult = this.repository.listDependencies(task.beadId);
      if (depResult.success === false) {
        diagnostics.push(
          this.createDependencyDiagnostic(
            'dep_list_failed',
            `Failed to list dependencies for '${task.folder}': ${depResult.error.message}`,
            { featureName, taskFolder: task.folder, beadId: task.beadId },
          ),
        );
        continue;
      }

      existingDepsByTask.set(
        task.beadId,
        new Set(depResult.value.map((dependency) => dependency.id)),
      );
    }

    for (const edge of desiredEdges) {
      const [taskBeadId, depBeadId] = edge.split('->');
      const existingDeps = existingDepsByTask.get(taskBeadId);
      if (existingDeps?.has(depBeadId)) {
        continue;
      }

      const addResult = this.repository.addDependency(taskBeadId, depBeadId);
      if (addResult.success === false) {
        diagnostics.push(
          this.createDependencyDiagnostic(
            'dep_add_failed',
            `Failed to add dependency ${taskBeadId} -> ${depBeadId}: ${addResult.error.message}`,
            {
              featureName,
              taskFolder: beadIdToTask.get(taskBeadId)?.folder,
              dependsOnFolder: beadIdToTask.get(depBeadId)?.folder,
              beadId: taskBeadId,
              dependsOnBeadId: depBeadId,
            },
          ),
        );
      }
    }

    for (const [taskBeadId, existingDeps] of existingDepsByTask.entries()) {
      for (const depBeadId of existingDeps) {
        if (desiredEdges.has(`${taskBeadId}->${depBeadId}`)) {
          continue;
        }

        const removeResult = this.repository.removeDependency(taskBeadId, depBeadId);
        if (removeResult.success === false) {
          diagnostics.push(
            this.createDependencyDiagnostic(
              'dep_remove_failed',
              `Failed to remove dependency ${taskBeadId} -> ${depBeadId}: ${removeResult.error.message}`,
              {
                featureName,
                taskFolder: beadIdToTask.get(taskBeadId)?.folder,
                dependsOnFolder: beadIdToTask.get(depBeadId)?.folder,
                beadId: taskBeadId,
                dependsOnBeadId: depBeadId,
              },
            ),
          );
        }
      }
    }

    try {
      const health = this.repository.getViewerHealth();
      if (health.available) {
        const insights = this.repository.getRobotInsights();
        if (insights?.cycles && insights.cycles.length > 0) {
          console.warn(
            `[warcraft] Advisory: bead graph has ${insights.cycles.length} cycle(s). ` +
              `Plan-space validation passed, but bead graph may have drifted. ` +
              `Run 'bv --robot-insights' for details.`,
          );
        }
      }
    } catch {
      // bv not available or failed — advisory only, don't block
    }

    return diagnostics;
  }

  private createDependencyDiagnostic(
    code: string,
    message: string,
    context: Record<string, unknown>,
  ): Diagnostic {
    return {
      code,
      message,
      severity: 'degraded',
      context,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getLocalBackgroundStatePath(featureName: string, folder: string): string {
    return path.join(this.projectRoot, '.beads', 'artifacts', featureName, 'tasks', folder, 'background.json');
  }

  private readLocalBackgroundState(featureName: string, folder: string): LocalBackgroundState | null {
    return readJson<LocalBackgroundState>(this.getLocalBackgroundStatePath(featureName, folder));
  }

  private writeLocalBackgroundState(featureName: string, folder: string, patch: LocalBackgroundState): void {
    const statePath = this.getLocalBackgroundStatePath(featureName, folder);
    const current = this.readLocalBackgroundState(featureName, folder) ?? {};
    const next: LocalBackgroundState = { ...current };

    if (patch.idempotencyKey !== undefined) {
      next.idempotencyKey = patch.idempotencyKey;
    }

    if (patch.workerSession !== undefined) {
      next.workerSession = {
        ...(current.workerSession ?? ({} as WorkerSession)),
        ...patch.workerSession,
      } as WorkerSession;
    }

    ensureDir(path.dirname(statePath));
    writeJson(statePath, next);
  }

  private applyLocalBackgroundState(featureName: string, folder: string, status: TaskStatus): TaskStatus {
    const overlay = this.readLocalBackgroundState(featureName, folder);
    if (!overlay) {
      return status;
    }

    return {
      ...status,
      ...(overlay.idempotencyKey !== undefined ? { idempotencyKey: overlay.idempotencyKey } : {}),
      ...(overlay.workerSession !== undefined
        ? {
            workerSession: {
              ...(status.workerSession ?? ({} as WorkerSession)),
              ...overlay.workerSession,
            } as WorkerSession,
          }
        : {}),
    };
  }

  private moveLocalBackgroundState(featureName: string, currentFolder: string, nextFolder: string): void {
    if (currentFolder === nextFolder) {
      return;
    }

    const currentPath = this.getLocalBackgroundStatePath(featureName, currentFolder);
    if (!fs.existsSync(currentPath)) {
      return;
    }

    const nextPath = this.getLocalBackgroundStatePath(featureName, nextFolder);
    ensureDir(path.dirname(nextPath));
    fs.renameSync(currentPath, nextPath);
  }

  private deleteLocalBackgroundState(featureName: string, folder: string): void {
    const statePath = this.getLocalBackgroundStatePath(featureName, folder);
    if (!fs.existsSync(statePath)) {
      return;
    }

    fs.rmSync(statePath, { force: true });
    const taskDir = path.dirname(statePath);
    try {
      if (fs.existsSync(taskDir) && fs.readdirSync(taskDir).length === 0) {
        fs.rmdirSync(taskDir);
      }
    } catch {
      // Best-effort cleanup for local background overlay directories.
    }
  }


  private resolveBeadId(featureName: string, folder: string): string | undefined {
    const featureBeadIdIndex = this.beadIdIndex.get(featureName);
    if (featureBeadIdIndex) {
      const cached = featureBeadIdIndex.get(folder);
      if (cached) return cached;
    }
    const task = this.findTaskByFolder(featureName, folder);
    return task?.beadId;
  }

  private findTaskByFolder(featureName: string, folder: string): TaskInfo | null {
    try {
      // Use cache first for O(1) lookup
      const featureTaskIndex = this.taskIndex.get(featureName);
      if (featureTaskIndex) {
        const cachedTask = featureTaskIndex.get(folder);
        if (cachedTask) {
          return cachedTask;
        }
        // Cache may be stale after external mutations; refresh and retry once
        this.refreshIndex(featureName);
        return this.list(featureName).find((t) => t.folder === folder) ?? null;
      }

      // Cache miss: populate index via list()
      return this.list(featureName).find((t) => t.folder === folder) ?? null;
    } catch {
      return null;
    }
  }

  private readTaskState(beadId: string): TaskStatus | null {
    const result = this.repository.getTaskState(beadId);
    if (result.success === false) {
      throwIfInitFailure(result.error, `[warcraft] Failed to read task state for bead '${beadId}'`);
      return null;
    }
    if (!result.value) {
      return null;
    }
    return result.value;
  }

  private invalidateCacheEntry(featureName: string, folder: string): void {
    // Delete the entire feature from both indexes to force list() to re-read from br.
    // Deleting only the folder entry leaves a non-null Map that list() treats as a valid cache hit,
    // causing findTaskByFolder to miss the invalidated entry.
    this.taskIndex.delete(featureName);
    this.beadIdIndex.delete(featureName);
  }

  // ---------------------------------------------------------------------------
  // Audit Trail Methods
  // ---------------------------------------------------------------------------

  /**
   * Append a transition comment to track state changes.
   * Wrapped in try/catch to ensure audit failures never block status changes.
   */
  private appendTransitionComment(beadId: string, from: string, to: string, summary?: string): void {
    const timestamp = new Date().toISOString();
    const transition: TransitionEvent = {
      beadId,
      from,
      to,
      timestamp,
      summary,
    };

    // Write to local journal first (fast, survives bead flush failures)
    const journalEntry = this.journal.append({ beadId, from, to, timestamp, summary });
    transition.journalSeq = journalEntry.seq;

    this.pendingTransitions.push(transition);
    if (!this.transitionBatchMode) {
      this.flushTransitionAudit();
    }
  }

  /**
   * Flush a single transition comment to the bead.
   * Swallows errors to ensure audit failures never block operations.
   */
  private flushSingleTransition(transition: TransitionEvent): boolean {
    try {
      const commentBody = `[warcraft:transition] ${transition.from} → ${transition.to} | ${transition.timestamp} | ${transition.summary ?? ''}`;
      const result = this.repository.appendComment(transition.beadId, commentBody.trim());
      if (result.success === false) {
        console.warn(
          `[warcraft] Failed to append transition comment for '${transition.beadId}': ${result.error.message}`,
        );
        return false;
      }
      // Mark the journal entry as acknowledged only after confirmed comment write
      if (transition.journalSeq != null) {
        this.journal.markCommentWritten(transition.journalSeq);
      }
      return true;
    } catch (error) {
      // Audit failures must never block status changes
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to append transition comment for '${transition.beadId}': ${reason}`);
      return false;
    }
  }

  /**
   * Flush all pending transition audits.
   * Called after batch operations to ensure all transitions are recorded.
   */
  flushTransitionAudit(): void {
    // Process each pending transition, retaining failures for later retry
    const retained: TransitionEvent[] = [];
    for (const transition of this.pendingTransitions) {
      const success = this.flushSingleTransition(transition);
      if (!success) {
        retained.push(transition);
      }
    }
    this.pendingTransitions = retained;
  }
}
