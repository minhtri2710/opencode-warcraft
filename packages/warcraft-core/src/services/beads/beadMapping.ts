import type { TaskStatusType } from '../../types.js';

export type TaskBeadAction =
  | { type: 'close' }
  | { type: 'claim' }
  | { type: 'unclaim' }
  | { type: 'defer'; label: TaskStatusType };

export function getTaskBeadActions(status: TaskStatusType): TaskBeadAction[] {
  if (status === 'done') {
    return [{ type: 'close' }];
  }

  if (status === 'in_progress') {
    return [{ type: 'claim' }];
  }

  if (status === 'blocked' || status === 'failed' || status === 'partial' || status === 'cancelled') {
    return [{ type: 'defer', label: status }];
  }

  if (status === 'pending') {
    return [{ type: 'unclaim' }];
  }

  return [];
}
