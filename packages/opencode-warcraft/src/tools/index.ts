import { sanitizeName } from 'warcraft-core';

export { FeatureTools, type FeatureToolsDependencies } from './feature-tools.js';
export { PlanTools, type PlanToolsDependencies } from './plan-tools.js';
export { TaskTools, type TaskToolsDependencies } from './task-tools.js';
export { WorktreeTools, type WorktreeToolsDependencies } from './worktree-tools.js';
export { BatchTools, type BatchToolsDependencies } from './batch-tools.js';
export { ContextTools, type ContextToolsDependencies } from './context-tools.js';
export { SkillTools, type SkillToolsDependencies } from './skill-tools.js';

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