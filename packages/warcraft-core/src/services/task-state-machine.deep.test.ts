import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  isTransitionAllowed,
  validateTransition,
} from './task-state-machine.js';

describe('task-state-machine deep validation', () => {
  const ALL_STATES: TaskStatusType[] = [
    'pending',
    'in_progress',
    'dispatch_prepared',
    'done',
    'cancelled',
    'blocked',
    'failed',
    'partial',
  ];

  describe('ALLOWED_TRANSITIONS', () => {
    it('has entry for every state', () => {
      for (const state of ALL_STATES) {
        expect(ALLOWED_TRANSITIONS[state]).toBeDefined();
        expect(Array.isArray(ALLOWED_TRANSITIONS[state])).toBe(true);
      }
    });

    it('pending has transitions', () => {
      expect(ALLOWED_TRANSITIONS.pending.length).toBeGreaterThan(0);
    });

    it('done has limited transitions', () => {
      expect(ALLOWED_TRANSITIONS.done.length).toBeLessThanOrEqual(5);
    });
  });

  describe('isTransitionAllowed consistency', () => {
    it('all ALLOWED_TRANSITIONS entries are valid', () => {
      for (const from of ALL_STATES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          expect(isTransitionAllowed(from, to)).toBe(true);
        }
      }
    });

    it('pending to pending self-transition is allowed', () => {
      expect(isTransitionAllowed('pending', 'pending')).toBe(true);
    });

    it('returns boolean', () => {
      expect(typeof isTransitionAllowed('pending', 'in_progress')).toBe('boolean');
    });
  });

  describe('validateTransition', () => {
    it('does not throw for allowed transition', () => {
      const from = 'pending';
      const to = ALLOWED_TRANSITIONS.pending[0];
      expect(() => validateTransition(from, to)).not.toThrow();
    });

    it('throws InvalidTransitionError for disallowed', () => {
      // Find a disallowed transition
      const from: TaskStatusType = 'blocked';
      const disallowed = ALL_STATES.find((s) => !isTransitionAllowed(from, s));
      if (disallowed) {
        expect(() => validateTransition(from, disallowed)).toThrow();
      }
    });
  });

  describe('InvalidTransitionError', () => {
    it('is an Error', () => {
      const err = new InvalidTransitionError('pending', 'done');
      expect(err).toBeInstanceOf(Error);
    });

    it('contains from and to states', () => {
      const err = new InvalidTransitionError('pending', 'done');
      expect(err.message).toContain('pending');
      expect(err.message).toContain('done');
    });
  });
});
