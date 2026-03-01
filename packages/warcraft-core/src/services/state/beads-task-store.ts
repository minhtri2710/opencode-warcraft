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

/**
 * TaskStore implementation for beadsMode='on'.
 *
 * All task state is canonical in bead artifacts.
 * Local filesystem is used only for delete (cleanup) and as fallback reads.
 */
export class BeadsTaskStore implements TaskStore {
  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

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

    return statusWithBead;
  }

  get(featureName: string, folder: string): TaskInfo | null {
    const tasks = this.list(featureName);
    return tasks.find((t) => t.folder === folder) ?? null;
  }

  getRawStatus(featureName: string, folder: string): TaskStatus | null {
    // Try beads path first: find task to get beadId, then read state
    const beadsTask = this.findTaskByFolder(featureName, folder);
    if (beadsTask?.beadId) {
      const taskState = this.readTaskState(beadsTask.beadId);
      if (taskState) {
        return taskState;
      }

      // Minimal fallback from bead info
      return {
        status: beadsTask.status,
        origin: beadsTask.origin,
        planTitle: beadsTask.planTitle ?? beadsTask.name,
        beadId: beadsTask.beadId,
      };
    }

    // Filesystem fallback
    return readJson<TaskStatus>(getTaskStatusPath(this.projectRoot, featureName, folder));
  }

  list(featureName: string): TaskInfo[] {
    try {
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

      return tasks.sort((a, b) => {
        const aOrder = parseInt(a.folder.split('-')[0], 10);
        const bOrder = parseInt(b.folder.split('-')[0], 10);
        return aOrder - bOrder;
      });
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

  save(_featureName: string, folder: string, status: TaskStatus, options?: TaskSaveOptions): void {
    if (!status.beadId) {
      throw new Error(`Cannot save task '${folder}' without beadId in beads mode`);
    }

    this.repository.setTaskState(status.beadId, { ...status, folder } as TaskStatus);

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

    return updated;
  }

  delete(featureName: string, folder: string): void {
    const taskPath = getTaskPath(this.projectRoot, featureName, folder);
    if (fileExists(taskPath)) {
      fs.rmSync(taskPath, { recursive: true });
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

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private findTaskByFolder(featureName: string, folder: string): TaskInfo | null {
    try {
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
}
