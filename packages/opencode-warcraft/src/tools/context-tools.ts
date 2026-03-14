import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type {
  AgentsMdService,
  BvTriageService,
  ContextService,
  FeatureService,
  PlanService,
  StaleWorktreeInfo,
  TaskService,
  WorktreeService,
} from 'warcraft-core';
import { computeTrustMetrics } from 'warcraft-core';
import type { BlockedResult } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { resolveFeatureInput, validatePathSegment } from './tool-input.js';

export interface ContextToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  contextService: ContextService;
  agentsMdService: AgentsMdService;
  worktreeService: WorktreeService;
  checkBlocked: (feature: string) => BlockedResult;
  bvTriageService: BvTriageService;
  projectRoot: string;
}

interface StatusResponseData {
  feature: {
    name: string;
    status: string;
    ticket: string | null;
    createdAt: string;
    workflowPath?: string;
    workflowRecommendation?: string;
  };
  plan: {
    exists: boolean;
    status: string;
    approved: boolean;
  };
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    done: number;
    list: StatusBlockedTaskDetail[];
    blockedFeature: StatusBlockedFeatureDetail | null;
    runnable: string[];
    blockedBy: Record<string, string[]>;
    triage: Record<string, { summary: string; source: string }>;
    triageGlobal: { summary: string } | null;
    triageHealth: unknown;
    analytics: {
      provider: string;
      generatedAt: string;
      health: unknown;
      global: unknown;
      blockedTaskInsights: Record<
        string,
        {
          source: string;
          summary: string;
          topBlockers: string[];
          blockerChain: unknown | null;
          causality: unknown | null;
        }
      >;
    };
  };
  context: {
    fileCount: number;
    files: Array<{ name: string; chars: number; updatedAt?: string }>;
  };
  worktreeHygiene: {
    count: number;
    message: string;
    worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
  } | null;
  staleDispatches: Array<{
    folder: string;
    name: string;
    preparedAt: string;
    staleForSeconds: number;
    hint: string;
  }> | null;
  health: {
    reopenRate: number;
    totalCompleted: number;
    reopenCount: number;
    blockedMttrMs: number | null;
  };
  nextAction: string;
}

interface StaleDispatchDetail {
  folder: string;
  name: string;
  preparedAt: string;
  staleForSeconds: number;
  hint: string;
}

interface StatusBlockedTaskDetail {
  folder: string;
  name: string;
  status: string;
  origin: string;
  dependsOn: string[] | null;
  workspace:
    | {
        mode: 'direct';
        path: string | null;
        hasChanges: null;
      }
    | {
        mode: 'worktree';
        path: string;
        branch: string;
        hasChanges: boolean | null;
      }
    | null;
}

interface StatusBlockedFeatureDetail {
  feature: string;
  reason: string | null;
  blockedPath: string | null;
  tasks: StatusBlockedTaskDetail[];
}

/**
 * Context domain tools - Write context, get status, manage AGENTS.md
 */
export class ContextTools {
  constructor(private readonly deps: ContextToolsDependencies) {}

  private static async buildTaskSummary(
    deps: ContextToolsDependencies,
    featureName: string,
    task: { folder: string; name: string; status: string; origin?: string },
  ): Promise<StatusBlockedTaskDetail> {
    const { taskService, worktreeService } = deps;
    const rawStatus = taskService.getRawStatus(featureName, task.folder);
    const workspaceMode = rawStatus?.workerSession?.workspaceMode ?? 'worktree';
    const directWorkspacePath = rawStatus?.workerSession?.workspacePath;
    let worktree = null;
    let hasChanges: boolean | null = null;

    if (workspaceMode === 'worktree') {
      try {
        worktree = await worktreeService.get(featureName, task.folder);
        if (worktree) {
          hasChanges = await worktreeService.hasUncommittedChanges(worktree.feature, worktree.step);
        }
      } catch {
        worktree = null;
        hasChanges = null;
      }
    }

    return {
      folder: task.folder,
      name: task.name,
      status: task.status,
      origin: task.origin || 'plan',
      dependsOn: rawStatus?.dependsOn ?? null,
      workspace:
        workspaceMode === 'direct'
          ? { mode: 'direct', path: directWorkspacePath || null, hasChanges: null }
          : worktree?.branch
            ? { mode: 'worktree', path: worktree.path, branch: worktree.branch, hasChanges }
            : null,
    };
  }

