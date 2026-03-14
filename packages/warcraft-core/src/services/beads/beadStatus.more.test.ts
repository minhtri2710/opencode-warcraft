import { describe, expect, it } from 'bun:test';
import { mapBeadStatusToFeatureStatus } from './beadStatus.js';

describe('beadStatus mapBeadStatusToFeatureStatus', () => {
  it('open maps to planning', () => {
    expect(mapBeadStatusToFeatureStatus('open')).toBe('planning');
  });

  it('closed maps to completed', () => {
    expect(mapBeadStatusToFeatureStatus('closed')).toBe('completed');
  });

  it('in_progress maps to executing', () => {
    expect(mapBeadStatusToFeatureStatus('in_progress')).toBe('executing');
  });

  it('empty string maps to planning', () => {
    expect(mapBeadStatusToFeatureStatus('')).toBe('planning');
  });

  it('unknown status maps to planning', () => {
    expect(mapBeadStatusToFeatureStatus('xyz')).toBe('planning');
  });

  it('case insensitive', () => {
    expect(mapBeadStatusToFeatureStatus('CLOSED')).toBe('completed');
    expect(mapBeadStatusToFeatureStatus('In_Progress')).toBe('executing');
  });
});
