import { sanitizeName } from 'warcraft-core';

/**
 * Validate that a string is safe for use as a filesystem path segment.
 * Delegates to warcraft-core's sanitizeName.
 * @param value - The string to validate
 * @param label - Parameter name for error messages (e.g. 'feature', 'task')
 * @returns The validated string
 * @throws Error if the value is not a safe path segment
 */
export function validatePathSegment(value: string, label: string): string {
  try {
    return sanitizeName(value);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${msg}`);
  }
}

/**
 * Result of resolving a feature from tool input.
 * Either a resolved feature name or an error message.
 */
export type FeatureResolution =
  | { ok: true; feature: string; error?: undefined }
  | { ok: false; feature?: undefined; error: string };

/**
 * Resolve and validate a feature name from tool input.
 * Centralizes the repeated pattern across all tool handlers.
 *
 * @param resolveFeature - Feature resolver function
 * @param explicitFeature - Optional explicit feature name from tool args
 * @returns Resolved feature or error
 */
export function resolveFeatureInput(
  resolveFeature: (name?: string) => string | null,
  explicitFeature?: string,
): FeatureResolution {
  if (explicitFeature) {
    validatePathSegment(explicitFeature, 'feature');
  }
  const feature = resolveFeature(explicitFeature);
  if (!feature) {
    return {
      ok: false,
      error: 'No feature specified. Create a feature or provide feature param.',
    };
  }
  return { ok: true, feature };
}

/**
 * Resolve and validate a task folder from tool input.
 *
 * @param task - Task folder name from tool args
 * @returns Validated task folder name
 * @throws Error if validation fails
 */
export function validateTaskInput(task: string): string {
  return validatePathSegment(task, 'task');
}
