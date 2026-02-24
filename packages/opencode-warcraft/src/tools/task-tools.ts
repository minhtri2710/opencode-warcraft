import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type {
  FeatureService,
  PlanService,
  TaskService,
  TaskStatusType,
} from 'warcraft-core';
import { detectWorkflowPath, validateLightweightPlan } from '../utils/workflow-path.js';
import { validatePathSegment } from './index.js';

export interface TaskToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  workflowGatesMode: 'enforce' | 'warn';
  validateTaskStatus: (status: string) => TaskStatusType;
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
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';
        const featureData = featureService.get(feature);
        if (!featureData) {
          return 'Error: Feature not found';
        }

        const planResult = planService.read(feature);
        if (!planResult) {
          return 'Error: No plan.md found';
        }

        if (planResult.status !== 'approved') {
          return 'Error: Plan must be approved first';
        }

        let warning = '';
        const workflowPath = detectWorkflowPath(planResult.content);
        if (workflowPath === 'lightweight') {
          const lightweightIssues = validateLightweightPlan(planResult.content);
          if (lightweightIssues.length > 0) {
            const issueBlock = lightweightIssues.map((issue) => `- ${issue}`).join('\n');
            const message = `Lightweight workflow requirements are not satisfied:\n${issueBlock}`;
            if (workflowGatesMode === 'enforce') {
              return `Error: ${message}`;
            }
            warning = `\nWarning (mode=${workflowGatesMode}): ${message}`;
          }
        }

        const result = taskService.sync(feature);
        if (featureData.status === 'approved') {
          featureService.updateStatus(feature, 'executing');
        }
        return `Tasks synced: ${result.created.length} created, ${result.removed.length} removed, ${result.kept.length} kept${warning}`;
      },
    });
  }

  /**
   * Create manual task (not from plan)
   */
  createTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService } = this.deps;
    return tool({
      description: 'Create manual task (not from plan)',
      args: {
        name: tool.schema.string().describe('Task name'),
        order: tool.schema.number().optional().describe('Task order'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
        priority: tool.schema.number().optional().describe('Priority (1-5, default: 3)'),
      },
      async execute({ name, order, feature: explicitFeature, priority }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';
        const priorityValue = priority ?? 3;
        if (!Number.isInteger(priorityValue) || priorityValue < 1 || priorityValue > 5) {
          return `Error: Priority must be an integer between 1 and 5 (inclusive), got: ${priorityValue}`;
        }
        const folder = taskService.create(feature, name, order, priorityValue);
        return `Manual task created: ${folder}\nReminder: start work with warcraft_worktree_create to use its worktree, and ensure any subagents work in that worktree too.`;
      },
    });
  }

  /**
   * Update task status or summary
   */
  updateTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, validateTaskStatus } = this.deps;
    return tool({
      description: 'Update task status or summary',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        status: tool.schema
          .string()
          .optional()
          .describe('New status: pending, in_progress, done, cancelled'),
        summary: tool.schema.string().optional().describe('Summary of work'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ task, status, summary, feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        validatePathSegment(task, 'task');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';
        const updated = taskService.update(feature, task, {
          status: status ? validateTaskStatus(status) : undefined,
          summary,
        });
        return `Task "${task}" updated: status=${updated.status}`;
      },
    });
  }
}
