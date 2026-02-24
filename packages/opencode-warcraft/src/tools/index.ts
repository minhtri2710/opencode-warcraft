export { FeatureTools, type FeatureToolsDependencies } from './feature-tools.js';
export { PlanTools, type PlanToolsDependencies } from './plan-tools.js';
export { TaskTools, type TaskToolsDependencies } from './task-tools.js';
export { WorktreeTools, type WorktreeToolsDependencies } from './worktree-tools.js';
export { BatchTools, type BatchToolsDependencies } from './batch-tools.js';
export { ContextTools, type ContextToolsDependencies } from './context-tools.js';
export { SkillTools, type SkillToolsDependencies } from './skill-tools.js';

/**
 * Validate that a string is safe for use as a filesystem path segment.
 * Rejects path traversal attempts, hidden files, and dangerous characters.
 * @param value - The string to validate
 * @param label - Parameter name for error messages (e.g. 'feature', 'task')
 * @returns The validated string
 * @throws Error if the value is not a safe path segment
 */
export function validatePathSegment(value: string, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  if (/[/\\]/.test(value)) {
    throw new Error(`${label} cannot contain path separators: "${value}"`);
  }
  if (value === '..' || value === '.' || value.startsWith('..')) {
    throw new Error(`${label} cannot be a relative path reference: "${value}"`);
  }
  if (value.startsWith('.')) {
    throw new Error(`${label} cannot start with a dot: "${value}"`);
  }
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} cannot contain control characters: "${value}"`);
  }
  return value;
}