  private static async buildBlockedFeatureDetail(
    deps: ContextToolsDependencies,
    featureName: string,
    blockedResult: BlockedResult,
    tasks: Array<{ folder: string; name: string; status: string; origin?: string }>,
  ): Promise<StatusBlockedFeatureDetail> {
    const blockedTasks = tasks.filter((task) => task.status === 'blocked');
    const taskDetails = await Promise.all(
      blockedTasks.map((task) => ContextTools.buildTaskSummary(deps, featureName, task)),
    );

    return {
      feature: featureName,
      reason: blockedResult.reason ?? blockedResult.message ?? null,
      blockedPath: blockedResult.blockedPath ?? null,
      tasks: taskDetails,
    };
  }

  private static async buildStatusResponseData(
    deps: ContextToolsDependencies,
    featureData: { name: string; status: string; ticket?: string | null; createdAt: string },
    blockedResult: BlockedResult,
  ): Promise<StatusResponseData> {
    const { planService, taskService, contextService, worktreeService, bvTriageService, projectRoot } = deps;
    const featureName = featureData.name;
    const plan = planService.read(featureName);
    const tasks = taskService.list(featureName);
    const blockedFeature = blockedResult.blocked
      ? await ContextTools.buildBlockedFeatureDetail(deps, featureName, blockedResult, tasks)
      : null;
    const contextFiles = contextService.list(featureName);

    const tasksSummary = await Promise.all(
      tasks.map((task: { folder: string; name: string; status: string; origin?: string }) =>
        ContextTools.buildTaskSummary(deps, featureName, task),
      ),
    );

    const contextSummary = contextFiles.map((c: { name: string; content: string; updatedAt?: string }) => ({
      name: c.name,
      chars: c.content.length,
      updatedAt: c.updatedAt,
    }));

    const pendingTasks = tasksSummary.filter((t: { status: string }) => t.status === 'pending');
    const inProgressTasks = tasksSummary.filter(
      (t: { status: string }) => t.status === 'in_progress' || t.status === 'dispatch_prepared',
    );
    const doneTasks = tasksSummary.filter((t: { status: string }) => t.status === 'done');

    let staleWarning: {
      count: number;
      message: string;
      worktrees: Array<{ feature: string; step: string; path: string; ageInDays?: number }>;
    } | null = null;
    try {
      const allWorktrees = await worktreeService.listAll(featureName);
      const staleWorktrees = allWorktrees.filter((wt: StaleWorktreeInfo) => wt.isStale);
      staleWarning =
        staleWorktrees.length > 0
          ? (() => {
              const worktreesWithAge = staleWorktrees.map((wt: StaleWorktreeInfo) => {
                const entry: { feature: string; step: string; path: string; ageInDays?: number } = {
                  feature: wt.feature,
                  step: wt.step,
                  path: wt.path,
                };
                if (wt.lastCommitAge != null && Number.isFinite(wt.lastCommitAge)) {
                  entry.ageInDays = Math.floor(wt.lastCommitAge / 86_400_000);
                }
                return entry;
              });
              const ages = worktreesWithAge.map((w) => w.ageInDays).filter((a): a is number => a != null);
              const oldestAge = ages.length > 0 ? Math.max(...ages) : null;
              const agePart = oldestAge != null ? ` (oldest: ${oldestAge} day${oldestAge === 1 ? '' : 's'})` : '';
              const message =
                `${staleWorktrees.length} stale worktree(s) detected${agePart}. ` +
                'Run warcraft_worktree_prune to review and clean up, ' +
                'or use warcraft_merge with cleanup: true to merge and remove.';
              return {
                count: staleWorktrees.length,
                message,
                worktrees: worktreesWithAge,
              };
            })()
          : null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      staleWarning = {
        count: 0,
        message: `Failed to inspect worktrees: ${reason}`,
        worktrees: [],
      };
    }

    const STALE_DISPATCH_THRESHOLD_MS = 60_000;
    const now = Date.now();
    const staleDispatchEntries: StaleDispatchDetail[] = tasksSummary
      .filter((t: { status: string; folder: string }) => t.status === 'dispatch_prepared')
      .flatMap((t: { folder: string; name: string }) => {
        const raw = taskService.getRawStatus(featureName, t.folder);
        const preparedAt = raw?.preparedAt;
        if (!preparedAt) return [];
        const elapsed = now - new Date(preparedAt).getTime();
        if (elapsed <= STALE_DISPATCH_THRESHOLD_MS) return [];
        return [
          {
            folder: t.folder,
            name: t.name,
            preparedAt,
            staleForSeconds: Math.floor(elapsed / 1_000),
            hint:
              `Task ${t.folder} has been in dispatch_prepared for >60s. ` +
              'Worker may have failed to start. Consider: retry dispatch or reset to pending.',
          },
        ];
      });
    const staleDispatches = staleDispatchEntries.length > 0 ? staleDispatchEntries : null;

    const { runnable, blocked: blockedBy } = taskService.computeRunnableStatus(featureName);
    const triageByTask: Record<string, { summary: string; source: string }> = {};
    const triageDetailsByTask: Record<
      string,
      {
        source: string;
        summary: string;
        topBlockers: string[];
        blockerChain: unknown | null;
        causality: unknown | null;
      }
    > = {};
    for (const taskFolder of Object.keys(blockedBy)) {
      const raw = taskService.getRawStatus(featureName, taskFolder);
      if (!raw?.beadId) {
        continue;
      }
      const triage = bvTriageService.getBlockerTriageDetails(raw.beadId);
      if (triage !== null) {
        triageByTask[taskFolder] = {
          source: 'bv',
          summary: triage.summary,
        };
        triageDetailsByTask[taskFolder] = {
          source: 'bv',
          summary: triage.summary,
          topBlockers: triage.topBlockers,
          blockerChain: triage.blockerChain,
          causality: triage.causality,
        };
      }
    }
    const globalTriageDetails = bvTriageService.getGlobalTriageDetails();
    const globalTriage = globalTriageDetails ? { summary: globalTriageDetails.summary } : null;
    const triageHealth = bvTriageService.getHealth();
    const analyticsProvider = triageHealth.enabled ? (triageHealth.available ? 'bv' : 'unavailable') : 'disabled';

    const getNextAction = (
      planStatus: string | null,
      taskList: Array<{ status: string; folder: string }>,
      runnableTasks: string[],
      workflowPath?: string,
      workflowRecommendation?: string,
    ): string => {
      if (taskList.length === 0) {
        if (workflowPath === 'instant' || workflowRecommendation === 'instant') {
          return 'Create a direct task with warcraft_task_create, include a self-contained description, then dispatch it with warcraft_worktree_create.';
        }
        if (workflowRecommendation === 'lightweight') {
          return 'Write a short lightweight plan with warcraft_plan_write (include Workflow Path: lightweight), then approve it.';
        }
        if (!planStatus || planStatus === 'draft') {
          return 'Write or revise plan with warcraft_plan_write, then get approval';
        }
        return 'Generate tasks from plan with warcraft_tasks_sync';
      }
      const inProgress = taskList.find((t) => t.status === 'in_progress' || t.status === 'dispatch_prepared');
      if (inProgress) {
        return `Continue work on task: ${inProgress.folder}`;
      }
      const pendingCount = taskList.filter((t) => t.status === 'pending').length;
      if ((planStatus === 'instant' || planStatus === 'none' || !planStatus) && pendingCount > 0) {
        if (workflowRecommendation === 'standard' || pendingCount > 2) {
          return pendingCount > 2
            ? 'This instant workflow now has more than two pending tasks, so the lightweight path is no longer a good fit. Write or revise plan with warcraft_plan_write, then get approval before dispatching more work.'
            : 'This task looks broad enough for the standard reviewed path. Write or revise plan with warcraft_plan_write, then get approval before dispatching work.';
        }
        if ((workflowPath === 'instant' || workflowRecommendation === 'instant') && pendingCount > 1) {
          return 'This instant workflow now has multiple pending tasks and has likely outgrown the tiny-task path. Write a short lightweight plan with warcraft_plan_write (include Workflow Path: lightweight), then approve it before dispatching more work.';
        }
        if (workflowRecommendation === 'lightweight') {
          return 'This task no longer looks tiny enough for direct execution. Write a short lightweight plan with warcraft_plan_write (include Workflow Path: lightweight), then approve it before dispatching work.';
        }
      }
      if (runnableTasks.length > 1) {
        return `${runnableTasks.length} tasks are ready in parallel. Use warcraft_batch_execute preview/execute, then issue all returned task() calls in the same assistant message: ${runnableTasks.join(', ')}`;
      }
      if (runnableTasks.length === 1) {
        return `Start next task with warcraft_worktree_create, then issue the returned task() call: ${runnableTasks[0]}`;
      }
      const pending = taskList.find((t) => t.status === 'pending');
      if (pending) {
        return 'Pending tasks exist but are blocked by dependencies. Check blockedBy for details.';
      }
      const nonTerminal = taskList.filter(
        (t) => t.status === 'failed' || t.status === 'partial' || t.status === 'cancelled' || t.status === 'blocked',
      );
      if (nonTerminal.length > 0) {
        const summary = nonTerminal.map((t) => `${t.folder} (${t.status})`).join(', ');
        return `Tasks need attention: ${summary}. Re-dispatch failed/partial tasks or resolve blocked tasks before completing.`;
      }
      if (!planStatus || planStatus === 'draft') {
        return workflowPath === 'instant' || workflowRecommendation === 'instant'
          ? 'All instant-workflow tasks are complete. Review, merge, or complete the feature.'
          : workflowRecommendation === 'lightweight'
            ? 'Write a short lightweight plan with warcraft_plan_write (include Workflow Path: lightweight), then approve it.'
            : 'Write or revise plan with warcraft_plan_write, then get approval';
      }
      return 'All tasks complete. Review and merge or complete feature.';
    };

    const workflowPath = featureData.workflowPath || 'standard';
    const workflowRecommendation = featureData.workflowRecommendation;
    const planStatus = plan
      ? featureData.status === 'planning'
        ? 'draft'
        : featureData.status === 'approved'
          ? 'approved'
          : featureData.status === 'executing'
            ? 'locked'
            : 'none'
      : workflowPath === 'instant'
        ? 'instant'
        : 'none';

    let trustMetrics: {
      reopenRate: number;
      totalCompleted: number;
      reopenCount: number;
      blockedMttrMs: number | null;
    };
    try {
      trustMetrics = computeTrustMetrics(projectRoot);
    } catch {
      trustMetrics = { reopenRate: 0, totalCompleted: 0, reopenCount: 0, blockedMttrMs: null };
    }

    return {
      feature: {
        name: featureName,
        status: featureData.status,
        ticket: featureData.ticket || null,
        createdAt: featureData.createdAt,
        workflowPath,
        workflowRecommendation,
      },
      plan: {
        exists: !!plan,
        status: planStatus,
        approved: planStatus === 'approved' || planStatus === 'locked',
      },
      tasks: {
        total: tasks.length,
        pending: pendingTasks.length,
        inProgress: inProgressTasks.length,
        done: doneTasks.length,
        list: tasksSummary,
        blockedFeature,
        runnable,
        blockedBy,
        triage: triageByTask,
        triageGlobal: globalTriage,
        triageHealth,
        analytics: {
          provider: analyticsProvider,
          generatedAt: new Date().toISOString(),
          health: triageHealth,
          global: globalTriageDetails
            ? {
                summary: globalTriageDetails.summary,
                payload: globalTriageDetails.payload,
                dataHash: globalTriageDetails.dataHash ?? null,
                analysisConfig: globalTriageDetails.analysisConfig ?? null,
                metricStatus: globalTriageDetails.metricStatus ?? null,
                asOf: globalTriageDetails.asOf ?? null,
                asOfCommit: globalTriageDetails.asOfCommit ?? null,
              }
            : null,
          blockedTaskInsights: triageDetailsByTask,
        },
      },
      context: {
        fileCount: contextFiles.length,
        files: contextSummary,
      },
      worktreeHygiene: staleWarning,
      staleDispatches,
      health: {
        reopenRate: trustMetrics.reopenRate,
        totalCompleted: trustMetrics.totalCompleted,
        reopenCount: trustMetrics.reopenCount,
        blockedMttrMs: trustMetrics.blockedMttrMs,
      },
      nextAction: getNextAction(planStatus, tasksSummary, runnable, workflowPath, workflowRecommendation),
    };
  }

