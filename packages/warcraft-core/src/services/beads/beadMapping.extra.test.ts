import { describe, expect, it } from 'bun:test';
import type { TaskBeadAction } from './beadMapping.js';
import { getTaskBeadActions } from './beadMapping.js';

describe('getTaskBeadActions extra edge cases', () => {
  it('done action removes all 4 transient labels', () => {
    const actions = getTaskBeadActions('done');
    expect(actions[0].removeLabels).toHaveLength(4);
  });

  it('in_progress action removes all 4 transient labels', () => {
    const actions = getTaskBeadActions('in_progress');
    expect(actions[0].removeLabels).toHaveLength(4);
  });

  it('pending action removes all 4 transient labels', () => {
    const actions = getTaskBeadActions('pending');
    expect(actions[0].removeLabels).toHaveLength(4);
  });

  it('dispatch_prepared action removes all 4 transient labels', () => {
    const actions = getTaskBeadActions('dispatch_prepared');
    expect(actions[0].removeLabels).toHaveLength(4);
  });

  it('blocked defers with label blocked and removes 3 other labels', () => {
    const actions = getTaskBeadActions('blocked');
    expect(actions[0].type).toBe('defer');
    expect((actions[0] as any).label).toBe('blocked');
    expect(actions[0].removeLabels).toHaveLength(3);
    expect(actions[0].removeLabels).not.toContain('blocked');
  });

  it('failed defers with label failed and removes 3 other labels', () => {
    const actions = getTaskBeadActions('failed');
    expect((actions[0] as any).label).toBe('failed');
    expect(actions[0].removeLabels).not.toContain('failed');
  });

  it('partial defers with label partial and removes 3 other labels', () => {
    const actions = getTaskBeadActions('partial');
    expect((actions[0] as any).label).toBe('partial');
    expect(actions[0].removeLabels).not.toContain('partial');
  });

  it('cancelled defers with label cancelled and removes 3 other labels', () => {
    const actions = getTaskBeadActions('cancelled');
    expect((actions[0] as any).label).toBe('cancelled');
    expect(actions[0].removeLabels).not.toContain('cancelled');
  });

  it('each status produces exactly one action', () => {
    const statuses = ['done', 'in_progress', 'pending', 'dispatch_prepared', 'blocked', 'failed', 'partial', 'cancelled'];
    for (const status of statuses) {
      const actions = getTaskBeadActions(status as any);
      expect(actions).toHaveLength(1);
    }
  });

  it('removeLabels arrays do not mutate between calls', () => {
    const actions1 = getTaskBeadActions('done');
    const actions2 = getTaskBeadActions('done');
    // Should be equal but not the same reference
    expect(actions1[0].removeLabels).toEqual(actions2[0].removeLabels);
    expect(actions1[0].removeLabels).not.toBe(actions2[0].removeLabels);
  });
});
