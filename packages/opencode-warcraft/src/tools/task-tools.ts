import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { EventLogger, FeatureService, PlanService, TaskService, TaskStatusType } from 'warcraft-core';
import {
  createChildSpan,
  createTraceContext,
  detectWorkflowPath,
  InvalidTransitionError,
  validateLightweightPlan,
} from 'warcraft-core';
import { toolError, toolSuccess } from '../types.js';
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
          return toolError('No plan.md found');
        }

        if (planResult.status !== 'approved') {
          return toolError('Plan must be approved first');
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
              return toolError(message);
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
        let instantWorkflowActivated = false;
        if (featureData && !hasPlan) {
          featureService.patchMetadata(feature, { workflowPath: 'instant' });
          if (featureData.status !== 'executing') {
            featureService.updateStatus(feature, 'executing');
          }
          instantWorkflowActivated = true;
        }

        return toolSuccess({
          feature,
          task: folder,
          workflowPath: instantWorkflowActivated ? 'instant' : featureData?.workflowPath ?? 'standard',
          message:
            instantWorkflowActivated
              ? `Manual task created: ${folder}\nInstant workflow activated for feature "${feature}" (no formal plan required for this small task). Include enough detail in the task description to make it self-contained, then call warcraft_worktree_create and issue the returned task() call.`
              : `Manual task created: ${folder}\nReminder: call warcraft_worktree_create to prepare the task workspace, then issue the returned task() call to start the worker in the assigned workspace.`,
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
