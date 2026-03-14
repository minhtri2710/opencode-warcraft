import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import { ALLOWED_TRANSITIONS, isTransitionAllowed, validateTransition } from './task-state-machine.js';

describe('task-state-machine exhaustive matrix', () => {
  const ALL_STATUSES: TaskStatusType[] = [
    'pending',
    'in_progress',
    'dispatch_prepared',
    'done',
    'cancelled',
    'blocked',
    'failed',
    'partial',
  ];

  describe('validateTransition', () => {
    it('does not throw for all allowed transitions', () => {
      for (const from of ALL_STATUSES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          expect(() => validateTransition(from, to)).not.toThrow();
        }
      }
    });

    it('throws for disallowed transitions', () => {
      for (const from of ALL_STATUSES) {
        const allowed = new Set(ALLOWED_TRANSITIONS[from]);
        for (const to of ALL_STATUSES) {
          if (from === to || allowed.has(to)) continue;
          expect(() => validateTransition(from, to)).toThrow();
        }
      }
    });

    it('same-status transitions never throw', () => {
      for (const status of ALL_STATUSES) {
        expect(() => validateTransition(status, status)).not.toThrow();
      }
    });
  });

  describe('transition symmetry checks', () => {
    it('pending → in_progress is allowed', () => {
      expect(isTransitionAllowed('pending', 'in_progress')).toBe(true);
    });

    it('in_progress → pending is NOT allowed', () => {
      expect(isTransitionAllowed('in_progress', 'pending')).toBe(false);
    });

    it('done → pending is NOT allowed', () => {
      expect(isTransitionAllowed('done', 'pending')).toBe(false);
    });

    it('done → cancelled is the only transition from done', () => {
      expect(ALLOWED_TRANSITIONS['done']).toEqual(['cancelled']);
    });

    it('blocked → in_progress is allowed (unblock)', () => {
      expect(isTransitionAllowed('blocked', 'in_progress')).toBe(true);
    });

    it('partial → in_progress is allowed (retry)', () => {
      expect(isTransitionAllowed('partial', 'in_progress')).toBe(true);
    });

    it('failed → pending is allowed (reset)', () => {
      expect(isTransitionAllowed('failed', 'pending')).toBe(true);
    });
  });
});
