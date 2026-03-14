import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../../types.js';
import { getTaskBeadActions } from './beadMapping.js';
import { mapBeadStatusToTaskStatus } from './beadStatus.js';

describe('beadMapping comprehensive', () => {
  describe('getTaskBeadActions for all statuses', () => {
    const ALL_STATUSES: TaskStatusType[] = [
      'pending', 'in_progress', 'dispatch_prepared', 'done',
      'cancelled', 'blocked', 'failed', 'partial',
    ];

    for (const status of ALL_STATUSES) {
      it(`returns non-empty actions for status '${status}'`, () => {
        const actions = getTaskBeadActions(status);
        expect(actions.length).toBeGreaterThan(0);
      });
    }

    it('done produces exactly one close action', () => {
      const actions = getTaskBeadActions('done');
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('close');
    });

    it('in_progress produces a claim action', () => {
      const actions = getTaskBeadActions('in_progress');
      expect(actions.some((a) => a.type === 'claim')).toBe(true);
    });

    it('pending produces an unclaim action', () => {
      const actions = getTaskBeadActions('pending');
      expect(actions.some((a) => a.type === 'unclaim')).toBe(true);
    });

    it('blocked produces a defer action with blocked label', () => {
      const actions = getTaskBeadActions('blocked');
      const deferAction = actions.find((a) => a.type === 'defer');
      expect(deferAction).toBeDefined();
      expect((deferAction as any).label).toBe('blocked');
    });

    it('failed produces a defer action with failed label', () => {
      const actions = getTaskBeadActions('failed');
      const deferAction = actions.find((a) => a.type === 'defer');
      expect(deferAction).toBeDefined();
      expect((deferAction as any).label).toBe('failed');
    });

    it('cancelled produces a defer action with cancelled label', () => {
      const actions = getTaskBeadActions('cancelled');
      const deferAction = actions.find((a) => a.type === 'defer');
      expect(deferAction).toBeDefined();
      expect((deferAction as any).label).toBe('cancelled');
    });

    it('partial produces a defer action with partial label', () => {
      const actions = getTaskBeadActions('partial');
      const deferAction = actions.find((a) => a.type === 'defer');
      expect(deferAction).toBeDefined();
      expect((deferAction as any).label).toBe('partial');
    });

    it('dispatch_prepared produces an unclaim action', () => {
      const actions = getTaskBeadActions('dispatch_prepared');
      expect(actions.some((a) => a.type === 'unclaim')).toBe(true);
    });
  });

  describe('mapBeadStatusToTaskStatus', () => {
    it('open maps to pending', () => {
      expect(mapBeadStatusToTaskStatus('open', [])).toBe('pending');
    });

    it('closed maps to done', () => {
      expect(mapBeadStatusToTaskStatus('closed', [])).toBe('done');
    });

    it('tombstone maps to done', () => {
      expect(mapBeadStatusToTaskStatus('tombstone', [])).toBe('done');
    });

    it('in_progress maps to in_progress', () => {
      expect(mapBeadStatusToTaskStatus('in_progress', [])).toBe('in_progress');
    });

    it('review maps to in_progress', () => {
      expect(mapBeadStatusToTaskStatus('review', [])).toBe('in_progress');
    });

    it('hooked maps to in_progress', () => {
      expect(mapBeadStatusToTaskStatus('hooked', [])).toBe('in_progress');
    });

    it('blocked maps to blocked', () => {
      expect(mapBeadStatusToTaskStatus('blocked', [])).toBe('blocked');
    });

    it('deferred with failed label maps to failed', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['failed'])).toBe('failed');
    });

    it('deferred with partial label maps to partial', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['partial'])).toBe('partial');
    });

    it('deferred with cancelled label maps to cancelled', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['cancelled'])).toBe('cancelled');
    });

    it('deferred with no matching labels maps to blocked', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['random'])).toBe('blocked');
    });

    it('deferred with empty labels maps to blocked', () => {
      expect(mapBeadStatusToTaskStatus('deferred', [])).toBe('blocked');
    });

    it('deferred label priority: failed wins over partial', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['partial', 'failed'])).toBe('failed');
    });

    it('empty string maps to pending', () => {
      expect(mapBeadStatusToTaskStatus('', [])).toBe('pending');
    });

    it('unknown status maps to pending', () => {
      expect(mapBeadStatusToTaskStatus('xyz', [])).toBe('pending');
    });

    it('case-insensitive matching', () => {
      expect(mapBeadStatusToTaskStatus('CLOSED', [])).toBe('done');
      expect(mapBeadStatusToTaskStatus('In_Progress', [])).toBe('in_progress');
    });
  });
});
