import type { TaskStatusType } from '../types.js';

/**
 * Minimal task info needed for dependency graph computation.
 */
export interface TaskWithDeps {
  folder: string;
  status: TaskStatusType;
  dependsOn?: string[];
}

/**
 * Result of computing runnable and blocked tasks.
 */
export interface RunnableBlockedResult {
  /** Task folders that are pending and have all dependencies satisfied (done) */
  runnable: string[];
  /** Map of task folder -> array of unsatisfied dependency folders */
  blocked: Record<string, string[]>;
}

/**
 * Compute which pending tasks are runnable (all deps done) and which are blocked.
 * 
 * A task is runnable if:
 * - Its status is 'pending'
 * - All its dependencies have status 'done'
 * 
 * A task is blocked if:
 * - Its status is 'pending'
 * - At least one dependency does NOT have status 'done'
 * 
 * Only 'done' satisfies a dependency. Other statuses (in_progress, cancelled,
 * failed, blocked, partial) do NOT satisfy dependencies.
 * 
 * @param tasks - Array of tasks with their status and dependencies
 * @returns Object with runnable task folders and blocked tasks with their missing deps
 */
export function computeRunnableAndBlocked(tasks: TaskWithDeps[]): RunnableBlockedResult {
  const statusByFolder = new Map<string, TaskStatusType>();
  for (const task of tasks) {
    statusByFolder.set(task.folder, task.status);
  }

  const runnable: string[] = [];
  const blocked: Record<string, string[]> = {};

  const effectiveDepsByFolder = buildEffectiveDependencies(tasks);

  for (const task of tasks) {
    if (task.status !== 'pending') {
      continue;
    }

    const deps = effectiveDepsByFolder.get(task.folder) ?? [];

    const unmetDeps = deps.filter(dep => {
      const depStatus = statusByFolder.get(dep);
      return depStatus !== 'done';
    });

    if (unmetDeps.length === 0) {
      runnable.push(task.folder);
    } else {
      blocked[task.folder] = unmetDeps;
    }
  }

  return { runnable, blocked };
}

/**
 * Compute effective dependencies for each task, applying current numeric
 * sequential fallback when dependsOn is undefined.
 * 
 * If two tasks share the same numeric prefix (e.g., two `02-*` folders),
 * only the first is used for ordering; a warning is logged for duplicates.
 */
export function buildEffectiveDependencies(tasks: TaskWithDeps[]): Map<string, string[]> {
  const orderByFolder = new Map<string, number | null>();
  const folderByOrder = new Map<number, string>();
  const duplicatePrefixes: Array<{ order: number; folder: string; existingFolder: string }> = [];

  for (const task of tasks) {
    const match = task.folder.match(/^(\d+)-/);
    if (!match) {
      orderByFolder.set(task.folder, null);
      continue;
    }

    const order = parseInt(match[1], 10);
    orderByFolder.set(task.folder, order);
    if (folderByOrder.has(order)) {
      duplicatePrefixes.push({ order, folder: task.folder, existingFolder: folderByOrder.get(order)! });
    } else {
      folderByOrder.set(order, task.folder);
    }
  }

  if (duplicatePrefixes.length > 0) {
    for (const dup of duplicatePrefixes) {
      console.warn(
        `[taskDependencyGraph] Duplicate numeric prefix ${String(dup.order).padStart(2, '0')}: ` +
        `folder '${dup.folder}' collides with '${dup.existingFolder}'. ` +
        `Using '${dup.existingFolder}' for dependency ordering; '${dup.folder}' is skipped.`,
      );
    }
  }

  const effectiveDeps = new Map<string, string[]>();

  for (const task of tasks) {
    if (task.dependsOn !== undefined) {
      effectiveDeps.set(task.folder, task.dependsOn);
      continue;
    }

    const order = orderByFolder.get(task.folder);
    if (!order || order <= 1) {
      effectiveDeps.set(task.folder, []);
      continue;
    }

    const previousFolder = folderByOrder.get(order - 1);
    effectiveDeps.set(task.folder, previousFolder ? [previousFolder] : []);
  }

  return effectiveDeps;
}

/**
 * Validates that all task folders have unique numeric prefixes.
 * Returns an array of error messages for any collisions found.
 * Callers can invoke this at task creation time to catch issues early.
 * 
 * @param folders - Array of task folder names (e.g., '01-setup', '02-api')
 * @returns Array of error messages, empty if no collisions
 */
export function validateUniquePrefixes(folders: string[]): string[] {
  const seen = new Map<number, string>();
  const errors: string[] = [];

  for (const folder of folders) {
    const match = folder.match(/^(\d+)-/);
    if (!match) continue;

    const order = parseInt(match[1], 10);
    if (seen.has(order)) {
      errors.push(
        `Duplicate prefix ${String(order).padStart(2, '0')}: '${folder}' collides with '${seen.get(order)!}'`,
      );
    } else {
      seen.set(order, folder);
    }
  }

  return errors;
}
