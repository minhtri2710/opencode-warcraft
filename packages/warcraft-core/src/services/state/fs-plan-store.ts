import type { FeatureJson, PlanComment } from '../../types.js';
import type { PlanStore } from './types.js';
import {
  getFeatureJsonPath,
  readJson,
} from '../../utils/paths.js';
import { updateJsonLockedSync } from '../../utils/json-lock.js';

type FeatureJsonWithPlanState = FeatureJson & {
  planApprovalHash?: string;
  planComments?: PlanComment[];
};

/**
 * PlanStore backed by local feature.json (beadsMode='off').
 *
 * All approval state and comments are stored in feature.json.
 * No bead interaction whatsoever.
 */
export class FilesystemPlanStore implements PlanStore {
  constructor(private readonly projectRoot: string) {}

  approve(
    featureName: string,
    _planContent: string,
    planHash: string,
    timestamp: string,
    _sessionId?: string,
  ): void {
    const filePath = getFeatureJsonPath(this.projectRoot, featureName, 'off');
    updateJsonLockedSync<FeatureJsonWithPlanState>(
      filePath,
      (current) => ({
        ...current,
        status: 'approved',
        approvedAt: timestamp,
        planApprovalHash: planHash,
      }),
      {} as FeatureJsonWithPlanState,
    );
  }

  isApproved(featureName: string, currentPlanHash: string): boolean {
    const feature = readJson<FeatureJsonWithPlanState>(
      getFeatureJsonPath(this.projectRoot, featureName, 'off'),
    );
    if (!feature || feature.status !== 'approved') {
      return false;
    }
    if (!feature.planApprovalHash) {
      return false;
    }
    return feature.planApprovalHash === currentPlanHash;
  }

  revokeApproval(featureName: string): void {
    const filePath = getFeatureJsonPath(this.projectRoot, featureName, 'off');
    updateJsonLockedSync<FeatureJsonWithPlanState>(
      filePath,
      (current) => {
        if (!current || current.status !== 'approved') return current;
        const updated = { ...current, status: 'planning' as const };
        delete updated.approvedAt;
        delete updated.planApprovalHash;
        return updated;
      },
      {} as FeatureJsonWithPlanState,
    );
  }

  getComments(featureName: string): PlanComment[] {
    const feature = readJson<FeatureJsonWithPlanState>(
      getFeatureJsonPath(this.projectRoot, featureName, 'off'),
    );
    return feature?.planComments ?? [];
  }

  setComments(featureName: string, comments: PlanComment[]): void {
    const filePath = getFeatureJsonPath(this.projectRoot, featureName, 'off');
    updateJsonLockedSync<FeatureJsonWithPlanState>(
      filePath,
      (current) => {
        if (!current) return current;
        return { ...current, planComments: comments };
      },
      {} as FeatureJsonWithPlanState,
    );
  }

  syncPlanDescription(_featureName: string, _content: string): void {
    // No-op: filesystem mode has no external store to sync to.
  }

  syncPlanComment(_featureName: string, _comment: PlanComment): void {
    // No-op: filesystem mode has no external store to sync to.
  }

}
