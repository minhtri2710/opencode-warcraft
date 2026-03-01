import * as path from 'path';
import type { TaskStatusType } from 'warcraft-core';

// ============================================================================
// Validation & Gate Logic
// Extracted from index.ts — pure functions with no service dependencies.
// ============================================================================

const VALID_TASK_STATUSES = new Set<string>([
  'pending',
  'in_progress',
  'done',
  'cancelled',
  'blocked',
  'failed',
  'partial',
]);

export const COMPLETION_GATES = ['build', 'test', 'lint'] as const;

export const WORKFLOW_GATES_MODE =
  (process.env.WARCRAFT_WORKFLOW_GATES_MODE || 'warn').toLowerCase() === 'enforce' ? 'enforce' : 'warn';

export const COMPLETION_PASS_SIGNAL =
  /\b(exit(?:\s+code)?\s*0|pass(?:ed|es)?|success(?:ful|fully)?|succeed(?:ed|s)?|ok)\b/i;

export function validateTaskStatus(status: string): TaskStatusType {
  if (!VALID_TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: "${status}". Valid values: ${Array.from(VALID_TASK_STATUSES).join(', ')}`);
  }
  return status as TaskStatusType;
}

export function hasCompletionGateEvidence(summary: string, gate: (typeof COMPLETION_GATES)[number]): boolean {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.some((line) => line.toLowerCase().includes(gate) && COMPLETION_PASS_SIGNAL.test(line));
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const absoluteCandidate = path.resolve(candidatePath);
  const absoluteParent = path.resolve(parentPath);
  const relative = path.relative(absoluteParent, absoluteCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
