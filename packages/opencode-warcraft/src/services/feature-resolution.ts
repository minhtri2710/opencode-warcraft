import type { DetectionResult } from 'warcraft-core';

// ============================================================================
// Feature Resolution Service
// Resolves the current feature from explicit argument, session context, or defaults.
// ============================================================================

/** Minimal subset of FeatureService needed for resolution. */
export interface FeatureListable {
  list(): string[];
}

/**
 * Create a resolveFeature function that determines the current feature.
 *
 * Priority:
 * 1. Explicit argument
 * 2. Context detection (worktree)
 * 3. Sole feature (when only one exists)
 * 4. null (ambiguous)
 */
export function createResolveFeature(
  directory: string,
  featureService: FeatureListable,
  detectContextFn: (cwd: string) => DetectionResult,
): (explicit?: string) => string | null {
  return (explicit?: string): string | null => {
    const listFeaturesSafe = (): string[] => {
      try {
        return featureService.list();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[warcraft] Failed to list features (degraded: resolving as empty): ${reason}`);
        return [];
      }
    };

    if (explicit) {
      return explicit;
    }

    const context = detectContextFn(directory);
    if (context.feature) {
      return context.feature;
    }

    const features = listFeaturesSafe();
    if (features.length === 1) return features[0];

    return null;
  };
}
