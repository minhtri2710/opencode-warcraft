import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { FeatureService, PlanService, TaskService } from 'warcraft-core';
import {
  detectWorkflowPath,
  formatPlanReviewChecklistIssues,
  validateDiscoverySection,
  validatePlanReviewChecklist,
} from 'warcraft-core';
import type { ToolContext } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { buildPlanScaffold } from './manual-plan-scaffold.js';
import {
  buildApprovedPlanSyncFlow,
  buildChecklistApprovalRecoveryFlow,
  buildDraftPlanPromotionFlow,
  buildPendingManualPromotionFlow,
} from './promotion-flow.js';
import { resolveFeatureInput } from './tool-input.js';
export interface PlanToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  captureSession: (feature: string, toolContext: unknown) => void;
  updateFeatureMetadata: (
    feature: string,
    patch: {
      workflowPath?: 'standard' | 'lightweight';
      reviewChecklistVersion?: 'v1';
      reviewChecklistCompletedAt?: string;
    },
  ) => void;
  workflowGatesMode: 'enforce' | 'warn';
}

/**
 * Plan domain tools - Write, read, and approve plans
 */
export class PlanTools {
  constructor(private readonly deps: PlanToolsDependencies) {}

  /**
   * Write plan.md for the feature
   */
  writePlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, featureService, planService, taskService, updateFeatureMetadata } = this.deps;
    return tool({
      description: 'Write plan.md for the feature',
      args: {
        content: tool.schema.string().optional().describe('Plan markdown content'),
        useScaffold: tool.schema
          .boolean()
          .optional()
          .describe('When true, build plan content from pending manual-task briefs instead of requiring explicit markdown.'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ content, useScaffold, feature: explicitFeature }, toolContext: ToolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        let planContent = content?.trim() ?? '';
        let scaffoldMode: 'lightweight' | 'standard' | null = null;
        let generatedFromManualTasks = false;
        let sourceTaskCount = 0;

        if (!planContent) {
          const featureData = featureService.get(feature);
          const existingPlan = planService.read(feature);
          const pendingManualTasks = taskService
            .list(feature)
            .filter((task) => task.origin === 'manual' && task.status === 'pending')
            .map((task) => {
              const rawStatus = taskService.getRawStatus(feature, task.folder);
              return {
                folder: task.folder,
                name: rawStatus?.planTitle ?? task.name,
                brief: rawStatus?.brief ?? null,
              };
            });

          if (!useScaffold) {
            if (pendingManualTasks.length > 0) {
              const retryArgs = { feature, useScaffold: true };
              return toolError(
                'Plan content is required unless useScaffold is true.',
                [
                  `Pending manual tasks already exist. Retry warcraft_plan_write with ${JSON.stringify(retryArgs)} to scaffold the reviewed draft from them.`,
                  'If you do not want scaffolded content, provide explicit plan markdown instead.',
                ],
                {
                  data: {
                    blockedReason: 'plan_content_required_for_manual_tasks',
                    pendingManualTasks: pendingManualTasks.map((task) => task.folder),
                    retryArgs,
                  },
                  warnings: [
                    {
                      type: 'plan_content_required_for_manual_tasks',
                      severity: 'info',
                      message: 'Pending manual tasks can be promoted directly into a scaffolded reviewed plan.',
                      count: pendingManualTasks.length,
                    },
                  ],
                },
              );
            }
            return toolError('Plan content is required unless useScaffold is true.');
          }

          if (pendingManualTasks.length === 0) {
            if (existingPlan?.status === 'planning') {
              return toolError(
                'No pending manual tasks are available to build a plan scaffold.',
                [
                  'The draft plan already covers the pending manual work that can be promoted right now.',
                  'Review the draft and continue with warcraft_plan_approve when it is ready.',
                ],
                {
                  data: {
                    blockedReason: 'no_pending_manual_tasks_for_scaffold',
                    planApproveArgs: { feature },
                    taskSyncArgs: { feature, mode: 'sync' as const },
                    promotionFlow: buildDraftPlanPromotionFlow({ feature }, { feature, mode: 'sync' }),
                  },
                  warnings: [
                    {
                      type: 'no_pending_manual_tasks_for_scaffold',
                      severity: 'info',
                      message: 'There are no pending manual tasks left to materialize into a scaffolded draft plan.',
                    },
                  ],
                },
              );
            }
            if (existingPlan?.status === 'approved') {
              return toolError(
                'No pending manual tasks are available to build a plan scaffold. The reviewed plan is already approved.',
                [
                  'The approved plan already covers the promotable work that exists right now.',
                  `Continue with warcraft_tasks_sync using ${JSON.stringify({ feature, mode: 'sync' })}.`,
                ],
                {
                  data: {
                    blockedReason: 'approved_plan_has_no_pending_manual_tasks_for_scaffold',
                    taskSyncArgs: { feature, mode: 'sync' as const },
                    promotionFlow: buildApprovedPlanSyncFlow({ feature, mode: 'sync' }),
                  },
                  warnings: [
                    {
                      type: 'approved_plan_has_no_pending_manual_tasks_for_scaffold',
                      severity: 'info',
                      message: 'The approved plan has no remaining manual tasks to materialize into a scaffolded draft.',
                    },
                  ],
                },
              );
            }
            return toolError('No pending manual tasks are available to build a plan scaffold.');
          }

          sourceTaskCount = pendingManualTasks.length;
          scaffoldMode =
            featureData?.workflowRecommendation === 'standard' || pendingManualTasks.length > 2 ? 'standard' : 'lightweight';
          planContent = buildPlanScaffold(feature, scaffoldMode, pendingManualTasks) ?? '';
          generatedFromManualTasks = true;

          if (!planContent) {
            return toolError('Failed to build plan scaffold from pending manual tasks.');
          }
        }

        const discoveryError = validateDiscoverySection(planContent);
        if (discoveryError) {
          return toolError(
            discoveryError,
            [
              'Update the `## Discovery` section so impact, safety, verification, and rollback details are explicit.',
              generatedFromManualTasks
                ? 'If the scaffold came from manual tasks, revise the draft plan content and retry warcraft_plan_write.'
                : 'Revise the plan content and retry warcraft_plan_write.',
            ],
            {
              data: {
                blockedReason: 'discovery_section_invalid',
                discoveryError,
                generatedFromManualTasks,
                sourceTaskCount,
                retryArgs: { feature },
              },
              warnings: [
                {
                  type: 'discovery_section_invalid',
                  severity: 'error',
                  message: 'The plan draft is missing required discovery details.',
                },
              ],
            },
          );
        }

        captureSession(feature, toolContext);
        const planPath = planService.write(feature, planContent);
        const workflowPath = detectWorkflowPath(planContent);
        updateFeatureMetadata(feature, {
          workflowPath,
        });
        const preview =
          typeof taskService.previewSync === 'function'
            ? taskService.previewSync(feature)
            : { created: [], removed: [], kept: [], reconciled: [], manual: [] };
        const remainingManualTasks = preview.manual;
        const taskExpandArgs: { feature: string; tasks: string[]; mode: 'lightweight' | 'standard' } | null =
          remainingManualTasks.length > 0
            ? { feature, tasks: remainingManualTasks, mode: workflowPath === 'standard' ? 'standard' : 'lightweight' }
            : null;
        const planApproveArgs = remainingManualTasks.length === 0 ? { feature } : null;
        const taskSyncArgs = remainingManualTasks.length === 0 ? { feature, mode: 'sync' as const } : null;
        return toolSuccess({
          workflowPath,
          generatedFromManualTasks,
          sourceTaskCount,
          planScaffoldMode: generatedFromManualTasks ? scaffoldMode : null,
          content: planContent,
          planApproveArgs,
          taskSyncArgs,
          remainingManualTasks,
          taskExpandArgs,
          promotionFlow: taskExpandArgs
            ? buildPendingManualPromotionFlow(taskExpandArgs, { feature }, { feature, mode: 'sync' })
            : buildDraftPlanPromotionFlow({ feature }, { feature, mode: 'sync' }),
          message: `Plan written to ${planPath}.`,
        });
      },
    });
  }

  /**
   * Read plan.md content and approval status
   */
  readPlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService, taskService } = this.deps;
    return tool({
      description: 'Read plan.md content and approval status',
      args: {
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ feature: explicitFeature }, toolContext: ToolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        captureSession(feature, toolContext);
        const result = planService.read(feature);
        if (!result) {
          const pendingManualTasks = taskService
            .list(feature)
            .filter((task) => task.origin === 'manual' && task.status === 'pending')
            .map((task) => task.folder);
          if (pendingManualTasks.length > 0) {
            const retryArgs = { feature, useScaffold: true };
            return toolError(
              'No plan.md found. Pending manual tasks can be promoted into a reviewed draft plan first.',
              [
                `Create the draft plan with warcraft_plan_write using ${JSON.stringify(retryArgs)}.`,
                'After the scaffold is written, read the draft again or continue with approval when ready.',
              ],
              {
                data: {
                  blockedReason: 'plan_missing_for_read',
                  pendingManualTasks,
                  retryArgs,
                },
                warnings: [
                  {
                    type: 'plan_missing_for_read',
                    severity: 'info',
                    message: 'Pending manual tasks can be scaffolded into a reviewed draft plan before it can be read.',
                    count: pendingManualTasks.length,
                  },
                ],
              },
            );
          }
          return toolError('No plan.md found');
        }
        return toolSuccess(result);
      },
    });
  }

  /**
   * Approve plan for execution
   */
  approvePlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService, taskService, updateFeatureMetadata, workflowGatesMode } = this.deps;
    return tool({
      description: 'Approve plan for execution',
      args: {
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ feature: explicitFeature }, toolContext: ToolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        captureSession(feature, toolContext);
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
              mode: pendingManualTasks.length > 2 ? ('standard' as const) : ('lightweight' as const),
            };
            return toolError(
              'No plan.md found. Pending manual tasks must be promoted into a reviewed draft before approval is possible.',
              [
                `Promote the pending manual tasks with warcraft_task_expand using ${JSON.stringify(taskExpandArgs)}.`,
                'After the draft is written and reviewed, retry warcraft_plan_approve.',
              ],
              {
                data: {
                  blockedReason: 'plan_missing_for_approval',
                  pendingManualTasks,
                  taskExpandArgs,
                  retryArgs: { feature },
                  promotionFlow: buildPendingManualPromotionFlow(taskExpandArgs, { feature }, { feature, mode: 'sync' }),
                },
                warnings: [
                  {
                    type: 'plan_missing_for_approval',
                    severity: 'error',
                    message: 'A reviewed plan is required before approval can succeed.',
                    count: pendingManualTasks.length,
                  },
                ],
              },
            );
          }
          return toolError('No plan.md found');
        }

        const checklistResult = validatePlanReviewChecklist(planResult.content);
        if (!checklistResult.ok && workflowGatesMode === 'enforce') {
          return toolError(
            formatPlanReviewChecklistIssues(checklistResult.issues),
            [
              'Update the `## Plan Review Checklist` so every required item is explicitly checked.',
              'After revising the checklist, retry warcraft_plan_approve.',
            ],
            {
              data: {
                blockedReason: 'plan_review_checklist_incomplete',
                reviewChecklistIssues: checklistResult.issues,
                retryArgs: { feature },
                promotionFlow: buildChecklistApprovalRecoveryFlow({ feature }),
              },
              warnings: [
                {
                  type: 'plan_review_checklist_incomplete',
                  severity: 'error',
                  message: 'The reviewed plan is missing required checklist confirmations.',
                  count: checklistResult.issues.length,
                },
              ],
            },
          );
        }

        if (typeof taskService.previewSync === 'function') {
          const preview = taskService.previewSync(feature);
          if (preview.manual.length > 0) {
            const taskExpandArgs: { feature: string; tasks: string[]; mode: 'lightweight' | 'standard' } = {
              feature,
              tasks: preview.manual,
              mode: detectWorkflowPath(planResult.content) === 'standard' ? 'standard' : 'lightweight',
            };
            return toolError(
              `Cannot approve plan: ${preview.manual.length} pending manual task(s) still sit outside the reviewed draft plan (${preview.manual.join(', ')}). ` +
                `Run warcraft_task_expand with ${JSON.stringify(taskExpandArgs)} before approval.`,
              [
                `Run warcraft_task_expand with ${JSON.stringify(taskExpandArgs)} to merge the remaining manual tasks into the draft plan.`,
                'After expansion succeeds, review the updated draft and retry warcraft_plan_approve.',
              ],
              {
                data: {
                  blockedReason: 'manual_tasks_outside_plan',
                  remainingManualTasks: preview.manual,
                  taskExpandArgs,
                  retryArgs: { feature },
                  promotionFlow: buildPendingManualPromotionFlow(taskExpandArgs, { feature }, { feature, mode: 'sync' }),
                },
                warnings: [
                  {
                    type: 'manual_tasks_outside_plan',
                    severity: 'error',
                    message: 'Pending manual tasks still sit outside the reviewed draft plan.',
                    affected: preview.manual.join(', '),
                    count: preview.manual.length,
                  },
                ],
              },
            );
          }
        }

        const approveOutcome = planService.approve(feature, undefined, planResult.content);
        if (approveOutcome.severity === 'fatal') {
          return toolError(approveOutcome.diagnostics.map((d) => d.message).join('; '));
        }
        updateFeatureMetadata(feature, {
          workflowPath: detectWorkflowPath(planResult.content),
          reviewChecklistVersion: checklistResult.ok ? 'v1' : undefined,
          reviewChecklistCompletedAt: checklistResult.ok ? new Date().toISOString() : undefined,
        });

        if (!checklistResult.ok && workflowGatesMode === 'warn') {
          return toolSuccess({
            taskSyncArgs: { feature, mode: 'sync' },
            promotionFlow: buildApprovedPlanSyncFlow({ feature, mode: 'sync' }),
            message: `Plan approved with warning (mode=${workflowGatesMode}).\n${formatPlanReviewChecklistIssues(checklistResult.issues)}\n\nRun warcraft_tasks_sync to generate tasks.`,
          });
        }

        return toolSuccess({
          taskSyncArgs: { feature, mode: 'sync' },
          promotionFlow: buildApprovedPlanSyncFlow({ feature, mode: 'sync' }),
          message: 'Plan approved. Run warcraft_tasks_sync to generate tasks.',
        });
      },
    });
  }
}
