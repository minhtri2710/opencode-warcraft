import * as fs from 'fs';
import type { TaskInfo, TaskOrigin, TaskStatus, WorkerSession } from '../../types.js';
import { fileExists, readJson } from '../../utils/fs.js';
import type { LockOptions } from '../../utils/json-lock.js';
import { getTaskPath, getTaskReportPath, getTaskStatusPath } from '../../utils/paths.js';
import { deriveTaskFolder, slugifyTaskName } from '../../utils/slug.js';
import { encodeTaskState, taskStateFromTaskStatus } from '../beads/artifactSchemas.js';
import { type BeadsRepository, isRepositoryInitFailure } from '../beads/BeadsRepository.js';
import { mapBeadStatusToTaskStatus } from '../beads/beadStatus.js';
import type { TaskWithDeps } from '../taskDependencyGraph.js';
import { computeRunnableAndBlocked } from '../taskDependencyGraph.js';
import type { BackgroundPatchFields, RunnableTask, RunnableTasksResult } from '../taskService.js';
import { TASK_STATUS_SCHEMA_VERSION } from '../taskService.js';
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
}

/**
 * TaskStore implementation for beadsMode='on'.
 *
 * All task state is canonical in bead artifacts.
 * Local filesystem is used only for delete (cleanup) and as fallback reads.
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

  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

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

    const beadId = this.repository.getGateway().createTask(title, epicBeadId, priority);
    const statusWithBead: TaskStatus = { ...status, beadId };

    const setTaskStateResult = this.repository.setTaskState(beadId, { ...statusWithBead, folder } as TaskStatus);
    if (setTaskStateResult.success === false) {
      this.throwIfInitFailure(setTaskStateResult.error, `Failed to persist task state for '${beadId}'`);
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
      });
    }

    return statusWithBead;
  }

  get(featureName: string, folder: string): TaskInfo | null {
    // Check cache first for O(1) lookup
    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      const cachedTask = featureTaskIndex.get(folder);
      if (cachedTask) {
        return cachedTask;
      }
      // Folder exists in cache but not found, return null
      return null;
    }

    // Cache miss: populate index via list()
    const tasks = this.list(featureName);
    return tasks.find((t) => t.folder === folder) ?? null;
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
        return {
          ...taskState,
          beadId,
          folder: (taskState as TaskStatus & { folder?: string }).folder ?? folder,
        };
      }

      // Minimal fallback from bead info
      const beadsTask = this.findTaskByFolder(featureName, folder);
      if (beadsTask) {
        return {
          status: beadsTask.status,
          origin: beadsTask.origin,
          planTitle: beadsTask.planTitle ?? beadsTask.name,
          beadId: beadsTask.beadId,
        };
      }
    }

    // Filesystem fallback
    const status = readJson<TaskStatus>(getTaskStatusPath(this.projectRoot, featureName, folder));
    if (!status) {
      return null;
    }
    return {
      ...status,
      folder: (status as TaskStatus & { folder?: string }).folder ?? folder,
    };
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
        this.throwIfInitFailure(listResult.error, `Failed to list task beads for epic '${epicBeadId}'`);
      }
      const taskBeads = listResult.success ? listResult.value : [];
      const sortedTaskBeads = [...taskBeads].sort((a, b) => a.title.localeCompare(b.title));

      const tasks = sortedTaskBeads.map((bead, index) => {
        const beadStatus = mapBeadStatusToTaskStatus(bead.status);
        const taskState = this.readTaskState(bead.id);
        if (taskState) {
          return {
            folder:
              (taskState as TaskStatus & { folder?: string }).folder ??
              deriveTaskFolder(index + 1, slugifyTaskName(bead.title)),
            name:
              ((taskState as TaskStatus & { folder?: string }).folder ?? '').replace(/^\d+-/, '') ||
              slugifyTaskName(bead.title),
            beadId: bead.id,
            status: taskState.status,
            origin: taskState.origin,
            planTitle: taskState.planTitle ?? bead.title,
            summary: taskState.summary,
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
      this.throwIfInitFailure(error, `Failed to list tasks for feature '${featureName}'`);
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

    this.repository.setTaskState(status.beadId, { ...status, folder } as TaskStatus);

    // Invalidate cache entry for the modified task
    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      featureTaskIndex.delete(folder);
    }
    const featureBeadIdIndex = this.beadIdIndex.get(featureName);
    if (featureBeadIdIndex) {
      featureBeadIdIndex.delete(folder);
    }

    if (options?.syncBeadStatus && status.status) {
      try {
        this.repository.getGateway().syncTaskStatus(status.beadId, status.status);
      } catch (error) {
        this.throwIfInitFailure(error, `[warcraft] Failed to sync bead status for '${status.beadId}'`);
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[warcraft] Failed to sync bead status for '${status.beadId}': ${reason}`);
      }
      const flushResult = this.repository.flushArtifacts();
      if (flushResult.success === false) {
        this.throwIfInitFailure(
          flushResult.error,
          `[warcraft] Failed to flush artifacts after syncing bead status for '${status.beadId}'`,
        );
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

    if (status.beadId) {
      // Performance path: encode directly without flush
      const artifact = taskStateFromTaskStatus({ ...updated, folder } as TaskStatus);
      const encoded = encodeTaskState(artifact);
      this.repository.getGateway().upsertArtifact(status.beadId, 'task_state', encoded);
    }

    // Invalidate cache entry for the patched task
    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      featureTaskIndex.delete(folder);
    }
    const featureBeadIdIndex = this.beadIdIndex.get(featureName);
    if (featureBeadIdIndex) {
      featureBeadIdIndex.delete(folder);
    }

    return updated;
  }

  delete(featureName: string, folder: string): void {
    const taskPath = getTaskPath(this.projectRoot, featureName, folder);
    if (fileExists(taskPath)) {
      fs.rmSync(taskPath, { recursive: true });
    }

    // Invalidate cache entry for the deleted task
    const featureTaskIndex = this.taskIndex.get(featureName);
    if (featureTaskIndex) {
      featureTaskIndex.delete(folder);
    }
    const featureBeadIdIndex = this.beadIdIndex.get(featureName);
    if (featureBeadIdIndex) {
      featureBeadIdIndex.delete(folder);
    }
  }

  writeArtifact(featureName: string, folder: string, kind: TaskArtifactKind, content: string): string {
    const status = this.getRawStatus(featureName, folder);
    if (!status?.beadId) {
      throw new Error(`Task '${folder}' does not have beadId`);
    }

    this.repository.upsertTaskArtifact(status.beadId, kind, content);
    const flushResult = this.repository.flushArtifacts();
    if (flushResult.success === false) {
      this.throwIfInitFailure(
        flushResult.error,
        `[warcraft] Failed to flush artifacts after writing '${kind}' for '${status.beadId}'`,
      );
    }
    return status.beadId;
  }

  readArtifact(featureName: string, folder: string, kind: TaskArtifactKind): string | null {
    const importResult = this.repository.importArtifacts();
    if (importResult.success === false) {
      this.throwIfInitFailure(importResult.error, `[warcraft] Failed to import artifacts before reading '${kind}'`);
    }

    const status = this.getRawStatus(featureName, folder);
    if (!status?.beadId) {
      return null;
    }

    const readResult = this.repository.readTaskArtifact(status.beadId, kind);
    if (readResult.success === false) {
      this.throwIfInitFailure(readResult.error, `[warcraft] Failed to read '${kind}' artifact for '${status.beadId}'`);
      return null;
    }
    return readResult.value;
  }

  writeReport(featureName: string, folder: string, report: string): string {
    this.writeArtifact(featureName, folder, 'report', report);
    return getTaskReportPath(this.projectRoot, featureName, folder);
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
      this.throwIfInitFailure(error, `[warcraft] Failed to get runnable tasks for feature '${featureName}'`);
      const reason = error instanceof Error ? error.message : String(error);
      // Log at error level so issues are visible in agent output
      console.error(`[warcraft] Failed to get runnable tasks from beads: ${reason}`);
      return null;
    }
  }

  flush(): void {
    const flushResult = this.repository.flushArtifacts();
    if (flushResult.success === false) {
      this.throwIfInitFailure(flushResult.error, '[warcraft] Failed to flush bead artifacts');
    }
  }

  /**
   * Sync bead-level dependency edges to match task dependsOn relationships.
   * Idempotent: reads existing edges, computes desired edges, adds missing, removes stale.
   */
  syncDependencies(featureName: string): void {
    const gateway = this.repository.getGateway();
    const tasks = this.list(featureName);

    // Build folder→beadId map
    const folderToBeadId = new Map<string, string>();
    for (const task of tasks) {
      if (task.beadId) {
        folderToBeadId.set(task.folder, task.beadId);
      }
    }

    // Compute desired dependency edges from task dependsOn fields
    const desiredEdges = new Set<string>();
    for (const task of tasks) {
      if (!task.beadId) continue;
      const rawStatus = this.getRawStatus(featureName, task.folder);
      if (!rawStatus?.dependsOn) continue;

      for (const depFolder of rawStatus.dependsOn) {
        const depBeadId = folderToBeadId.get(depFolder);
        if (depBeadId) {
          // Edge key: "taskBeadId->depBeadId" (task depends on dep)
          desiredEdges.add(`${task.beadId}->${depBeadId}`);
        } else {
          console.warn(
            `[warcraft] Dependency '${depFolder}' for task '${task.folder}' cannot be resolved to a bead ID`,
          );
        }
      }
    }

    // Guard: verify the feature has a valid epic before syncing dependencies
    const epicResult = this.repository.getEpicByFeatureName(featureName, true);
    if (epicResult.success === false) {
      console.warn(`[warcraft] Cannot sync dependencies: ${epicResult.error.message}`);
      return;
    }
    const existingEdges = new Set<string>();
    try {
      // Read existing dependency edges per-task via bead graph queries
      for (const task of tasks) {
        if (!task.beadId) continue;
        try {
          const depOutput = gateway.listDependencies(task.beadId);
          for (const dep of depOutput) {
            existingEdges.add(`${task.beadId}->${dep.id}`);
          }
        } catch {
          // Task may not have dependencies yet — that's fine
        }
      }
    } catch {
      // Cannot read existing edges — proceed with add-only mode
    }

    // Add missing edges
    for (const edge of desiredEdges) {
      if (!existingEdges.has(edge)) {
        const [taskBeadId, depBeadId] = edge.split('->');
        try {
          gateway.addDependency(taskBeadId, depBeadId);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[warcraft] Failed to add dependency ${taskBeadId} -> ${depBeadId}: ${reason}`);
        }
      }
    }

    // Remove stale edges
    for (const edge of existingEdges) {
      if (!desiredEdges.has(edge)) {
        const [taskBeadId, depBeadId] = edge.split('->');
        try {
          gateway.removeDependency(taskBeadId, depBeadId);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[warcraft] Failed to remove dependency ${taskBeadId} -> ${depBeadId}: ${reason}`);
        }
      }
    }

    // Advisory cycle detection via bv --robot-insights (non-blocking)
    try {
      const viewerGateway = this.repository.getViewerGateway();
      const health = viewerGateway.getHealth();
      if (health.available) {
        const insights = viewerGateway.getRobotInsights();
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
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
      this.throwIfInitFailure(result.error, `[warcraft] Failed to read task state for bead '${beadId}'`);
      return null;
    }
    if (!result.value) {
      return null;
    }
    return result.value;
  }

  private throwIfInitFailure(error: unknown, context: string): void {
    if (!isRepositoryInitFailure(error)) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: ${reason}`);
  }

  // ---------------------------------------------------------------------------
  // Audit Trail Methods
  // ---------------------------------------------------------------------------

  /**
   * Append a transition comment to track state changes.
   * Wrapped in try/catch to ensure audit failures never block status changes.
   */
  private appendTransitionComment(beadId: string, from: string, to: string, summary?: string): void {
    const transition: TransitionEvent = {
      beadId,
      from,
      to,
      timestamp: new Date().toISOString(),
      summary,
    };

    this.pendingTransitions.push(transition);
    if (!this.transitionBatchMode) {
      this.flushTransitionAudit();
    }
  }

  /**
   * Flush a single transition comment to the bead.
   * Swallows errors to ensure audit failures never block operations.
   */
  private flushSingleTransition(transition: TransitionEvent): void {
    try {
      const commentBody = `[warcraft:transition] ${transition.from} → ${transition.to} | ${transition.timestamp} | ${transition.summary ?? ''}`;
      this.repository.appendComment(transition.beadId, commentBody.trim());
    } catch (error) {
      // Audit failures must never block status changes
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to append transition comment for '${transition.beadId}': ${reason}`);
    }
  }

  /**
   * Flush all pending transition audits.
   * Called after batch operations to ensure all transitions are recorded.
   */
  flushTransitionAudit(): void {
    // Process each pending transition
    for (const transition of this.pendingTransitions) {
      this.flushSingleTransition(transition);
    }
    // Clear pending transitions after flushing
    this.pendingTransitions = [];
  }
}
