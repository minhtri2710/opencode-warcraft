import { describe, expect, it } from 'bun:test';
import { mapBeadStatusToFeatureStatus, mapBeadStatusToTaskStatus } from './beadStatus.js';

describe('beadStatus comprehensive', () => {
  const BEAD_STATUSES = ['open', 'closed', 'in_progress'];
  const LABELS_COMBOS: Array<string[] | undefined> = [
    undefined,
    [],
    ['blocked'],
    ['failed'],
    ['partial'],
    ['cancelled'],
    ['blocked', 'failed'],
  ];

  describe('mapBeadStatusToTaskStatus all combinations', () => {
    for (const beadStatus of BEAD_STATUSES) {
      for (const labels of LABELS_COMBOS) {
        const labelDesc = labels ? `[${labels.join(',')}]` : 'undefined';
        it(`${beadStatus} + ${labelDesc}`, () => {
          const result = mapBeadStatusToTaskStatus(beadStatus, labels);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        });
      }
    }
  });

  describe('mapBeadStatusToFeatureStatus', () => {
    for (const beadStatus of BEAD_STATUSES) {
      it(`${beadStatus} maps to valid feature status`, () => {
        const result = mapBeadStatusToFeatureStatus(beadStatus);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    }
  });
});
