import { describe, expect, it } from 'bun:test';
import { getTaskBeadActions } from './beadMapping.js';

describe('getTaskBeadActions', () => {
  it('maps done to close action with removeLabels for transient labels', () => {
    expect(getTaskBeadActions('done')).toEqual([
      { type: 'close', removeLabels: ['blocked', 'failed', 'partial', 'cancelled'] },
    ]);
  });

  it('maps in_progress to claim action with removeLabels for transient labels', () => {
    const actions = getTaskBeadActions('in_progress');
    expect(actions).toEqual([{ type: 'claim', removeLabels: ['blocked', 'failed', 'partial', 'cancelled'] }]);
  });

  it('maps deferred statuses to defer action with matching label and removeLabels for other transient labels', () => {
    const blocked = getTaskBeadActions('blocked');
    expect(blocked).toEqual([{ type: 'defer', label: 'blocked', removeLabels: ['failed', 'partial', 'cancelled'] }]);

    const failed = getTaskBeadActions('failed');
    expect(failed).toEqual([{ type: 'defer', label: 'failed', removeLabels: ['blocked', 'partial', 'cancelled'] }]);

    const partial = getTaskBeadActions('partial');
    expect(partial).toEqual([{ type: 'defer', label: 'partial', removeLabels: ['blocked', 'failed', 'cancelled'] }]);

    const cancelled = getTaskBeadActions('cancelled');
    expect(cancelled).toEqual([{ type: 'defer', label: 'cancelled', removeLabels: ['blocked', 'failed', 'partial'] }]);
  });

  it('maps pending to unclaim action with removeLabels for all transient labels', () => {
    const actions = getTaskBeadActions('pending');
    expect(actions).toEqual([{ type: 'unclaim', removeLabels: ['blocked', 'failed', 'partial', 'cancelled'] }]);
  });

  it('returns empty array for unknown status', () => {
    expect(getTaskBeadActions('unknown' as any)).toEqual([]);
  });
});
