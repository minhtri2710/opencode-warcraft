import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { FeatureService, PlanService } from 'warcraft-core';
import {
  detectWorkflowPath,
  formatPlanReviewChecklistIssues,
  validateDiscoverySection,
  validatePlanReviewChecklist,
} from 'warcraft-core';
import type { ToolContext } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { resolveFeatureInput } from './tool-input.js';
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
   * Write plan.md for the feature
   */
  writePlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService, updateFeatureMetadata } = this.deps;
    return tool({
      description: 'Write plan.md for the feature',
      args: {
        content: tool.schema.string().describe('Plan markdown content'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ content, feature: explicitFeature }, toolContext: ToolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const discoveryError = validateDiscoverySection(content);
        if (discoveryError) {
          return toolError(discoveryError);
        }

        captureSession(feature, toolContext);
        const planPath = planService.write(feature, content);
        updateFeatureMetadata(feature, {
          workflowPath: detectWorkflowPath(content),
        });
        return toolSuccess({ message: `Plan written to ${planPath}.` });
      },
    });
  }

  /**
   * Read plan.md content and approval status
   */
  readPlanTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { captureSession, planService } = this.deps;
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
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ feature: explicitFeature }, toolContext: ToolContext) {
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;
        captureSession(feature, toolContext);
        const planResult = planService.read(feature);
        if (!planResult) {
          return toolError('No plan.md found');
        }

        const checklistResult = validatePlanReviewChecklist(planResult.content);
        if (!checklistResult.ok && workflowGatesMode === 'enforce') {
          return toolError(formatPlanReviewChecklistIssues(checklistResult.issues));
        }

        planService.approve(feature, undefined, planResult.content);
        updateFeatureMetadata(feature, {
          workflowPath: detectWorkflowPath(planResult.content),
          reviewChecklistVersion: checklistResult.ok ? 'v1' : undefined,
          reviewChecklistCompletedAt: checklistResult.ok ? new Date().toISOString() : undefined,
        });

        if (!checklistResult.ok && workflowGatesMode === 'warn') {
          return toolSuccess({
            message: `Plan approved with warning (mode=${workflowGatesMode}).\n${formatPlanReviewChecklistIssues(checklistResult.issues)}\n\nRun warcraft_tasks_sync to generate tasks.`,
          });
        }

        return toolSuccess({ message: 'Plan approved. Run warcraft_tasks_sync to generate tasks.' });
      },
    });
  }
}
