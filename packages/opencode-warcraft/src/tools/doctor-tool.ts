import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { FeatureService, StaleWorktreeInfo, TaskService, TaskStatus, WorktreeService } from 'warcraft-core';
import type { BlockedResult } from '../types.js';
import { toolSuccess } from '../types.js';

export interface DoctorToolsDependencies {
  featureService: FeatureService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  checkBlocked: (feature: string) => BlockedResult;
}

interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: unknown;
}

interface BlockedTaskDiagnostic {
  folder: string;
  name: string;
  dependsOn: string[] | null;
  workspace: {
    mode: 'direct' | 'worktree';
    path: string | null;
  } | null;
}

interface BlockedFeatureDiagnostic {
  feature: string;
  reason: string | undefined;
  blockedPath?: string;
  tasks: BlockedTaskDiagnostic[];
}

/** Threshold in ms for dispatch_prepared to be considered stuck (60s). */
const DISPATCH_PREPARED_STALE_MS = 60_000;

/** Threshold in ms for in_progress without activity to be considered stuck (30min). */
const IN_PROGRESS_STALE_MS = 30 * 60 * 1000;

/**
 * Doctor domain tools - Run diagnostic checks on the warcraft system.
 */
export class DoctorTools {
  constructor(private readonly deps: DoctorToolsDependencies) {}

