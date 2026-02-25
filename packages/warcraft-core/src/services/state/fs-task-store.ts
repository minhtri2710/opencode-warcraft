import * as fs from 'fs';
import type { TaskStatus, TaskInfo } from '../../types.js';
import type { TaskStore, TaskArtifactKind, TaskSaveOptions } from './types.js';
import type { RunnableTasksResult, BackgroundPatchFields } from '../taskService.js';
import { TASK_STATUS_SCHEMA_VERSION } from '../taskService.js';
import { BeadsRepository } from '../beads/BeadsRepository.js';
import {
  getTasksPath,
  getTaskPath,
  getTaskStatusPath,
  getTaskReportPath,
  ensureDir,
  readJson,
  writeJson,
  writeJsonLockedSync,
  patchJsonLockedSync,
  writeText,
  fileExists,
  LockOptions,
} from '../../utils/paths.js';

/**
 * TaskStore implementation for beadsMode='off'.
 *
 * Task state lives in local filesystem (`tasks/<folder>/status.json`).
 * Still uses BeadsRepository for bead creation when available (task identification).
 */
export class FilesystemTaskStore implements TaskStore {
  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

  createTask(
    featureName: string,
    folder: string,
    title: string,
    status: TaskStatus,
    priority: number,
  ): TaskStatus {
    let beadId = '';

    // Attempt bead creation for task identification, but don't fail if unavailable
    try {
      const epicResult = this.repository.getEpicByFeatureName(featureName, true);
      if (epicResult.success !== false) {
        const epicBeadId = epicResult.value!;
        beadId = this.repository.getGateway().createTask(title, epicBeadId, priority);
      }
    } catch {
      // Beads unavailable in off mode - generate a local identifier
      beadId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    if (!beadId) {
      beadId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const statusWithBead: TaskStatus = { ...status, beadId };

    const taskPath = getTaskPath(this.projectRoot, featureName, folder);
    ensureDir(taskPath);
    writeJson(getTaskStatusPath(this.projectRoot, featureName, folder), statusWithBead);

    return statusWithBead;
  }

  get(featureName: string, folder: string): TaskInfo | null {
    const statusPath = getTaskStatusPath(this.projectRoot, featureName, folder);
    const status = readJson<TaskStatus>(statusPath);

    if (!status) return null;

    return {
      folder,
      name: folder.replace(/^\d+-/, ''),
      beadId: status.beadId,
      status: status.status,
      origin: status.origin,
      planTitle: status.planTitle,
      summary: status.summary,
    };
  }

  getRawStatus(featureName: string, folder: string): TaskStatus | null {
    return readJson<TaskStatus>(getTaskStatusPath(this.projectRoot, featureName, folder));
  }

  list(featureName: string): TaskInfo[] {
    const tasksPath = getTasksPath(this.projectRoot, featureName);
    if (!fileExists(tasksPath)) return [];

    const folders = fs.readdirSync(tasksPath, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
      .map((d: { name: string }) => d.name)
      .sort();

    return folders
      .map(folder => this.get(featureName, folder))
      .filter((t): t is TaskInfo => t !== null);
  }

  getNextOrder(featureName: string): number {
    const tasksPath = getTasksPath(this.projectRoot, featureName);
    if (!fileExists(tasksPath)) return 1;

    const folders = fs.readdirSync(tasksPath, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
      .map((d: { name: string }) => d.name);

    if (folders.length === 0) return 1;

    const orders = folders
      .map(f => parseInt(f.split('-')[0], 10))
      .filter(n => !isNaN(n));

    return Math.max(...orders, 0) + 1;
  }

  save(
    featureName: string,
    folder: string,
    status: TaskStatus,
    _options?: TaskSaveOptions,
  ): void {
    writeJsonLockedSync(getTaskStatusPath(this.projectRoot, featureName, folder), status);
  }

  patchBackground(
    featureName: string,
    folder: string,
    patch: BackgroundPatchFields,
    lockOptions?: LockOptions,
  ): TaskStatus {
    const statusPath = getTaskStatusPath(this.projectRoot, featureName, folder);

    const safePatch: Partial<TaskStatus> = {
      schemaVersion: TASK_STATUS_SCHEMA_VERSION,
    };

    if (patch.idempotencyKey !== undefined) {
      safePatch.idempotencyKey = patch.idempotencyKey;
    }

    if (patch.workerSession !== undefined) {
      safePatch.workerSession = patch.workerSession as TaskStatus['workerSession'];
    }

    return patchJsonLockedSync<TaskStatus>(statusPath, safePatch, lockOptions);
  }

  delete(featureName: string, folder: string): void {
    const taskPath = getTaskPath(this.projectRoot, featureName, folder);
    if (fileExists(taskPath)) {
      fs.rmSync(taskPath, { recursive: true });
    }
  }

  writeArtifact(
    featureName: string,
    folder: string,
    kind: TaskArtifactKind,
    content: string,
  ): string {
    const status = this.getRawStatus(featureName, folder);
    const beadId = status?.beadId;

    if (beadId) {
      try {
        this.repository.upsertTaskArtifact(beadId, kind, content);
        return beadId;
      } catch {
        // Bead write failed - return folder as identifier
      }
    }

    return folder;
  }

  readArtifact(
    featureName: string,
    folder: string,
    kind: TaskArtifactKind,
  ): string | null {
    const status = this.getRawStatus(featureName, folder);
    const beadId = status?.beadId;

    if (beadId) {
      try {
        const readResult = this.repository.readTaskArtifact(beadId, kind);
        return readResult.success ? readResult.value : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  writeReport(featureName: string, folder: string, report: string): string {
    const reportPath = getTaskReportPath(this.projectRoot, featureName, folder);
    writeText(reportPath, report);
    return reportPath;
  }

  getRunnableTasks(_featureName: string): RunnableTasksResult | null {
    // Filesystem store doesn't support advanced scheduling;
    // service layer uses its own filesystem-based dependency resolution.
    return null;
  }

  flush(): void {
    // No-op for filesystem store
  }
}
