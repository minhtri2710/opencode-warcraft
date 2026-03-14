import { describe, expect, it } from 'bun:test';
import {
  ALLOWED_TRANSITIONS,
  isTransitionAllowed,
  validateTransition,
  InvalidTransitionError,
} from './task-state-machine.js';
import type { TaskStatusType } from '../types.js';

describe('task-state-machine exhaustive', () => {
  const ALL_STATES: TaskStatusType[] = [
    'pending', 'in_progress', 'dispatch_prepared', 'done',
    'cancelled', 'blocked', 'failed', 'partial',
  ];

  describe('transition matrix completeness', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        it(`${from} -> ${to}: consistent with ALLOWED_TRANSITIONS`, () => {
          if (from === to) {
            // Self-transitions are always allowed by isTransitionAllowed
            expect(isTransitionAllowed(from, to)).toBe(true);
          } else {
            const allowed = ALLOWED_TRANSITIONS[from].includes(to);
            expect(isTransitionAllowed(from, to)).toBe(allowed);
          }
        });
      }
    }
  });

  describe('validateTransition matches isTransitionAllowed', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (from !== to) {
          it(`validate ${from} -> ${to}`, () => {
            const allowed = isTransitionAllowed(from, to);
            if (allowed) {
              expect(() => validateTransition(from, to)).not.toThrow();
            } else {
              expect(() => validateTransition(from, to)).toThrow();
            }
          });
        }
      }
    }
  });
});
