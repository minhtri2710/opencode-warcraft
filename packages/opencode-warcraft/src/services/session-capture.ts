import type { FeatureService } from 'warcraft-core';
import type { ToolContext } from '../types.js';

// ============================================================================
// Session Capture Service
// Captures session ID and updates feature metadata. Best-effort, never throws.
// ============================================================================

/**
 * Create a captureSession function that persists the current session ID.
 */
export function createCaptureSession(featureService: FeatureService): (feature: string, toolContext: unknown) => void {
  return (feature: string, toolContext: unknown): void => {
    const ctx = toolContext as ToolContext;
    if (ctx?.sessionID) {
      try {
        const currentSession = featureService.getSession(feature);
        if (currentSession !== ctx.sessionID) {
          featureService.setSession(feature, ctx.sessionID);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[warcraft] Failed to capture session for '${feature}' (best-effort): ${reason}`);
      }
    }
  };
}

/**
 * Create an updateFeatureMetadata function that patches metadata on a feature.
 */
export function createUpdateFeatureMetadata(featureService: FeatureService): (
  feature: string,
  patch: {
    workflowPath?: 'standard' | 'lightweight';
    reviewChecklistVersion?: 'v1';
    reviewChecklistCompletedAt?: string;
  },
) => void {
  return (
    feature: string,
    patch: {
      workflowPath?: 'standard' | 'lightweight';
      reviewChecklistVersion?: 'v1';
      reviewChecklistCompletedAt?: string;
    },
  ): void => {
    try {
      const exists = featureService.get(feature);
      if (exists) {
        featureService.patchMetadata(feature, patch);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to update feature metadata for '${feature}' (best-effort): ${reason}`);
    }
  };
}
