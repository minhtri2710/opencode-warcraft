import type { FeatureJson, PlanComment } from '../../types.js';
import type { PlanStore } from './types.js';
import type { BeadsRepository } from '../beads/BeadsRepository.js';
import {
  getFeatureJsonPath,
  getPlanPath,
} from '../../utils/paths.js';
import { readJson, readText, writeJson } from '../../utils/fs.js';

type FeatureJsonWithPlanState = FeatureJson & {
  planApprovalHash?: string;
  planComments?: PlanComment[];
};

/**
 * PlanStore backed by bead artifacts (beadsMode='on').
 *
 * Approval state and comments live in bead artifacts.
 * Local feature.json is updated as a cache for parity with filesystem mode.
 */
export class BeadsPlanStore implements PlanStore {
  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

  approve(
    featureName: string,
    planContent: string,
    planHash: string,
    timestamp: string,
    sessionId?: string,
  ): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const setApprovalResult = this.repository.setPlanApproval(epicBeadId, planHash, timestamp, sessionId);
    if (setApprovalResult.success === false) {
      console.warn(`[warcraft] Failed to set plan approval: ${setApprovalResult.error.message}`);
    }

    const setPlanResult = this.repository.setApprovedPlan(epicBeadId, planContent, planHash);
    if (setPlanResult.success === false) {
      console.warn(`[warcraft] Failed to set approved plan: ${setPlanResult.error.message}`);
    }

    this.repository.addWorkflowLabel(epicBeadId, 'approved');

    // Update local feature.json cache
    const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
    const feature = readJson<FeatureJsonWithPlanState>(featurePath);
    if (feature) {
      feature.status = 'approved';
      feature.approvedAt = timestamp;
      feature.planApprovalHash = planHash;
      writeJson(featurePath, feature);
      this.repository.setFeatureState(epicBeadId, feature);
    }
  }

  isApproved(featureName: string, currentPlanHash: string): boolean {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return false;

    let approvalData: { hash: string; approvedAt: string; approvedBySession?: string } | null = null;
    try {
      const approvalResult = this.repository.getPlanApproval(epicBeadId);
      if (approvalResult.success === true && approvalResult.value) {
        approvalData = approvalResult.value;
      }
    } catch {
      // Artifact doesn't exist or is invalid - fall through to legacy check
    }

    if (!approvalData) {
      // Check legacy feature.json from both 'on' and 'off' paths
      const legacyFeature =
        readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'on'))
        ?? readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'off'));

      if (
        legacyFeature?.status === 'approved'
        && legacyFeature.planApprovalHash
        && legacyFeature.planApprovalHash === currentPlanHash
      ) {
        // Migrate to bead artifacts
        this.repository.setPlanApproval(
          epicBeadId,
          legacyFeature.planApprovalHash,
          legacyFeature.approvedAt ?? new Date().toISOString(),
          legacyFeature.sessionId,
        );
        // Read actual plan content for the approved plan snapshot
        const planContent = readText(getPlanPath(this.projectRoot, featureName, 'on')) ?? '';
        this.repository.setApprovedPlan(epicBeadId, planContent, legacyFeature.planApprovalHash);
        return true;
      }
      return false;
    }

    // Validate hash format (64-char lowercase hex = SHA-256)
    if (!approvalData.hash || !/^[a-f0-9]{64}$/.test(approvalData.hash)) {
      return false;
    }

    return approvalData.hash === currentPlanHash;
  }

  revokeApproval(featureName: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    try {
      this.repository.setPlanApproval(epicBeadId, '', '', undefined);
      this.repository.setApprovedPlan(epicBeadId, '', '');

      const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
      const feature = readJson<FeatureJsonWithPlanState>(featurePath);
      if (feature && feature.status === 'approved') {
        feature.status = 'planning';
        delete feature.approvedAt;
        delete feature.planApprovalHash;
        writeJson(featurePath, feature);
        this.repository.setFeatureState(epicBeadId, feature);
      }
    } catch {
      // Ignore errors during revoke
    }
  }

  getComments(featureName: string): PlanComment[] {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return [];

    const commentsResult = this.repository.getPlanComments(epicBeadId);
    if (commentsResult.success === true && commentsResult.value && commentsResult.value.length > 0) {
      return commentsResult.value;
    }

    // Fall back to legacy feature.json comments and migrate if found
    const legacyComments = this.readLegacyComments(featureName);
    if (legacyComments.length > 0) {
      this.repository.setPlanComments(epicBeadId, legacyComments);
    }
    return legacyComments;
  }

  setComments(featureName: string, comments: PlanComment[]): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    this.repository.setPlanComments(epicBeadId, comments);
  }

  syncPlanDescription(featureName: string, content: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    try {
      this.repository.setPlanDescription(epicBeadId, content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to sync plan description for feature '${featureName}': ${reason}`,
      );
    }
  }

  syncPlanComment(featureName: string, comment: PlanComment): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    try {
      const commentText = `[${comment.author}] Line ${comment.line}: ${comment.body}`;
      this.repository.appendPlanComment(epicBeadId, commentText);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to sync plan comment for feature '${featureName}': ${reason}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveEpic(featureName: string): string | null {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return null;
    }
    return epicResult.value;
  }

  private readLegacyComments(featureName: string): PlanComment[] {
    const feature = readJson<FeatureJsonWithPlanState>(
      getFeatureJsonPath(this.projectRoot, featureName, 'on'),
    );
    return feature?.planComments ?? [];
  }
}
