import { validatePathSegment } from './index.js';

/**
 * Result of resolving a feature from tool input.
 * Either a resolved feature name or an error message.
 */
export type FeatureResolution =
	| { ok: true; feature: string }
	| { ok: false; error: string };

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
