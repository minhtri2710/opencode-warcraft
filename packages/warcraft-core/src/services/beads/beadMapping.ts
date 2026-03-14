import type { TaskStatusType } from '../../types.js';

/**
 * Labels that represent transient workflow states.
 * These must be cleaned up when a task transitions away from the associated status.
 */
const TRANSIENT_LABELS: readonly string[] = ['blocked', 'failed', 'partial', 'cancelled'];

export type TaskBeadAction =
  | { type: 'close'; removeLabels?: string[] }
  | { type: 'claim'; removeLabels?: string[] }
  | { type: 'unclaim'; removeLabels?: string[] }
  | { type: 'defer'; label: TaskStatusType; removeLabels?: string[] };

/**
 * Map a TaskStatusType to the sequence of bead actions needed to sync bead state.
 *
 * Note on claim/unclaim asymmetry:
 * `--claim` is a dedicated br flag that atomically sets assignee + status.
 * There is no `--unclaim` counterpart — the inverse requires two explicit flags
 * (`--assignee '' -s open`). This is a br CLI design choice.
 *
 * Each transition that moves away from a transient state (blocked, failed, partial,
 * cancelled) emits removeLabels to clean up stale labels. Without this, labels
 * accumulate permanently and corrupt bv triage queries.
 */
export function getTaskBeadActions(status: TaskStatusType): TaskBeadAction[] {
  if (status === 'done') {
    // Closing must also clean up any transient labels from prior states
    return [{ type: 'close', removeLabels: [...TRANSIENT_LABELS] }];
  }

  if (status === 'in_progress') {
    // Moving to in_progress clears any prior transient labels
    return [{ type: 'claim', removeLabels: [...TRANSIENT_LABELS] }];
  }

  if (status === 'blocked' || status === 'failed' || status === 'partial' || status === 'cancelled') {
    // When entering a deferred state, remove other transient labels to prevent accumulation.
    // E.g., blocked→failed should remove 'blocked' and add 'failed'.
    const removeLabels = TRANSIENT_LABELS.filter((l) => l !== status);
    return [{ type: 'defer', label: status, removeLabels }];
  }

  if (status === 'pending' || status === 'dispatch_prepared') {
    // Moving back to pending (or dispatch_prepared, a pre-claim staging status)
    // clears all transient labels
    return [{ type: 'unclaim', removeLabels: [...TRANSIENT_LABELS] }];
  }

  return [];
}
