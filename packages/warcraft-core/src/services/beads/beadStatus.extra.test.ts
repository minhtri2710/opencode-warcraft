import { describe, expect, it } from 'bun:test';
import { mapBeadStatusToTaskStatus, mapBeadStatusToFeatureStatus } from './beadStatus.js';

describe('beadStatus extra edge cases', () => {
  describe('mapBeadStatusToTaskStatus', () => {
    it('maps open to pending', () => {
      expect(mapBeadStatusToTaskStatus('open')).toBe('pending');
    });

    it('maps claimed to pending (not a recognized bead status)', () => {
      expect(mapBeadStatusToTaskStatus('claimed')).toBe('pending');
    });

    it('maps working to pending (not a recognized bead status)', () => {
      expect(mapBeadStatusToTaskStatus('working')).toBe('pending');
    });

    it('maps null/undefined-like to pending', () => {
      expect(mapBeadStatusToTaskStatus('')).toBe('pending');
    });

    it('handles whitespace-only status', () => {
      expect(mapBeadStatusToTaskStatus('  ')).toBe('pending');
    });

    it('handles deferred with empty labels array', () => {
      expect(mapBeadStatusToTaskStatus('deferred', [])).toBe('blocked');
    });

    it('handles deferred with unrecognized labels', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['custom-label'])).toBe('blocked');
    });

    it('maps deferred with blocked label', () => {
      expect(mapBeadStatusToTaskStatus('deferred', ['blocked'])).toBe('blocked');
    });
  });

  describe('mapBeadStatusToFeatureStatus', () => {
    it('maps open to planning', () => {
      expect(mapBeadStatusToFeatureStatus('open')).toBe('planning');
    });

    it('maps claimed to planning (not a recognized active status)', () => {
      expect(mapBeadStatusToFeatureStatus('claimed')).toBe('planning');
    });

    it('maps working to planning (not a recognized active status)', () => {
      expect(mapBeadStatusToFeatureStatus('working')).toBe('planning');
    });

    it('maps in_progress to executing', () => {
      expect(mapBeadStatusToFeatureStatus('in_progress')).toBe('executing');
    });

    it('maps review to executing', () => {
      expect(mapBeadStatusToFeatureStatus('review')).toBe('executing');
    });

    it('maps hooked to executing', () => {
      expect(mapBeadStatusToFeatureStatus('hooked')).toBe('executing');
    });

    it('maps deferred to executing', () => {
      expect(mapBeadStatusToFeatureStatus('deferred')).toBe('executing');
    });

    it('handles whitespace-only status', () => {
      expect(mapBeadStatusToFeatureStatus('  ')).toBe('planning');
    });

    it('handles mixed case', () => {
      expect(mapBeadStatusToFeatureStatus('CLOSED')).toBe('completed');
    });
  });
});
