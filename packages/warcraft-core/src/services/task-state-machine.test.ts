import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  isTransitionAllowed,
  validateTransition,
} from './task-state-machine.js';

describe('task-state-machine', () => {
  describe('ALLOWED_TRANSITIONS', () => {
    it('defines transitions for all task status types', () => {
      const allStatuses: TaskStatusType[] = [
        'pending',
        'in_progress',
        'done',
        'cancelled',
        'blocked',
        'failed',
        'partial',
      ];
      for (const status of allStatuses) {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(status);
      }
    });

    it('pending can transition to in_progress and cancelled', () => {
      expect(ALLOWED_TRANSITIONS.pending).toContain('in_progress');
      expect(ALLOWED_TRANSITIONS.pending).toContain('cancelled');
    });

    it('in_progress can transition to done, blocked, failed, partial, and cancelled', () => {
      expect(ALLOWED_TRANSITIONS.in_progress).toContain('done');
      expect(ALLOWED_TRANSITIONS.in_progress).toContain('blocked');
      expect(ALLOWED_TRANSITIONS.in_progress).toContain('failed');
      expect(ALLOWED_TRANSITIONS.in_progress).toContain('partial');
      expect(ALLOWED_TRANSITIONS.in_progress).toContain('cancelled');
    });

    it('done MUST NOT allow in_progress (core requirement)', () => {
      expect(ALLOWED_TRANSITIONS.done).not.toContain('in_progress');
    });

    it('done allows cancelled only', () => {
      expect(ALLOWED_TRANSITIONS.done).toContain('cancelled');
      expect(ALLOWED_TRANSITIONS.done).not.toContain('pending');
      expect(ALLOWED_TRANSITIONS.done).not.toContain('blocked');
    });

    it('blocked can transition to in_progress and cancelled', () => {
      expect(ALLOWED_TRANSITIONS.blocked).toContain('in_progress');
      expect(ALLOWED_TRANSITIONS.blocked).toContain('cancelled');
    });

    it('failed can transition to pending and cancelled', () => {
      expect(ALLOWED_TRANSITIONS.failed).toContain('pending');
      expect(ALLOWED_TRANSITIONS.failed).toContain('cancelled');
    });

    it('partial can transition to in_progress and cancelled', () => {
      expect(ALLOWED_TRANSITIONS.partial).toContain('in_progress');
      expect(ALLOWED_TRANSITIONS.partial).toContain('cancelled');
    });

    it('cancelled can transition to pending (re-open)', () => {
      expect(ALLOWED_TRANSITIONS.cancelled).toContain('pending');
    });
  });

  describe('isTransitionAllowed', () => {
    it('returns true for allowed transitions', () => {
      expect(isTransitionAllowed('pending', 'in_progress')).toBe(true);
      expect(isTransitionAllowed('in_progress', 'done')).toBe(true);
      expect(isTransitionAllowed('in_progress', 'blocked')).toBe(true);
      expect(isTransitionAllowed('blocked', 'in_progress')).toBe(true);
    });

    it('returns false for disallowed transitions', () => {
      expect(isTransitionAllowed('done', 'in_progress')).toBe(false);
      expect(isTransitionAllowed('pending', 'done')).toBe(false);
      expect(isTransitionAllowed('pending', 'blocked')).toBe(false);
    });

    it('returns true for same-status transitions (no-op)', () => {
      expect(isTransitionAllowed('pending', 'pending')).toBe(true);
      expect(isTransitionAllowed('in_progress', 'in_progress')).toBe(true);
      expect(isTransitionAllowed('done', 'done')).toBe(true);
    });
  });

  describe('validateTransition', () => {
    it('does not throw for allowed transitions', () => {
      expect(() => validateTransition('pending', 'in_progress')).not.toThrow();
      expect(() => validateTransition('in_progress', 'done')).not.toThrow();
    });

    it('throws InvalidTransitionError for disallowed transitions', () => {
      expect(() => validateTransition('done', 'in_progress')).toThrow(InvalidTransitionError);
    });

    it('error message includes from and to statuses', () => {
      try {
        validateTransition('done', 'in_progress');
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidTransitionError);
        const ite = error as InstanceType<typeof InvalidTransitionError>;
        expect(ite.from).toBe('done');
        expect(ite.to).toBe('in_progress');
        expect(ite.message).toContain('done');
        expect(ite.message).toContain('in_progress');
      }
    });

    it('error message lists valid transitions from current status', () => {
      try {
        validateTransition('done', 'in_progress');
        expect(true).toBe(false);
      } catch (error) {
        const ite = error as InstanceType<typeof InvalidTransitionError>;
        // Should mention what transitions ARE allowed from 'done'
        expect(ite.message).toContain('cancelled');
      }
    });

    it('does not throw for same-status transition', () => {
      expect(() => validateTransition('done', 'done')).not.toThrow();
    });
  });
});
