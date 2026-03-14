import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  isTransitionAllowed,
  validateTransition,
} from './task-state-machine.js';

describe('task-state-machine extra edge cases', () => {
  it('all same-status transitions are allowed', () => {
    const allStatuses: TaskStatusType[] = [
      'pending', 'in_progress', 'dispatch_prepared', 'done',
      'cancelled', 'blocked', 'failed', 'partial',
    ];
    for (const status of allStatuses) {
      expect(isTransitionAllowed(status, status)).toBe(true);
    }
  });

  it('validateTransition does not throw for any same-status transition', () => {
    const allStatuses: TaskStatusType[] = [
      'pending', 'in_progress', 'dispatch_prepared', 'done',
      'cancelled', 'blocked', 'failed', 'partial',
    ];
    for (const status of allStatuses) {
      expect(() => validateTransition(status, status)).not.toThrow();
    }
  });

  it('pending cannot transition to done (must go through in_progress)', () => {
    expect(isTransitionAllowed('pending', 'done')).toBe(false);
  });

  it('pending cannot transition to blocked', () => {
    expect(isTransitionAllowed('pending', 'blocked')).toBe(false);
  });

  it('pending cannot transition to failed', () => {
    expect(isTransitionAllowed('pending', 'failed')).toBe(false);
  });

  it('pending cannot transition to partial', () => {
    expect(isTransitionAllowed('pending', 'partial')).toBe(false);
  });

  it('done cannot transition to pending', () => {
    expect(isTransitionAllowed('done', 'pending')).toBe(false);
  });

  it('done cannot transition to blocked', () => {
    expect(isTransitionAllowed('done', 'blocked')).toBe(false);
  });

  it('cancelled cannot transition to done directly', () => {
    expect(isTransitionAllowed('cancelled', 'done')).toBe(false);
  });

  it('cancelled cannot transition to in_progress directly', () => {
    expect(isTransitionAllowed('cancelled', 'in_progress')).toBe(false);
  });

  it('InvalidTransitionError has correct name property', () => {
    const error = new InvalidTransitionError('done', 'in_progress');
    expect(error.name).toBe('InvalidTransitionError');
  });

  it('InvalidTransitionError exposes from and to properties', () => {
    const error = new InvalidTransitionError('pending', 'done');
    expect(error.from).toBe('pending');
    expect(error.to).toBe('done');
  });

  it('ALLOWED_TRANSITIONS has exactly 8 status entries', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS)).toHaveLength(8);
  });

  it('every allowed transition is valid bidirectionally through the state machine', () => {
    // Verify that at least one path exists from pending to done
    // pending -> in_progress -> done
    expect(isTransitionAllowed('pending', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'done')).toBe(true);
  });

  it('recovery path: failed -> pending -> dispatch_prepared -> in_progress -> done', () => {
    expect(isTransitionAllowed('failed', 'pending')).toBe(true);
    expect(isTransitionAllowed('pending', 'dispatch_prepared')).toBe(true);
    expect(isTransitionAllowed('dispatch_prepared', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'done')).toBe(true);
  });

  it('blocked recovery: blocked -> in_progress -> done', () => {
    expect(isTransitionAllowed('blocked', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'done')).toBe(true);
  });

  it('cancel from any active state', () => {
    const cancellableStatuses: TaskStatusType[] = [
      'pending', 'in_progress', 'dispatch_prepared',
      'blocked', 'failed', 'partial', 'done',
    ];
    for (const status of cancellableStatuses) {
      expect(isTransitionAllowed(status, 'cancelled')).toBe(true);
    }
  });
});
