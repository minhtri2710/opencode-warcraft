import { describe, expect, it } from 'bun:test';
import { validateTransition, isTransitionAllowed, ALLOWED_TRANSITIONS, InvalidTransitionError } from './task-state-machine.js';
import type { TaskStatusType } from '../types.js';

describe('task-state-machine full matrix', () => {
  const ALL_STATUSES: TaskStatusType[] = [
    'pending', 'in_progress', 'dispatch_prepared', 'done',
    'cancelled', 'blocked', 'failed', 'partial',
  ];

  describe('isTransitionAllowed matrix (8×8 = 64)', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        it(`${from} → ${to}`, () => {
          const allowed = isTransitionAllowed(from, to);
          expect(typeof allowed).toBe('boolean');
          
          // Self-transitions are always allowed
          if (from === to) {
            expect(allowed).toBe(true);
          } else {
            // Cross-check with ALLOWED_TRANSITIONS
            const targets = ALLOWED_TRANSITIONS[from];
            expect(allowed).toBe(targets.includes(to));
          }
        });
      }
    }
  });

  describe('ALLOWED_TRANSITIONS completeness', () => {
    for (const status of ALL_STATUSES) {
      it(`${status} has transitions defined`, () => {
        expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
        expect(Array.isArray(ALLOWED_TRANSITIONS[status])).toBe(true);
      });
    }
  });

  describe('ALLOWED_TRANSITIONS only contains valid statuses', () => {
    const statusSet = new Set(ALL_STATUSES);
    for (const [from, targets] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of targets) {
        it(`${from} → ${to} is a valid status`, () => {
          expect(statusSet.has(to as TaskStatusType)).toBe(true);
        });
      }
    }
  });

  describe('InvalidTransitionError properties', () => {
    it('has correct from/to', () => {
      const err = new InvalidTransitionError('pending' as TaskStatusType, 'done' as TaskStatusType);
      expect(err.from).toBe('pending');
      expect(err.to).toBe('done');
    });

    it('has descriptive message', () => {
      const err = new InvalidTransitionError('pending' as TaskStatusType, 'done' as TaskStatusType);
      expect(err.message).toContain('pending');
      expect(err.message).toContain('done');
      expect(err.message).toContain('Invalid');
    });

    it('is instance of Error', () => {
      const err = new InvalidTransitionError('pending' as TaskStatusType, 'done' as TaskStatusType);
      expect(err instanceof Error).toBe(true);
    });
  });
});
