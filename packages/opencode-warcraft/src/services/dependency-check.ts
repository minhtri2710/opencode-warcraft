import { type BvTriageService, buildEffectiveDependencies, type TaskService } from 'warcraft-core';

// ============================================================================
// Dependency Check Service
// Validates that a task's dependencies are satisfied before execution.
// ============================================================================

/**
 * Create a checkDependencies function that verifies all deps for a task are done.
 *
 * @param taskService - Service for querying task status.
 * @param bvTriageService - Service for triage/health info.
 */
export function createCheckDependencies(
  taskService: TaskService,
  bvTriageService: BvTriageService,
): (feature: string, taskFolder: string) => { allowed: boolean; error?: string } {
  return (feature: string, taskFolder: string): { allowed: boolean; error?: string } => {
    const taskStatus = taskService.getRawStatus(feature, taskFolder);
    if (!taskStatus) {
      return { allowed: true };
    }

    const tasks = taskService.list(feature).map((task) => {
      const status = taskService.getRawStatus(feature, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: status?.dependsOn,
      };
    });

    const effectiveDeps = buildEffectiveDependencies(tasks);
    const deps = effectiveDeps.get(taskFolder) ?? [];

    if (deps.length === 0) {
      return { allowed: true };
    }

    const unmetDeps: Array<{ folder: string; status: string }> = [];

    for (const depFolder of deps) {
      const depStatus = taskService.getRawStatus(feature, depFolder);

      if (!depStatus || depStatus.status !== 'done') {
        unmetDeps.push({
          folder: depFolder,
          status: depStatus?.status ?? 'unknown',
        });
      }
    }

    if (unmetDeps.length > 0) {
      const depList = unmetDeps.map((d) => `"${d.folder}" (${d.status})`).join(', ');
      const triage = taskStatus.beadId ? bvTriageService.getBlockerTriage(taskStatus.beadId) : null;
      const bvHealth = bvTriageService.getHealth();
      const triageHint = triage
        ? ` Beads triage (bv): ${triage.summary}`
        : bvHealth.lastError
          ? ` Beads triage (bv unavailable): ${bvHealth.lastError}`
          : '';

      return {
        allowed: false,
        error:
          `Dependency constraint: Task "${taskFolder}" cannot start - dependencies not done: ${depList}. ` +
          `Only tasks with status 'done' satisfy dependencies.${triageHint}`,
      };
    }

    return { allowed: true };
  };
}
