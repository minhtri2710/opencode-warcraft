import type { FeatureJson, PlanComment } from '../../types.js';
import type { PlanStore } from './types.js';
import {
  getFeatureJsonPath,
  readJson,
  writeJson,
} from '../../utils/paths.js';

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
    const feature = this.readFeature(featureName);
    if (!feature) return;

    feature.status = 'approved';
    feature.approvedAt = timestamp;
    feature.planApprovalHash = planHash;
    this.writeFeature(featureName, feature);
  }

  isApproved(featureName: string, currentPlanHash: string): boolean {
    const feature = this.readFeature(featureName);
    if (!feature || feature.status !== 'approved') {
      return false;
    }
    if (!feature.planApprovalHash) {
      return false;
    }
    return feature.planApprovalHash === currentPlanHash;
  }

  revokeApproval(featureName: string): void {
    const feature = this.readFeature(featureName);
    if (!feature || feature.status !== 'approved') return;

    feature.status = 'planning';
    delete feature.approvedAt;
    delete feature.planApprovalHash;
    this.writeFeature(featureName, feature);
  }

  getComments(featureName: string): PlanComment[] {
    const feature = this.readFeature(featureName);
    return feature?.planComments ?? [];
  }

  setComments(featureName: string, comments: PlanComment[]): void {
    const feature = this.readFeature(featureName);
    if (!feature) return;

    feature.planComments = comments;
    this.writeFeature(featureName, feature);
  }

  syncPlanDescription(_featureName: string, _content: string): void {
    // No-op: filesystem mode has no external store to sync to.
  }

  syncPlanComment(_featureName: string, _comment: PlanComment): void {
    // No-op: filesystem mode has no external store to sync to.
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private readFeature(featureName: string): FeatureJsonWithPlanState | null {
    return readJson<FeatureJsonWithPlanState>(
      getFeatureJsonPath(this.projectRoot, featureName, 'off'),
    );
  }

  private writeFeature(featureName: string, feature: FeatureJsonWithPlanState): void {
    writeJson(getFeatureJsonPath(this.projectRoot, featureName, 'off'), feature);
  }
}
