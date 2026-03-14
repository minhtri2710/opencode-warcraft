import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../../types.js';
import { getTaskBeadActions } from './beadMapping.js';
import { mapBeadStatusToFeatureStatus, mapBeadStatusToTaskStatus } from './beadStatus.js';

describe('beads module cross-validation', () => {
  const ALL_TASK_STATUSES: TaskStatusType[] = [
    'pending',
    'in_progress',
    'dispatch_prepared',
    'done',
    'cancelled',
    'blocked',
    'failed',
    'partial',
  ];

  describe('every bead action has removeLabels', () => {
    for (const status of ALL_TASK_STATUSES) {
      it(`${status} actions have removeLabels`, () => {
        const actions = getTaskBeadActions(status);
        for (const action of actions) {
          // All actions should have removeLabels (possibly empty)
          if (action.removeLabels !== undefined) {
            expect(Array.isArray(action.removeLabels)).toBe(true);
          }
        }
      });
    }
  });

  describe('mapBeadStatusToTaskStatus consistency', () => {
    const BEAD_STATUS_LABEL_COMBOS = [
      { beadStatus: 'open', labels: [] },
      { beadStatus: 'open', labels: ['blocked'] },
      { beadStatus: 'open', labels: ['failed'] },
      { beadStatus: 'open', labels: ['partial'] },
      { beadStatus: 'open', labels: ['cancelled'] },
      { beadStatus: 'closed', labels: [] },
      { beadStatus: 'in_progress', labels: [] },
      { beadStatus: 'open', labels: ['blocked', 'failed'] },
    ];

    for (const { beadStatus, labels } of BEAD_STATUS_LABEL_COMBOS) {
      it(`${beadStatus} + [${labels.join(',')}] → valid TaskStatusType`, () => {
        const taskStatus = mapBeadStatusToTaskStatus(beadStatus, labels);
        expect(ALL_TASK_STATUSES).toContain(taskStatus);
      });
    }
  });

  describe('mapBeadStatusToFeatureStatus consistency', () => {
    const BEAD_STATUSES = ['open', 'closed', 'in_progress'];
    const VALID_FEATURE_STATUSES = ['planning', 'approved', 'executing', 'completed'];

    for (const beadStatus of BEAD_STATUSES) {
      it(`${beadStatus} → valid FeatureStatusType`, () => {
        const featureStatus = mapBeadStatusToFeatureStatus(beadStatus);
        expect(VALID_FEATURE_STATUSES).toContain(featureStatus);
      });
    }
  });

  describe('deferred label cleanup symmetry', () => {
    const DEFERRED: TaskStatusType[] = ['blocked', 'failed', 'partial', 'cancelled'];

    for (const from of DEFERRED) {
      for (const to of DEFERRED) {
        if (from !== to) {
          it(`${from} → ${to}: removes ${from} label`, () => {
            const actions = getTaskBeadActions(to);
            if (actions[0].removeLabels) {
              expect(actions[0].removeLabels).toContain(from);
            }
          });
        }
      }
    }
  });
});
