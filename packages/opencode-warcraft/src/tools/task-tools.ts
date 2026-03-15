import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { EventLogger, FeatureService, PlanService, TaskService, TaskStatusType } from 'warcraft-core';
import {
  analyzeWorkflowRequest,
  createChildSpan,
  createTraceContext,
  detectWorkflowPath,
  InvalidTransitionError,
  validateDiscoverySection,
  validateLightweightPlan,
} from 'warcraft-core';
import { toolError, toolSuccess } from '../types.js';
import { appendTasksToPlanScaffold, buildPlanScaffold } from './manual-plan-scaffold.js';
import {
  buildApprovedPlanSyncFlow,
  buildDraftPlanPromotionFlow,
  buildPendingManualPromotionFlow,
} from './promotion-flow.js';
import { resolveFeatureInput, validateTaskInput } from './tool-input.js';

export interface TaskToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  workflowGatesMode: 'enforce' | 'warn';
  validateTaskStatus: (status: string) => TaskStatusType;
  eventLogger: EventLogger;
}

/**
 * Task domain tools - Sync, create, and update tasks
 */
function buildTaskWorkflowAnalysisInput(name: string, description?: string): string {
  if (!description?.trim()) return name;

  const condensed = description
    .replace(/\r\n/g, '\n')
    .split(/\b(?:Safety|Verify|Rollback)\s*:/i)[0]
    .replace(/\b(?:Background|Impact|Reasoning|Scope)\s*:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${name}. ${condensed}`.trim();
}

export class TaskTools {
  constructor(private readonly deps: TaskToolsDependencies) {}

  /**
   * Generate tasks from approved plan
   */
  syncTasksTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService, planService, taskService, workflowGatesMode } = this.deps;
    return tool({
      description: 'Generate tasks from approved plan',
      args: {
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        mode: tool.schema
          .enum(['sync', 'preview'])
          .optional()
          .describe('preview: show what would change. sync (default): apply changes.'),
      },
      async execute({ feature: explicitFeature, mode }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        const featureData = featureService.get(feature);
        if (!featureData) {
          return toolError('Feature not found');
        }

        const planResult = planService.read(feature);
        if (!planResult) {
          const pendingManualTasks = taskService
            .list(feature)
            .filter((task) => task.origin === 'manual' && task.status === 'pending')
            .map((task) => task.folder);
          if (pendingManualTasks.length > 0) {
            const taskExpandArgs = {
              feature,
              tasks: pendingManualTasks,
              mode:
                featureData.workflowRecommendation === 'standard' || pendingManualTasks.length > 2
                  ? ('standard' as const)
                  : ('lightweight' as const),
            };
            return toolError(
              'No plan.md found. Pending manual tasks must be promoted into a reviewed plan before they can be synced.',
              [
                `Promote the pending manual tasks with warcraft_task_expand using ${JSON.stringify(taskExpandArgs)}.`,
                'Then review the draft, run warcraft_plan_approve, and retry warcraft_tasks_sync.',
              ],
              {
                data: {
                  blockedReason: 'plan_missing_for_sync',
                  pendingManualTasks,
                  taskExpandArgs,
                  planApproveArgs: { feature },
                  taskSyncArgs: { feature, mode: 'sync' as const },
                  promotionFlow: buildPendingManualPromotionFlow(
                    taskExpandArgs,
                    { feature },
                    { feature, mode: 'sync' },
                  ),
                },
                warnings: [
                  {
                    type: 'plan_missing_for_sync',
                    severity: 'error',
                    message:
                      'Tasks can only be synced after pending manual work has been promoted into a reviewed plan.',
                    count: pendingManualTasks.length,
                  },
                ],
              },
            );
          }
          return toolError('No plan.md found');
        }

        if (planResult.status !== 'approved') {
          const planApproveArgs = { feature };
          return toolError(
            'Plan must be approved first',
            [
              'Review the draft plan and complete any required checklist items.',
              `Then run warcraft_plan_approve with ${JSON.stringify(planApproveArgs)} before retrying warcraft_tasks_sync.`,
            ],
            {
              data: {
                blockedReason: 'plan_not_approved',
                planStatus: planResult.status,
                planApproveArgs,
                taskSyncArgs: { feature, mode: 'sync' as const },
                promotionFlow: buildDraftPlanPromotionFlow(planApproveArgs, { feature, mode: 'sync' }),
              },
              warnings: [
                {
                  type: 'plan_not_approved',
                  severity: 'error',
                  message: 'Tasks can only be synced from an approved plan.',
                },
              ],
            },
          );
        }

        if (mode === 'preview') {
          const preview = taskService.previewSync(feature);
          return toolSuccess({
            mode: 'preview',
            feature,
            wouldCreate: preview.created,
            wouldRemove: preview.removed,
            wouldKeep: preview.kept,
            wouldReconcile: preview.reconciled,
            manualTasks: preview.manual,
            message: `Preview: Would create ${preview.created.length}, remove ${preview.removed.length}, reconcile ${preview.reconciled.length}, keep ${preview.kept.length} task(s). Use mode "sync" to apply.`,
          });
        }

        let warning = '';
        const workflowPath = detectWorkflowPath(planResult.content);
        if (workflowPath === 'lightweight') {
          const lightweightIssues = validateLightweightPlan(planResult.content);
          if (lightweightIssues.length > 0) {
            const issueBlock = lightweightIssues.map((issue) => `- ${issue}`).join('\n');
            const message = `Lightweight workflow requirements are not satisfied:\n${issueBlock}`;
            if (workflowGatesMode === 'enforce') {
              const planWriteArgs = { feature, content: planResult.content };
              return toolError(
                message,
                [
                  `Revise the lightweight plan with warcraft_plan_write using ${JSON.stringify(planWriteArgs)}.`,
                  'After fixing or broadening the draft, re-approve it and retry warcraft_tasks_sync.',
                ],
                {
                  data: {
                    blockedReason: 'lightweight_plan_invalid_for_sync',
                    validationIssues: lightweightIssues,
                    planWriteArgs,
                    planApproveArgs: { feature },
                    taskSyncArgs: { feature, mode: 'sync' as const },
                    promotionFlow: buildDraftPlanPromotionFlow({ feature }, { feature, mode: 'sync' }),
                  },
                  warnings: [
                    {
                      type: 'lightweight_plan_invalid_for_sync',
                      severity: 'error',
                      message: 'The approved lightweight plan no longer satisfies lightweight workflow guardrails.',
                      count: lightweightIssues.length,
                    },
                  ],
                },
              );
            }
            warning = `\nWarning (mode=${workflowGatesMode}): ${message}`;
          }
        }

        const result = taskService.sync(feature);
        if (featureData.status === 'approved') {
          featureService.updateStatus(feature, 'executing');
        }
        return toolSuccess({
          mode: 'sync',
          feature,
          created: result.created,
          removed: result.removed,
          kept: result.kept,
          reconciled: result.reconciled,
          manualTasks: result.manual,
          diagnostics: result.diagnostics ?? [],
          message: `Tasks synced: ${result.created.length} created, ${result.removed.length} removed, ${result.reconciled.length} reconciled, ${result.kept.length} kept${warning}`,
        });
      },
    });
  }

  /**
   * Create manual task (not from plan)
   */
  createTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService, planService, taskService } = this.deps;
    return tool({
      description: 'Create manual task (not from plan)',
      args: {
        name: tool.schema.string().describe('Task name'),
        description: tool.schema
          .string()
          .optional()
          .describe(
            'Self-contained execution brief for instant/manual work. Include background, scope, safety, verification, and rollback notes when skipping a formal plan.',
          ),
        order: tool.schema.number().optional().describe('Task order'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        priority: tool.schema.number().optional().describe('Priority (1-5, default: 3)'),
      },
      async execute({ name, description, order, feature: explicitFeature, priority }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        const priorityValue = priority ?? 3;
        if (!Number.isInteger(priorityValue) || priorityValue < 1 || priorityValue > 5) {
          return toolError(`Priority must be an integer between 1 and 5 (inclusive), got: ${priorityValue}`);
        }
        const folder = taskService.create(feature, name, order, priorityValue, description);

        const featureData = featureService.get(feature);
        const hasPlan = planService.read(feature) !== null;
        const workflowAnalysis =
          !hasPlan && description?.trim()
            ? analyzeWorkflowRequest(buildTaskWorkflowAnalysisInput(name, description))
            : null;

        const pendingManualTasks = !hasPlan
          ? taskService
              .list(feature)
              .filter((task) => task.origin === 'manual' && task.status === 'pending')
              .map((task) => task.folder)
          : [];
        const expansionRecommendation =
          pendingManualTasks.length > 2 ? 'standard' : pendingManualTasks.length > 1 ? 'lightweight' : null;
        const effectiveWorkflowRecommendation = expansionRecommendation ?? workflowAnalysis?.workflowPath;

        let instantWorkflowActivated = false;
        if (featureData && !hasPlan) {
          featureService.patchMetadata(feature, {
            workflowPath: 'instant',
            ...(effectiveWorkflowRecommendation && effectiveWorkflowRecommendation !== 'instant'
              ? { workflowRecommendation: effectiveWorkflowRecommendation }
              : {}),
          });
          if (featureData.status !== 'executing') {
            featureService.updateStatus(feature, 'executing');
          }
          instantWorkflowActivated = true;
        }

        const planScaffoldMode: 'lightweight' | 'standard' | null =
          effectiveWorkflowRecommendation === 'standard'
            ? 'standard'
            : effectiveWorkflowRecommendation === 'lightweight'
              ? 'lightweight'
              : null;
        const planScaffoldTasks = !hasPlan
          ? taskService
              .list(feature)
              .filter((task) => task.origin === 'manual' && task.status === 'pending')
              .map((task) => {
                const rawStatus = taskService.getRawStatus(feature, task.folder);
                return {
                  folder: task.folder,
                  name: rawStatus?.planTitle ?? task.name,
                  brief: rawStatus?.brief ?? null,
                };
              })
          : [];
        const planScaffold =
          planScaffoldMode && planScaffoldTasks.length > 0
            ? buildPlanScaffold(feature, planScaffoldMode, planScaffoldTasks)
            : null;
        const taskExpandArgs =
          planScaffoldMode && pendingManualTasks.length > 0
            ? { feature, tasks: pendingManualTasks, mode: planScaffoldMode }
            : null;
        const promotionFlow = taskExpandArgs
          ? buildPendingManualPromotionFlow(taskExpandArgs, { feature }, { feature, mode: 'sync' })
          : null;
        const recommendationWarning =
          expansionRecommendation === 'standard'
            ? '\nThis feature now has more than two pending manual tasks, so the lightweight path is no longer a good fit. Prefer the standard reviewed plan path with warcraft_plan_write before dispatching more work.'
            : expansionRecommendation === 'lightweight'
              ? '\nThis feature now has multiple pending manual tasks and has likely outgrown the tiny-task path. Prefer warcraft_plan_write with Workflow Path: lightweight before dispatching more work.'
              : effectiveWorkflowRecommendation === 'lightweight'
                ? '\nThis manual task looks a bit larger than the tiny instant path. Prefer warcraft_plan_write with Workflow Path: lightweight before dispatching it.'
                : effectiveWorkflowRecommendation === 'standard'
                  ? '\nThis manual task looks broad enough that the standard reviewed plan path is safer. Prefer warcraft_plan_write before dispatching it.'
                  : '';
        const scaffoldHint = planScaffold
          ? '\nA draft reviewed-plan scaffold is included in `planScaffold`. You can materialize and preview promotion directly with warcraft_task_expand, or write it with warcraft_plan_write({ useScaffold: true }).'
          : '';

        return toolSuccess({
          feature,
          task: folder,
          workflowPath: instantWorkflowActivated ? 'instant' : (featureData?.workflowPath ?? 'standard'),
          workflowRecommendation: effectiveWorkflowRecommendation,
          workflowRationale: workflowAnalysis?.rationale ?? [],
          pendingManualTasks,
          planScaffold,
          planWriteArgs: planScaffold ? { feature, content: planScaffold } : null,
          taskExpandArgs,
          promotionFlow,
          message: instantWorkflowActivated
            ? `Manual task created: ${folder}\nInstant workflow activated for feature "${feature}" (no formal plan required for this small task). Include enough detail in the task description to make it self-contained, then call warcraft_worktree_create and issue the returned task() call.${recommendationWarning}${scaffoldHint}`
            : `Manual task created: ${folder}\nReminder: call warcraft_worktree_create to prepare the task workspace, then issue the returned task() call to start the worker in the assigned workspace.${recommendationWarning}${scaffoldHint}`,
        });
      },
    });
  }

  /**
   * Expand pending manual tasks into a reviewed plan and preview sync impact
   */
  expandTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    const { featureService, planService, taskService } = this.deps;
    return tool({
      description: 'Expand pending manual tasks into a reviewed plan and preview sync impact',
      args: {
        tasks: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Optional manual task folders to promote. Defaults to all pending manual tasks.'),
        mode: tool.schema
          .enum(['auto', 'lightweight', 'standard'])
          .optional()
          .describe('Target plan mode. auto (default) chooses lightweight vs standard from task count/recommendation.'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ tasks, mode, feature: explicitFeature }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const existingPlan = planService.read(feature);
        const pendingManualTasks = taskService
          .list(feature)
          .filter((task) => task.origin === 'manual' && task.status === 'pending');
        if (existingPlan && existingPlan.status !== 'planning') {
          const availableManualTasks = pendingManualTasks.map((task) => task.folder);
          if (availableManualTasks.length === 0) {
            return toolError(
              'No pending manual tasks are available to expand. The reviewed plan is already approved.',
              [
                'There is no remaining manual work to merge into the plan right now.',
                `Continue with warcraft_tasks_sync using ${JSON.stringify({ feature, mode: 'sync' })}.`,
              ],
              {
                data: {
                  blockedReason: 'approved_plan_has_no_pending_manual_tasks_to_expand',
                  taskSyncArgs: { feature, mode: 'sync' as const },
                  promotionFlow: buildApprovedPlanSyncFlow({ feature, mode: 'sync' }),
                },
                warnings: [
                  {
                    type: 'approved_plan_has_no_pending_manual_tasks_to_expand',
                    severity: 'info',
                    message: 'The approved plan has no remaining manual tasks to merge.',
                  },
                ],
              },
            );
          }
          const planWriteArgs = { feature, content: existingPlan.content };
          const retryTaskExpandArgs =
            mode && mode !== 'auto'
              ? { feature, tasks: availableManualTasks, mode }
              : { feature, tasks: availableManualTasks };
          return toolError(
            'Only draft plans can be expanded. Use warcraft_plan_write to revise an approved/executing plan directly.',
            [
              `Revise the existing plan with warcraft_plan_write using ${JSON.stringify(planWriteArgs)}.`,
              `After the plan is back in draft form, retry warcraft_task_expand with ${JSON.stringify(retryTaskExpandArgs)}.`,
            ],
            {
              data: {
                blockedReason: 'existing_plan_not_draft',
                currentPlanStatus: existingPlan.status,
                planWriteArgs,
                retryTaskExpandArgs,
              },
              warnings: [
                {
                  type: 'existing_plan_not_draft',
                  severity: 'error',
                  message: 'Manual-task expansion only works against draft plans.',
                  count: availableManualTasks.length,
                },
              ],
            },
          );
        }
        if (pendingManualTasks.length === 0) {
          if (existingPlan?.status === 'planning') {
            return toolError(
              'No pending manual tasks are available to expand.',
              [
                'The draft plan already covers the pending manual work that can be promoted right now.',
                'Review the draft and continue with warcraft_plan_approve when it is ready.',
              ],
              {
                data: {
                  blockedReason: 'no_pending_manual_tasks_to_expand',
                  planApproveArgs: { feature },
                  taskSyncArgs: { feature, mode: 'sync' as const },
                  promotionFlow: buildDraftPlanPromotionFlow({ feature }, { feature, mode: 'sync' }),
                },
                warnings: [
                  {
                    type: 'no_pending_manual_tasks_to_expand',
                    severity: 'info',
                    message: 'There are no pending manual tasks left to merge into the current draft plan.',
                  },
                ],
              },
            );
          }
          return toolError('No pending manual tasks are available to expand.');
        }

        const availableManualTasks = pendingManualTasks.map((task) => task.folder);
        const requestedTasks = tasks?.length ? tasks : availableManualTasks;
        for (const taskFolder of requestedTasks) {
          validateTaskInput(taskFolder);
        }

        const selectedTasks = [] as Array<{ folder: string; name: string; brief: string | null }>;
        for (const taskFolder of requestedTasks) {
          const task = pendingManualTasks.find((item) => item.folder === taskFolder);
          if (!task) {
            const retryTaskExpandArgs =
              mode && mode !== 'auto'
                ? { feature, tasks: availableManualTasks, mode }
                : { feature, tasks: availableManualTasks };
            return toolError(
              `Task '${taskFolder}' is not a pending manual task for feature '${feature}'.`,
              [
                availableManualTasks.length > 0
                  ? `Available pending manual tasks: ${availableManualTasks.join(', ')}.`
                  : 'There are no pending manual tasks available to expand.',
                availableManualTasks.length > 0
                  ? `Retry warcraft_task_expand with ${JSON.stringify(retryTaskExpandArgs)}.`
                  : 'Create or restore pending manual tasks before retrying warcraft_task_expand.',
              ],
              {
                data: {
                  blockedReason: 'manual_task_selection_invalid',
                  requestedTask: taskFolder,
                  availableManualTasks,
                  retryTaskExpandArgs,
                },
                warnings: [
                  {
                    type: 'manual_task_selection_invalid',
                    severity: 'error',
                    message: "The requested manual task selection does not match the feature's pending manual tasks.",
                    affected: taskFolder,
                    count: 1,
                  },
                ],
              },
            );
          }
          const rawStatus = taskService.getRawStatus(feature, task.folder);
          selectedTasks.push({
            folder: task.folder,
            name: rawStatus?.planTitle ?? task.name,
            brief: rawStatus?.brief ?? null,
          });
        }

        const featureData = featureService.get(feature);
        const selectedMode = mode && mode !== 'auto' ? mode : null;
        const existingWorkflowPath = existingPlan ? detectWorkflowPath(existingPlan.content) : null;
        const planScaffoldMode =
          selectedMode ??
          existingWorkflowPath ??
          (featureData?.workflowRecommendation === 'standard' || selectedTasks.length > 2 ? 'standard' : 'lightweight');
        const planScaffold = existingPlan
          ? appendTasksToPlanScaffold(existingPlan.content, selectedTasks)
          : buildPlanScaffold(feature, planScaffoldMode, selectedTasks);
        if (!planScaffold) {
          if (existingPlan) {
            const repairPlanWriteArgs = {
              feature,
              content: `${existingPlan.content.trimEnd()}\n\n## Tasks\n`,
            };
            const retryTaskExpandArgs = {
              feature,
              tasks: selectedTasks.map((task) => task.folder),
              mode: planScaffoldMode,
            };
            return toolError(
              'Failed to merge the selected manual tasks into the existing draft plan. Ensure the plan still contains a ## Tasks section.',
              [
                `Repair the draft with warcraft_plan_write using ${JSON.stringify(repairPlanWriteArgs)} so the plan contains a \`## Tasks\` section.`,
                `Then retry warcraft_task_expand with ${JSON.stringify(retryTaskExpandArgs)}.`,
              ],
              {
                data: {
                  blockedReason: 'draft_plan_tasks_section_missing',
                  requiredSection: '## Tasks',
                  repairPlanWriteArgs,
                  retryTaskExpandArgs,
                },
                warnings: [
                  {
                    type: 'draft_plan_tasks_section_missing',
                    severity: 'error',
                    message:
                      'The existing draft plan is missing a `## Tasks` section, so pending manual tasks cannot be merged into it.',
                    count: selectedTasks.length,
                  },
                ],
              },
            );
          }
          return toolError('Failed to build a reviewed plan scaffold from the selected manual tasks.');
        }

        const discoveryError = validateDiscoverySection(planScaffold);
        if (discoveryError) {
          if (existingPlan) {
            const repairPlanWriteArgs = {
              feature,
              content: planScaffold,
            };
            return toolError(
              discoveryError,
              [
                `Repair the merged draft with warcraft_plan_write using ${JSON.stringify(repairPlanWriteArgs)} and add the required \`## Discovery\` details.`,
                'After writing the repaired draft, continue with warcraft_plan_approve or warcraft_task_expand depending on whether more manual tasks remain.',
              ],
              {
                data: {
                  blockedReason: 'draft_plan_discovery_section_invalid',
                  discoveryError,
                  repairPlanWriteArgs,
                  affectedManualTasks: selectedTasks.map((task) => task.folder),
                },
                warnings: [
                  {
                    type: 'draft_plan_discovery_section_invalid',
                    severity: 'error',
                    message:
                      'The existing draft plan is missing required discovery details, so merged manual work cannot be finalized yet.',
                    count: selectedTasks.length,
                  },
                ],
              },
            );
          }
          return toolError(discoveryError);
        }

        const resultingWorkflowPath = detectWorkflowPath(planScaffold);
        if (resultingWorkflowPath === 'lightweight') {
          const lightweightIssues = validateLightweightPlan(planScaffold);
          if (lightweightIssues.length > 0) {
            const retryTaskExpandArgs = {
              feature,
              tasks: selectedTasks.map((task) => task.folder),
              mode: 'standard' as const,
            };
            return toolError(
              `Cannot expand to a lightweight plan:\n${lightweightIssues.map((issue) => `- ${issue}`).join('\n')}`,
              [
                `Retry warcraft_task_expand with ${JSON.stringify(retryTaskExpandArgs)} to promote this work through the standard reviewed path.`,
              ],
              {
                data: {
                  blockedReason: 'lightweight_plan_invalid',
                  validationIssues: lightweightIssues,
                  retryTaskExpandArgs,
                },
                warnings: [
                  {
                    type: 'lightweight_plan_invalid',
                    severity: 'error',
                    message: 'The requested lightweight expansion violates lightweight workflow guardrails.',
                    count: lightweightIssues.length,
                  },
                ],
              },
            );
          }
        }

        const planPath = planService.write(feature, planScaffold);
        featureService.patchMetadata(feature, { workflowPath: resultingWorkflowPath });
        const preview = taskService.previewSync(feature);
        const remainingManualTasks = preview.manual;
        const taskExpandArgs: { feature: string; tasks: string[]; mode: 'lightweight' | 'standard' } | null =
          remainingManualTasks.length > 0
            ? {
                feature,
                tasks: remainingManualTasks,
                mode: resultingWorkflowPath === 'standard' ? 'standard' : 'lightweight',
              }
            : null;
        const planApproveArgs = remainingManualTasks.length === 0 ? { feature } : null;
        const taskSyncArgs = remainingManualTasks.length === 0 ? { feature, mode: 'sync' as const } : null;
        const promotionFlow = taskExpandArgs
          ? buildPendingManualPromotionFlow(taskExpandArgs, { feature }, { feature, mode: 'sync' })
          : buildDraftPlanPromotionFlow({ feature }, { feature, mode: 'sync' });

        return toolSuccess({
          feature,
          tasks: selectedTasks.map((task) => task.folder),
          workflowPath: resultingWorkflowPath,
          planPath,
          planScaffoldMode,
          mergedIntoExistingPlan: !!existingPlan,
          planScaffold,
          planWriteArgs: { feature, content: planScaffold },
          planApproveArgs,
          taskSyncArgs,
          remainingManualTasks,
          taskExpandArgs,
          promotionFlow,
          syncPreview: {
            wouldCreate: preview.created,
            wouldRemove: preview.removed,
            wouldKeep: preview.kept,
            wouldReconcile: preview.reconciled,
            manualTasks: preview.manual,
          },
          message:
            `Expanded ${selectedTasks.length} pending manual task(s) into ${existingPlan ? 'the existing draft plan' : `a ${planScaffoldMode} reviewed plan`} at ${planPath}. ` +
            (remainingManualTasks.length > 0
              ? `There are still ${remainingManualTasks.length} pending manual task(s) outside the draft plan. Use warcraft_task_expand again before approval so the reviewed plan stays complete.`
              : 'Review or refine the plan, then run warcraft_plan_approve and warcraft_tasks_sync to apply the previewed reconciliations.'),
        });
      },
    });
  }

  /**
   * Update task status or summary
   */
  updateTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, validateTaskStatus, eventLogger } = this.deps;
    return tool({
      description: 'Update task status or summary',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        status: tool.schema.string().optional().describe('New status: pending, in_progress, done, cancelled'),
        summary: tool.schema.string().optional().describe('Summary of work'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ task, status, summary, feature: explicitFeature }) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        validateTaskInput(task);

        if (status) {
          const currentTask = taskService.get(feature, task);
          const validatedStatus = validateTaskStatus(status);

          // Explicit reopen rejection: done → in_progress is never allowed through this tool.
          // Use warcraft_worktree_create to re-dispatch a task if needed.
          if (currentTask && currentTask.status === 'done' && validatedStatus === 'in_progress') {
            return toolError(
              `Cannot reopen completed task "${task}": done → in_progress is not allowed. ` +
                'If the task needs rework, create a new task or use warcraft_worktree_create and issue the returned task() call.',
            );
          }

          // Detect reopen: status changing away from 'done' (for event logging)
          if (currentTask && currentTask.status === 'done' && validatedStatus !== 'done') {
            const latestTrace = eventLogger.getLatestTraceContext?.(feature, task);
            const reopenTrace = latestTrace ? createChildSpan(latestTrace) : createTraceContext();
            eventLogger.emit({
              type: 'reopen',
              feature,
              task,
              ...reopenTrace,
              details: { previousStatus: 'done', newStatus: validatedStatus },
            });
          }

          // Use validated transition path for status changes
          try {
            const updated = taskService.transition(feature, task, validatedStatus, {
              summary,
            });
            return toolSuccess({ message: `Task "${task}" updated: status=${updated.status}` });
          } catch (error) {
            if (error instanceof InvalidTransitionError) {
              return toolError(`Cannot update task "${task}": ${error.message}`);
            }
            throw error;
          }
        }

        // Summary-only update (no status change) — use update() since no transition is needed
        const updated = taskService.update(feature, task, {
          summary,
        });
        return toolSuccess({ message: `Task "${task}" updated: status=${updated.status}` });
      },
    });
  }
}
