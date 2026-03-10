import { describe, expect, it } from 'bun:test';
import { mapBeadStatusToTaskStatus } from './beadStatus.js';

describe('mapBeadStatusToTaskStatus', () => {
  it('returns blocked for deferred with no labels (existing behavior)', () => {
    expect(mapBeadStatusToTaskStatus('deferred')).toBe('blocked');
  });

  it('returns failed for deferred with failed label', () => {
    expect(mapBeadStatusToTaskStatus('deferred', ['failed'])).toBe('failed');
  });

  it('returns partial for deferred with partial label', () => {
    expect(mapBeadStatusToTaskStatus('deferred', ['partial'])).toBe('partial');
  });

  it('returns cancelled for deferred with cancelled label', () => {
    expect(mapBeadStatusToTaskStatus('deferred', ['cancelled'])).toBe('cancelled');
  });

  it('returns failed for deferred with multiple labels (first match wins)', () => {
    expect(mapBeadStatusToTaskStatus('deferred', ['failed', 'some-other-label'])).toBe('failed');
  });

  it('ignores labels for non-deferred statuses', () => {
    expect(mapBeadStatusToTaskStatus('open', ['failed'])).toBe('pending');
    expect(mapBeadStatusToTaskStatus('closed', ['failed'])).toBe('done');
    expect(mapBeadStatusToTaskStatus('in_progress', ['partial'])).toBe('in_progress');
  });
});