  /**
   * Write a context file for the feature. Context files store persistent notes, decisions, and reference material.
   */
  writeContextTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { contextService } = this.deps;
    return tool({
      description:
        'Write a context file for the feature. Context files store persistent notes, decisions, and reference material.',
      args: {
        name: tool.schema.string().describe('Context file name (e.g., "decisions", "architecture", "notes")'),
        content: tool.schema.string().describe('Markdown content to write'),
        mode: tool.schema
          .enum(['replace', 'append'])
          .optional()
          .describe('Write mode: replace overwrites the file, append adds a new entry separated by a blank line'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
      },
      async execute({ name, content, mode = 'replace', feature: explicitFeature }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const filePath = contextService.write(feature, name, content, mode);
        return toolSuccess({ message: `Context file written:\n${filePath}` });
      },
    });
  }

  /**
   * Get comprehensive status of a feature including plan, tasks, and context. Returns JSON with all relevant state for resuming work.
   */
  getStatusTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService, checkBlocked } = this.deps;
    const deps = this.deps;
    return tool({
      description:
        'Get comprehensive status of a feature including plan, tasks, and context. Returns JSON with all relevant state for resuming work.',
      args: {
        feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
      },
      async execute({ feature: explicitFeature }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const featureData = featureService.get(feature);
        if (!featureData) {
          return toolError(`Feature '${feature}' not found`);
        }

        const featureName = featureData.name;
        const blockedResult = checkBlocked(featureName);
        const statusData = await ContextTools.buildStatusResponseData(deps, featureData, blockedResult);

        return toolSuccess(statusData);
      },
    });
  }

  /**
   * Initialize or sync AGENTS.md. init: scan codebase and generate (preview only). sync: propose updates from feature contexts. apply: write approved content to disk.
   */
  agentsMdTool(): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { agentsMdService } = this.deps;
    return tool({
      description:
        'Initialize or sync AGENTS.md. init: scan codebase and generate (preview only). sync: propose updates from feature contexts. apply: write approved content to disk.',
      args: {
        action: tool.schema.enum(['init', 'sync', 'apply']).describe('Action to perform'),
        feature: tool.schema.string().optional().describe('Feature name for sync action'),
        content: tool.schema.string().optional().describe('Content to write (required for apply action)'),
      },
      async execute({ action, feature, content }) {
        if (feature) validatePathSegment(feature, 'feature');
        if (action === 'init') {
          const result = await agentsMdService.init();
          if (result.existed) {
            return toolSuccess({
              message:
                `AGENTS.md already exists (${result.content.length} chars). ` +
                "This init action is preview-only and did not modify AGENTS.md. Use 'sync' to propose updates.",
            });
          }
          return toolSuccess({
            message:
              `Generated AGENTS.md preview from codebase scan (${result.content.length} chars):\n\n${result.content}` +
              '\n\n⚠️ This preview did NOT modify AGENTS.md. Ask the user via question() whether to write it to AGENTS.md.',
          });
        }

        if (action === 'sync') {
          if (!feature) return toolError('feature name required for sync action');
          const result = await agentsMdService.sync(feature);
          if (result.proposals.length === 0) {
            return toolSuccess({
              message:
                `No new actionable findings to propose for AGENTS.md from feature "${feature}". ` +
                'Sync is preview-only and did not modify AGENTS.md.',
            });
          }
          return toolSuccess({
            message:
              `Proposed AGENTS.md preview updates from feature "${feature}":\n\n${result.diff}` +
              '\n\n⚠️ This sync action did NOT modify AGENTS.md. Ask the user via question() whether to apply these proposals.',
          });
        }

        if (action === 'apply') {
          if (!content?.trim())
            return toolError(
              'content required for apply action. Use init or sync first to get content, then apply with the approved content.',
            );
          const result = agentsMdService.apply(content);
          return toolSuccess({
            message: `AGENTS.md ${result.isNew ? 'created' : 'updated'} (${result.chars} chars) at ${result.path}`,
          });
        }

        return toolError('unknown action');
      },
    });
  }
}
