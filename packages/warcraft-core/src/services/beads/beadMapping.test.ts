import { describe, expect, it } from 'bun:test';
import { getTaskBeadActions } from './beadMapping';

describe('getTaskBeadActions', () => {
  it('maps done to close action', () => {
    expect(getTaskBeadActions('done')).toEqual([{ type: 'close' }]);
  });

  it('maps in_progress to claim action', () => {
    expect(getTaskBeadActions('in_progress')).toEqual([{ type: 'claim' }]);
  });

  it('maps deferred statuses to defer action with matching label', () => {
    expect(getTaskBeadActions('blocked')).toEqual([{ type: 'defer', label: 'blocked' }]);
    expect(getTaskBeadActions('failed')).toEqual([{ type: 'defer', label: 'failed' }]);
    expect(getTaskBeadActions('partial')).toEqual([{ type: 'defer', label: 'partial' }]);
    expect(getTaskBeadActions('cancelled')).toEqual([{ type: 'defer', label: 'cancelled' }]);
  });

  it('maps pending to unclaim action', () => {
    expect(getTaskBeadActions('pending')).toEqual([{ type: 'unclaim' }]);
  });
});
