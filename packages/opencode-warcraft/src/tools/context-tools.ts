import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type {
  ContextService,
  FeatureService,
  PlanService,
  TaskService,
  WorktreeService,
  AgentsMdService,
} from 'warcraft-core';
import { validatePathSegment } from './index.js';
import {
  buildEffectiveDependencies,
  computeRunnableAndBlocked,
  type TaskWithDeps,
} from 'warcraft-core';
import type { BvTriageService } from '../services/bv-triage-service.js';

export interface ContextToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  contextService: ContextService;
  agentsMdService: AgentsMdService;
  worktreeService: WorktreeService;
  checkBlocked: (feature: string) => string | null;
  bvTriageService: BvTriageService;
}

/**
 * Context domain tools - Write context, get status, manage AGENTS.md
 */
export class ContextTools {
  constructor(private readonly deps: ContextToolsDependencies) {}

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
        name: tool.schema
          .string()
          .describe(
            'Context file name (e.g., "decisions", "architecture", "notes")',
          ),
        content: tool.schema.string().describe('Markdown content to write'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to active)'),
      },
      async execute({ name, content, feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';

        const filePath = contextService.write(feature, name, content);
        return `Context file written: ${filePath}`;
      },
    });
  }

  /**
   * Get comprehensive status of a feature including plan, tasks, and context. Returns JSON with all relevant state for resuming work.
   */
  getStatusTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService, planService, taskService, contextService, worktreeService, checkBlocked, bvTriageService } = this.deps;
    return tool({
      description:
        'Get comprehensive status of a feature including plan, tasks, and context. Returns JSON with all relevant state for resuming work.',
      args: {
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to active)'),
      },
      async execute({ feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature) {
          return JSON.stringify({
            error: 'No feature specified and no active feature found',
            hint: 'Use warcraft_feature_create to create a new feature',
          });
        }

        const featureData = featureService.get(feature);
        if (!featureData) {
          return JSON.stringify({
            error: `Feature '${feature}' not found`,
            availableFeatures: featureService.list(),
          });
        }

        const blocked = checkBlocked(feature);
        if (blocked) return blocked;

        const plan = planService.read(feature);
        const tasks = taskService.list(feature);
        const contextFiles = contextService.list(feature);

        const tasksSummary = await Promise.all(
          tasks.map(async (t: { folder: string; name: string; status: string; origin?: string }) => {
            const rawStatus = taskService.getRawStatus(feature, t.folder);
            const worktree = await worktreeService.get(feature, t.folder);
            const hasChanges = worktree
              ? await worktreeService.hasUncommittedChanges(
                  worktree.feature,
                  worktree.step,
                )
              : null;

            return {
              folder: t.folder,
              name: t.name,
              status: t.status,
              origin: t.origin || 'plan',
              dependsOn: rawStatus?.dependsOn ?? null,
              worktree: worktree
                ? {
                    branch: worktree.branch,
                    hasChanges,
                  }
                : null,
            };
          }),
        );

        const contextSummary = contextFiles.map((c: { name: string; content: string; updatedAt?: string }) => ({
          name: c.name,
          chars: c.content.length,
          updatedAt: c.updatedAt,
        }));

        const pendingTasks = tasksSummary.filter(
          (t: { status: string }) => t.status === 'pending',
        );
        const inProgressTasks = tasksSummary.filter(
          (t: { status: string }) => t.status === 'in_progress',
        );
        const doneTasks = tasksSummary.filter(
          (t: { status: string }) => t.status === 'done',
        );

        const tasksWithDeps: TaskWithDeps[] = tasksSummary.map((t: { folder: string; status: string; dependsOn?: string[] | null }) => ({
          folder: t.folder,
          status: t.status as import('warcraft-core').TaskStatusType,
          dependsOn: t.dependsOn ?? undefined,
        }));
        const effectiveDeps = buildEffectiveDependencies(tasksWithDeps);
        const normalizedTasks = tasksWithDeps.map((task) => ({
          ...task,
          dependsOn: effectiveDeps.get(task.folder),
        }));
        const { runnable, blocked: blockedBy } =
          computeRunnableAndBlocked(normalizedTasks);
        const triageByTask: Record<string, { summary: string; source: string }> = {};
        const triageDetailsByTask: Record<string, {
          source: string;
          summary: string;
          topBlockers: string[];
          blockerChain: unknown | null;
          causality: unknown | null;
        }> = {};
        for (const taskFolder of Object.keys(blockedBy)) {
          const raw = taskService.getRawStatus(feature, taskFolder);
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
        const globalTriage = globalTriageDetails
          ? { summary: globalTriageDetails.summary }
          : null;
        const triageHealth = bvTriageService.getHealth();
        const analyticsProvider = triageHealth.enabled
          ? triageHealth.available
            ? 'bv'
            : 'unavailable'
          : 'disabled';

        const getNextAction = (
          planStatus: string | null,
          tasks: Array<{ status: string; folder: string }>,
          runnableTasks: string[],
        ): string => {
          if (!planStatus || planStatus === 'draft') {
            return 'Write or revise plan with warcraft_plan_write, then get approval';
          }
          if (planStatus === 'review') {
            return 'Wait for plan approval or revise based on comments';
          }
          if (tasks.length === 0) {
            return 'Generate tasks from plan with warcraft_tasks_sync';
          }
          const inProgress = tasks.find((t) => t.status === 'in_progress');
          if (inProgress) {
            return `Continue work on task: ${inProgress.folder}`;
          }
          if (runnableTasks.length > 1) {
            return `${runnableTasks.length} tasks are ready to start in parallel: ${runnableTasks.join(', ')}`;
          }
          if (runnableTasks.length === 1) {
            return `Start next task with warcraft_worktree_create: ${runnableTasks[0]}`;
          }
          const pending = tasks.find((t) => t.status === 'pending');
          if (pending) {
            return `Pending tasks exist but are blocked by dependencies. Check blockedBy for details.`;
          }
          return 'All tasks complete. Review and merge or complete feature.';
        };

        const planStatus =
          featureData.status === 'planning'
            ? 'draft'
            : featureData.status === 'approved'
              ? 'approved'
              : featureData.status === 'executing'
                ? 'locked'
                : 'none';

        return JSON.stringify({
          feature: {
            name: feature,
            status: featureData.status,
            ticket: featureData.ticket || null,
            createdAt: featureData.createdAt,
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
          nextAction: getNextAction(planStatus, tasksSummary, runnable),
        });
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
        "Initialize or sync AGENTS.md. init: scan codebase and generate (preview only). sync: propose updates from feature contexts. apply: write approved content to disk.",
      args: {
        action: tool.schema
          .enum(['init', 'sync', 'apply'])
          .describe('Action to perform'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name for sync action'),
        content: tool.schema
          .string()
          .optional()
          .describe('Content to write (required for apply action)'),
      },
      async execute({ action, feature, content }) {
        if (feature) validatePathSegment(feature, 'feature');
        if (action === 'init') {
          const result = await agentsMdService.init();
          if (result.existed) {
            return `AGENTS.md already exists (${result.content.length} chars). Use 'sync' to propose updates.`;
          }
          return `Generated AGENTS.md from codebase scan (${result.content.length} chars):\n\n${result.content}\n\n⚠️ This has NOT been written to disk. Ask the user via question() whether to write it to AGENTS.md.`;
        }

        if (action === 'sync') {
          if (!feature) return 'Error: feature name required for sync action';
          const result = await agentsMdService.sync(feature);
          if (result.proposals.length === 0) {
            return 'No new findings to sync to AGENTS.md.';
          }
          return `Proposed AGENTS.md updates from feature "${feature}":\n\n${result.diff}\n\n⚠️ These changes have NOT been applied. Ask the user via question() whether to apply them.`;
        }

        if (action === 'apply') {
          if (!content)
            return 'Error: content required for apply action. Use init or sync first to get content, then apply with the approved content.';
          const result = agentsMdService.apply(content);
          return `AGENTS.md ${result.isNew ? 'created' : 'updated'} (${result.chars} chars) at ${result.path}`;
        }

        return 'Error: unknown action';
      },
    });
  }
}
