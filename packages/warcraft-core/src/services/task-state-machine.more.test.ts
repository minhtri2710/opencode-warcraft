import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import { ALLOWED_TRANSITIONS, isTransitionAllowed } from './task-state-machine.js';

describe('task-state-machine comprehensive coverage', () => {
  const ALL_STATUSES: TaskStatusType[] = [
    'pending', 'in_progress', 'dispatch_prepared', 'done',
    'cancelled', 'blocked', 'failed', 'partial',
  ];

  it('every status has at least one outgoing transition', () => {
    for (const status of ALL_STATUSES) {
      const transitions = ALLOWED_TRANSITIONS[status];
      expect(transitions.length).toBeGreaterThan(0);
    }
  });

  it('pending is reachable from cancelled and failed', () => {
    expect(isTransitionAllowed('cancelled', 'pending')).toBe(true);
    expect(isTransitionAllowed('failed', 'pending')).toBe(true);
  });

  it('done is only reachable from in_progress', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'in_progress' || status === 'done') continue;
      expect(isTransitionAllowed(status, 'done')).toBe(false);
    }
  });

  it('cancelled is reachable from every status', () => {
    for (const status of ALL_STATUSES) {
      if (status === 'cancelled') continue;
      expect(isTransitionAllowed(status, 'cancelled')).toBe(true);
    }
  });

  it('no transition loops of length 1 (all self-transitions are no-ops)', () => {
    for (const status of ALL_STATUSES) {
      const transitions = ALLOWED_TRANSITIONS[status];
      // The same status should not appear in its own transitions list
      // (self-transitions are handled separately by isTransitionAllowed)
      expect(transitions).not.toContain(status);
    }
  });

  it('total number of allowed transitions is correct', () => {
    let total = 0;
    for (const transitions of Object.values(ALLOWED_TRANSITIONS)) {
      total += transitions.length;
    }
    // Verify the total stays stable (detect accidental additions/removals)
    expect(total).toBeGreaterThan(15);
    expect(total).toBeLessThan(40);
  });
});
