import type { TaskStatusType } from '../types.js';

/**
 * Allowed task status transitions.
 *
 * Each key is a current status, and its value is the set of statuses it can transition to.
 * Same-status transitions (no-ops) are always allowed implicitly.
 *
 * Core invariant: `done -> in_progress` is NEVER allowed in strict mode.
 */
export const ALLOWED_TRANSITIONS: Record<TaskStatusType, readonly TaskStatusType[]> = {
  pending: ['in_progress', 'dispatch_prepared', 'cancelled'],
  dispatch_prepared: ['in_progress', 'cancelled', 'pending'],
  in_progress: ['done', 'blocked', 'failed', 'partial', 'cancelled'],
  done: ['cancelled'],
  cancelled: ['pending'],
  blocked: ['in_progress', 'cancelled'],
  failed: ['pending', 'cancelled'],
  partial: ['in_progress', 'cancelled'],
};

/**
 * Error thrown when a task status transition is not allowed.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskStatusType,
    public readonly to: TaskStatusType,
  ) {
    const allowed = ALLOWED_TRANSITIONS[from];
    super(
      `Invalid task status transition: '${from}' -> '${to}'. ` +
        `Allowed transitions from '${from}': ${allowed.length > 0 ? allowed.join(', ') : 'none'}.`,
    );
    this.name = 'InvalidTransitionError';
  }
}

/**
 * Check if a transition from one status to another is allowed.
 * Same-status transitions (no-ops) are always allowed.
 */
export function isTransitionAllowed(from: TaskStatusType, to: TaskStatusType): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Validate a transition, throwing InvalidTransitionError if not allowed.
 * Same-status transitions (no-ops) are always allowed.
 */
export function validateTransition(from: TaskStatusType, to: TaskStatusType): void {
  if (!isTransitionAllowed(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