  /**
   * Run diagnostic checks across all features and return structured results.
   * Diagnoses only — never auto-fixes.
   */
  doctorTool(): ToolDefinition {
    const { featureService, taskService, worktreeService, checkBlocked } = this.deps;

    return tool({
      description:
        'Run diagnostic checks on the warcraft system. Detects stuck tasks, stale worktrees, blocked features, and workspace mode details. Diagnoses only — never auto-fixes.',
      args: {},
      async execute() {
        const checks: DiagnosticCheck[] = [];
        let features: string[] = [];
        let featureInventoryFailure: string | null = null;

        try {
          features = featureService.list();
        } catch (error) {
          featureInventoryFailure = error instanceof Error ? error.message : String(error);
        }

        const stuckDispatchPrepared: Array<{
          feature: string;
          folder: string;
          name: string;
          staleForSeconds: number;
        }> = [];
        const stuckInProgress: Array<{
          feature: string;
          folder: string;
          name: string;
          staleForMinutes: number;
        }> = [];
        const directModeTasks: Array<{
          feature: string;
          folder: string;
          name: string;
          workspacePath: string | undefined;
        }> = [];
        const blockedFeatures: BlockedFeatureDiagnostic[] = [];
        const allStaleWorktrees: Array<{
          feature: string;
          step: string;
          path: string;
          ageInDays: number | null;
        }> = [];
        const worktreeInspectionFailures: Array<{
          feature: string;
          error: string;
        }> = [];
        const orphanedBranches: Array<{
          feature: string;
          step: string;
          path: string;
          taskStatus: string;
        }> = [];

        const now = Date.now();

        for (const featureName of features) {
          // Check blocked status
          const blockedResult = checkBlocked(featureName);

          const tasks = taskService.list(featureName);
          const taskStatusMap = new Map<string, string>();
          const blockedTaskDetails: BlockedTaskDiagnostic[] = [];

          for (const task of tasks) {
            taskStatusMap.set(task.folder, task.status);
            const rawStatus = taskService.getRawStatus(featureName, task.folder) as TaskStatus | null;

            if (task.status === 'blocked') {
              blockedTaskDetails.push({
                folder: task.folder,
                name: task.name,
                dependsOn: rawStatus?.dependsOn ?? null,
                workspace: rawStatus?.workerSession
                  ? {
                      mode: rawStatus.workerSession.workspaceMode ?? 'worktree',
                      path: rawStatus.workerSession.workspacePath ?? null,
                    }
                  : null,
              });
            }

            // Check stuck dispatch_prepared
            if (task.status === 'dispatch_prepared' && rawStatus) {
              const preparedAt = rawStatus.preparedAt ? new Date(rawStatus.preparedAt).getTime() : null;
              if (preparedAt && now - preparedAt > DISPATCH_PREPARED_STALE_MS) {
                stuckDispatchPrepared.push({
                  feature: featureName,
                  folder: task.folder,
                  name: task.name,
                  staleForSeconds: Math.round((now - preparedAt) / 1000),
                });
              }
            }

            // Check stuck in_progress
            if (task.status === 'in_progress' && rawStatus) {
              const heartbeat = rawStatus.workerSession?.lastHeartbeatAt;
              const lastActivity = heartbeat
                ? new Date(heartbeat).getTime()
                : rawStatus.startedAt
                  ? new Date(rawStatus.startedAt).getTime()
                  : null;
              if (lastActivity && now - lastActivity > IN_PROGRESS_STALE_MS) {
                stuckInProgress.push({
                  feature: featureName,
                  folder: task.folder,
                  name: task.name,
                  staleForMinutes: Math.round((now - lastActivity) / 60_000),
                });
              }
            }

            // Check direct-mode tasks
            if (task.status === 'in_progress' && rawStatus?.workerSession?.workspaceMode === 'direct') {
              directModeTasks.push({
                feature: featureName,
                folder: task.folder,
                name: task.name,
                workspacePath: rawStatus.workerSession.workspacePath,
              });
            }
          }

          if (blockedResult.blocked) {
            blockedFeatures.push({
              feature: featureName,
              reason: blockedResult.reason,
              blockedPath: blockedResult.blockedPath,
              tasks: blockedTaskDetails,
            });
          }

          // Check worktrees
          try {
            const worktrees = await worktreeService.listAll(featureName);
            for (const wt of worktrees as StaleWorktreeInfo[]) {
              // Stale worktrees (exist but no associated active task)
              if (wt.isStale) {
                allStaleWorktrees.push({
                  feature: wt.feature,
                  step: wt.step,
                  path: wt.path,
                  ageInDays:
                    wt.lastCommitAge != null && Number.isFinite(wt.lastCommitAge)
                      ? Math.floor(wt.lastCommitAge / 86_400_000)
                      : null,
                });
              }

              // Orphaned branches: worktree exists but task is done/cancelled
              const taskStatus = taskStatusMap.get(wt.step);
              if (taskStatus === 'done' || taskStatus === 'cancelled') {
                orphanedBranches.push({
                  feature: wt.feature,
                  step: wt.step,
                  path: wt.path,
                  taskStatus,
                });
              }
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            worktreeInspectionFailures.push({
              feature: featureName,
              error: reason,
            });
          }
        }

        // Build check results
        checks.push(
          featureInventoryFailure
            ? {
                name: 'feature_inventory',
                status: 'warning',
                message: `Failed to enumerate features: ${featureInventoryFailure}`,
              }
            : {
                name: 'feature_inventory',
                status: 'ok',
                message: 'Feature inventory loaded successfully.',
              },
        );

        checks.push(
          stuckDispatchPrepared.length > 0
            ? {
                name: 'stuck_dispatch_prepared',
                status: 'warning',
                message: `${stuckDispatchPrepared.length} task(s) stuck in dispatch_prepared for >60s. The LLM may not have called task().`,
                details: stuckDispatchPrepared,
              }
            : {
                name: 'stuck_dispatch_prepared',
                status: 'ok',
                message: 'No stuck dispatch_prepared tasks.',
              },
        );

        checks.push(
          stuckInProgress.length > 0
            ? {
                name: 'stuck_in_progress',
                status: 'warning',
                message: `${stuckInProgress.length} task(s) in_progress without recent activity (>30min).`,
                details: stuckInProgress,
              }
            : {
                name: 'stuck_in_progress',
                status: 'ok',
                message: 'No stuck in_progress tasks.',
              },
        );

        checks.push(
          blockedFeatures.length > 0
            ? {
                name: 'check_blocked_failures',
                status: 'warning',
                message: `${blockedFeatures.length} feature(s) currently blocked. Fail-closed: may indicate BLOCKED file or read errors. Blocked task workspace and dependency details are included for status parity.`,
                details: blockedFeatures,
              }
            : {
                name: 'check_blocked_failures',
                status: 'ok',
                message: 'No blocked features detected.',
              },
        );

        checks.push(
          directModeTasks.length > 0
            ? {
                name: 'direct_mode_tasks',
                status: 'ok',
                message: `${directModeTasks.length} task(s) running in direct mode (no worktree isolation). This is a supported execution mode.`,
                details: directModeTasks,
              }
            : {
                name: 'direct_mode_tasks',
                status: 'ok',
                message: 'No direct-mode tasks active.',
              },
        );

        checks.push(
          allStaleWorktrees.length > 0 || worktreeInspectionFailures.length > 0
            ? {
                name: 'stale_worktrees',
                status: 'warning',
                message:
                  worktreeInspectionFailures.length > 0
                    ? `Failed to inspect worktrees for ${worktreeInspectionFailures.length} feature(s).`
                    : `${allStaleWorktrees.length} stale worktree(s) found with no associated active task.`,
                details:
                  worktreeInspectionFailures.length > 0
                    ? { staleWorktrees: allStaleWorktrees, inspectionFailures: worktreeInspectionFailures }
                    : allStaleWorktrees,
              }
            : {
                name: 'stale_worktrees',
                status: 'ok',
                message: 'No stale worktrees.',
              },
        );

        checks.push(
          orphanedBranches.length > 0
            ? {
                name: 'orphaned_branches',
                status: 'warning',
                message: `${orphanedBranches.length} orphaned branch(es): worktree exists but task is completed/cancelled.`,
                details: orphanedBranches,
              }
            : {
                name: 'orphaned_branches',
                status: 'ok',
                message: 'No orphaned branches.',
              },
        );

        const issueCount = checks.filter((c) => c.status !== 'ok').length;
        const summary =
          issueCount === 0
            ? `All checks passed. 0 issues found across ${features.length} feature(s).`
            : `${issueCount} issue${issueCount === 1 ? '' : 's'} found across ${features.length} feature(s). Run recommended actions to resolve.`;

        return toolSuccess({ checks, summary });
      },
    });
  }
}
