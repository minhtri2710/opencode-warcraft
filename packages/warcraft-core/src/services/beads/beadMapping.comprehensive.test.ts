import { describe, expect, it } from 'bun:test';
import { getTaskBeadActions, type TaskBeadAction } from './beadMapping.js';
import type { TaskStatusType } from '../../types.js';

describe('beadMapping comprehensive', () => {
  const ALL_STATUSES: TaskStatusType[] = [
    'pending', 'in_progress', 'dispatch_prepared', 'done',
    'cancelled', 'blocked', 'failed', 'partial',
  ];

  describe('every status returns actions', () => {
    for (const status of ALL_STATUSES) {
      it(`${status} returns array`, () => {
        const actions = getTaskBeadActions(status);
        expect(Array.isArray(actions)).toBe(true);
        expect(actions.length).toBeGreaterThanOrEqual(1);
      });
    }
  });

  describe('done produces close action', () => {
    it('type is close', () => {
      const actions = getTaskBeadActions('done');
      expect(actions[0].type).toBe('close');
    });

    it('removes all transient labels', () => {
      const actions = getTaskBeadActions('done');
      expect(actions[0].removeLabels).toContain('blocked');
      expect(actions[0].removeLabels).toContain('failed');
      expect(actions[0].removeLabels).toContain('partial');
      expect(actions[0].removeLabels).toContain('cancelled');
    });
  });

  describe('in_progress produces claim action', () => {
    it('type is claim', () => {
      const actions = getTaskBeadActions('in_progress');
      expect(actions[0].type).toBe('claim');
    });

    it('removes transient labels', () => {
      expect(getTaskBeadActions('in_progress')[0].removeLabels!.length).toBe(4);
    });
  });

  describe('deferred states produce defer action', () => {
    const DEFERRED: TaskStatusType[] = ['blocked', 'failed', 'partial', 'cancelled'];

    for (const status of DEFERRED) {
      it(`${status} produces defer with own label`, () => {
        const actions = getTaskBeadActions(status);
        expect(actions[0].type).toBe('defer');
        if (actions[0].type === 'defer') {
          expect(actions[0].label).toBe(status);
        }
      });

      it(`${status} removes other transient labels`, () => {
        const actions = getTaskBeadActions(status);
        const removes = actions[0].removeLabels!;
        // Should NOT contain own status
        expect(removes).not.toContain(status);
        // Should contain the other 3
        expect(removes.length).toBe(3);
      });
    }
  });

  describe('pending/dispatch_prepared produce unclaim', () => {
    for (const status of ['pending', 'dispatch_prepared'] as TaskStatusType[]) {
      it(`${status} type is unclaim`, () => {
        expect(getTaskBeadActions(status)[0].type).toBe('unclaim');
      });

      it(`${status} removes all transient labels`, () => {
        expect(getTaskBeadActions(status)[0].removeLabels!.length).toBe(4);
      });
    }
  });

  describe('label cleanup prevents accumulation', () => {
    it('blocked→failed removes blocked', () => {
      const blocked = getTaskBeadActions('blocked');
      const failed = getTaskBeadActions('failed');
      // Moving from blocked to failed should result in 'blocked' being removed
      expect(failed[0].removeLabels).toContain('blocked');
    });

    it('failed→done removes all transient', () => {
      const done = getTaskBeadActions('done');
      expect(done[0].removeLabels).toContain('failed');
    });
  });
});
