import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type { FeatureService, PlanService } from 'warcraft-core';
import type { ToolContext } from '../types.js';
import { validatePathSegment } from './index.js';
import { validateDiscoverySection } from '../utils/discovery-gate.js';
import {
  formatPlanReviewChecklistIssues,
  validatePlanReviewChecklist,
} from '../utils/plan-review-gate.js';
import { detectWorkflowPath } from '../utils/workflow-path.js';

import { toolError, toolSuccess } from '../types.js';
export interface PlanToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
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
   * Write plan.md (clears existing comments)
   */
  writePlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService, updateFeatureMetadata } = this.deps;
    return tool({
      description: 'Write plan.md (clears existing comments)',
      args: {
        content: tool.schema.string().describe('Plan markdown content'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute(
        { content, feature: explicitFeature },
        toolContext: ToolContext,
      ) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return toolError('No feature specified. Create a feature or provide feature param.');

        const discoveryError = validateDiscoverySection(content);
        if (discoveryError) {
          return toolError(discoveryError);
        }

        captureSession(feature, toolContext);
        const planPath = planService.write(feature, content);
        updateFeatureMetadata(feature, {
          workflowPath: detectWorkflowPath(content),
        });
        return toolSuccess({ message: `Plan written to ${planPath}. Comments cleared for fresh review.` });
      },
    });
  }

  /**
   * Read plan.md and user comments
   */
  readPlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService } = this.deps;
    return tool({
      description: 'Read plan.md and user comments',
      args: {
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute(
        { feature: explicitFeature },
        toolContext: ToolContext,
      ) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return toolError('No feature specified. Create a feature or provide feature param.');
        captureSession(feature, toolContext);
        const result = planService.read(feature);
        if (!result) return toolError('No plan.md found');
        return toolSuccess(result);
      },
    });
  }

  /**
   * Approve plan for execution
   */
  approvePlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService, updateFeatureMetadata, workflowGatesMode } = this.deps;
    return tool({
      description: 'Approve plan for execution',
      args: {
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute(
        { feature: explicitFeature },
        toolContext: ToolContext,
      ) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return toolError('No feature specified. Create a feature or provide feature param.');
        captureSession(feature, toolContext);
        const comments = planService.getComments(feature);
        if (comments.length > 0) {
          return toolError(`Cannot approve - ${comments.length} unresolved comment(s). Address them first.`);
        }

        const planResult = planService.read(feature);
        if (!planResult) {
          return toolError('No plan.md found');
        }

        const checklistResult = validatePlanReviewChecklist(planResult.content);
        if (!checklistResult.ok && workflowGatesMode === 'enforce') {
          return toolError(formatPlanReviewChecklistIssues(checklistResult.issues));
        }

        planService.approve(feature);
        updateFeatureMetadata(feature, {
          workflowPath: detectWorkflowPath(planResult.content),
          reviewChecklistVersion: checklistResult.ok ? 'v1' : undefined,
          reviewChecklistCompletedAt: checklistResult.ok
            ? new Date().toISOString()
            : undefined,
        });

        if (!checklistResult.ok && workflowGatesMode === 'warn') {
          return toolSuccess({ message: `Plan approved with warning (mode=${workflowGatesMode}).\n${formatPlanReviewChecklistIssues(checklistResult.issues)}\n\nRun warcraft_tasks_sync to generate tasks.` });
        }

        return toolSuccess({ message: 'Plan approved. Run warcraft_tasks_sync to generate tasks.' });
      },
    });
  }
}
