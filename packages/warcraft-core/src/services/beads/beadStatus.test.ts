import { describe, expect, it } from 'bun:test';
import { mapBeadStatusToFeatureStatus, mapBeadStatusToTaskStatus } from './beadStatus.js';

describe('mapBeadStatusToTaskStatus', () => {
  it('returns done for closed status', () => {
    expect(mapBeadStatusToTaskStatus('closed')).toBe('done');
  });

  it('returns done for tombstone status', () => {
    expect(mapBeadStatusToTaskStatus('tombstone')).toBe('done');
  });

  it('returns in_progress for in_progress status', () => {
    expect(mapBeadStatusToTaskStatus('in_progress')).toBe('in_progress');
  });

  it('returns in_progress for review status', () => {
    expect(mapBeadStatusToTaskStatus('review')).toBe('in_progress');
  });

  it('returns in_progress for hooked status', () => {
    expect(mapBeadStatusToTaskStatus('hooked')).toBe('in_progress');
  });

  it('returns blocked for blocked status', () => {
    expect(mapBeadStatusToTaskStatus('blocked')).toBe('blocked');
  });

  it('returns pending for empty string', () => {
    expect(mapBeadStatusToTaskStatus('')).toBe('pending');
  });

  it('returns pending for unknown status', () => {
    expect(mapBeadStatusToTaskStatus('open')).toBe('pending');
    expect(mapBeadStatusToTaskStatus('unknown_status')).toBe('pending');
  });

  it('is case-insensitive', () => {
    expect(mapBeadStatusToTaskStatus('CLOSED')).toBe('done');
    expect(mapBeadStatusToTaskStatus('In_Progress')).toBe('in_progress');
    expect(mapBeadStatusToTaskStatus('DEFERRED')).toBe('blocked');
  });

  it('returns blocked for deferred with no labels', () => {
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

describe('mapBeadStatusToFeatureStatus', () => {
  it('returns completed for closed status', () => {
    expect(mapBeadStatusToFeatureStatus('closed')).toBe('completed');
  });

  it('returns completed for tombstone status', () => {
    expect(mapBeadStatusToFeatureStatus('tombstone')).toBe('completed');
  });

  it('returns executing for active statuses', () => {
    expect(mapBeadStatusToFeatureStatus('in_progress')).toBe('executing');
    expect(mapBeadStatusToFeatureStatus('blocked')).toBe('executing');
    expect(mapBeadStatusToFeatureStatus('deferred')).toBe('executing');
    expect(mapBeadStatusToFeatureStatus('pinned')).toBe('executing');
    expect(mapBeadStatusToFeatureStatus('hooked')).toBe('executing');
    expect(mapBeadStatusToFeatureStatus('review')).toBe('executing');
  });

  it('returns planning for empty string', () => {
    expect(mapBeadStatusToFeatureStatus('')).toBe('planning');
  });

  it('returns planning for unknown status', () => {
    expect(mapBeadStatusToFeatureStatus('open')).toBe('planning');
    expect(mapBeadStatusToFeatureStatus('unknown')).toBe('planning');
  });

  it('is case-insensitive', () => {
    expect(mapBeadStatusToFeatureStatus('CLOSED')).toBe('completed');
    expect(mapBeadStatusToFeatureStatus('In_Progress')).toBe('executing');
  });
});
