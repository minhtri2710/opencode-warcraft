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

export const COMPLETION_PASS_SIGNAL =
  /\b(exit(?:\s+code)?\s*0|pass(?:ed|es)?|success(?:ful|fully)?|succeed(?:ed|s)?|ok)\b/i;

export const COMPLETION_FAIL_SIGNAL = /\b(not ok|not successful|failed|failure|error)\b/i;

/**
 * Escape special regex characters in a string to use it safely in a RegExp constructor.
 * @param string - The string to escape
 * @returns The escaped string safe for use in regex
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  return lines.some((line) => {
    // Check for fail signals first - if present, reject the line
    if (COMPLETION_FAIL_SIGNAL.test(line)) {
      return false;
    }

    // Check for pass signals and gate name with word boundaries
    // Allow optional trailing 's' for plural forms (test -> tests, build -> builds)
    const gatePattern = new RegExp(`\\b${escapeRegExp(gate)}s?\\b`, 'i');
    return gatePattern.test(line) && COMPLETION_PASS_SIGNAL.test(line);
  });
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const absoluteCandidate = path.resolve(candidatePath);
  const absoluteParent = path.resolve(parentPath);
  const relative = path.relative(absoluteParent, absoluteCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
