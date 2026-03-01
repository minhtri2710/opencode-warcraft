import type { FeatureJson, PlanComment } from '../../types.js';
import { readJson, readText, writeJson } from '../../utils/fs.js';
import { getFeatureJsonPath, getPlanPath } from '../../utils/paths.js';
import { type BeadsRepository, isRepositoryInitFailure } from '../beads/BeadsRepository.js';
import type { PlanStore } from './types.js';

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

  approve(featureName: string, planContent: string, planHash: string, timestamp: string, sessionId?: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const setApprovalResult = this.repository.setPlanApproval(epicBeadId, planHash, timestamp, sessionId);
    if (setApprovalResult.success === false) {
      this.throwIfInitFailure(setApprovalResult.error, '[warcraft] Failed to set plan approval');
      console.warn(`[warcraft] Failed to set plan approval: ${setApprovalResult.error.message}`);
    }

    const setPlanResult = this.repository.setApprovedPlan(epicBeadId, planContent, planHash);
    if (setPlanResult.success === false) {
      this.throwIfInitFailure(setPlanResult.error, '[warcraft] Failed to set approved plan');
      console.warn(`[warcraft] Failed to set approved plan: ${setPlanResult.error.message}`);
    }

    const addLabelResult = this.repository.addWorkflowLabel(epicBeadId, 'approved');
    if (addLabelResult.success === false) {
      this.throwIfInitFailure(addLabelResult.error, '[warcraft] Failed to apply approved workflow label');
      console.warn(`[warcraft] Failed to apply approved workflow label: ${addLabelResult.error.message}`);
    }

    // Update local feature.json cache
    const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
    const feature = readJson<FeatureJsonWithPlanState>(featurePath);
    if (feature) {
      feature.status = 'approved';
      feature.approvedAt = timestamp;
      feature.planApprovalHash = planHash;
      writeJson(featurePath, feature);
      const setFeatureStateResult = this.repository.setFeatureState(epicBeadId, feature);
      if (setFeatureStateResult.success === false) {
        this.throwIfInitFailure(
          setFeatureStateResult.error,
          '[warcraft] Failed to cache feature state after plan approval',
        );
        console.warn(
          `[warcraft] Failed to cache feature state after plan approval: ${setFeatureStateResult.error.message}`,
        );
      }
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
      } else if (approvalResult.success === false) {
        this.throwIfInitFailure(
          approvalResult.error,
          `[warcraft] Failed to read plan approval for feature '${featureName}'`,
        );
      }
    } catch {
      // Artifact doesn't exist or is invalid - fall through to legacy check
    }

    if (!approvalData) {
      // Check legacy feature.json from both 'on' and 'off' paths
      const legacyFeature =
        readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'on')) ??
        readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'off'));

      if (
        legacyFeature?.status === 'approved' &&
        legacyFeature.planApprovalHash &&
        legacyFeature.planApprovalHash === currentPlanHash
      ) {
        // Migrate to bead artifacts
        const migrateApprovalResult = this.repository.setPlanApproval(
          epicBeadId,
          legacyFeature.planApprovalHash,
          legacyFeature.approvedAt ?? new Date().toISOString(),
          legacyFeature.sessionId,
        );
        if (migrateApprovalResult.success === false) {
          this.throwIfInitFailure(migrateApprovalResult.error, '[warcraft] Failed to migrate legacy plan approval');
        }
        // Read actual plan content for the approved plan snapshot
        const planContent = readText(getPlanPath(this.projectRoot, featureName, 'on')) ?? '';
        const migratePlanResult = this.repository.setApprovedPlan(
          epicBeadId,
          planContent,
          legacyFeature.planApprovalHash,
        );
        if (migratePlanResult.success === false) {
          this.throwIfInitFailure(
            migratePlanResult.error,
            '[warcraft] Failed to migrate legacy approved plan snapshot',
          );
        }
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

    const clearApprovalResult = this.repository.setPlanApproval(epicBeadId, '', '', undefined);
    if (clearApprovalResult.success === false) {
      this.throwIfInitFailure(
        clearApprovalResult.error,
        `[warcraft] Failed to revoke plan approval for feature '${featureName}'`,
      );
    }
    const clearPlanResult = this.repository.setApprovedPlan(epicBeadId, '', '');
    if (clearPlanResult.success === false) {
      this.throwIfInitFailure(
        clearPlanResult.error,
        `[warcraft] Failed to clear approved plan for feature '${featureName}'`,
      );
    }

    const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
    const feature = readJson<FeatureJsonWithPlanState>(featurePath);
    if (feature && feature.status === 'approved') {
      feature.status = 'planning';
      delete feature.approvedAt;
      delete feature.planApprovalHash;
      writeJson(featurePath, feature);
      const setFeatureStateResult = this.repository.setFeatureState(epicBeadId, feature);
      if (setFeatureStateResult.success === false) {
        this.throwIfInitFailure(
          setFeatureStateResult.error,
          `[warcraft] Failed to cache revoked approval state for feature '${featureName}'`,
        );
      }
    }
  }

  getComments(featureName: string): PlanComment[] {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return [];

    const commentsResult = this.repository.getPlanComments(epicBeadId);
    if (commentsResult.success === true && commentsResult.value && commentsResult.value.length > 0) {
      return commentsResult.value;
    }
    if (commentsResult.success === false) {
      this.throwIfInitFailure(
        commentsResult.error,
        `[warcraft] Failed to read plan comments for feature '${featureName}'`,
      );
    }

    // Fall back to legacy feature.json comments and migrate if found
    const legacyComments = this.readLegacyComments(featureName);
    if (legacyComments.length > 0) {
      const migrateCommentsResult = this.repository.setPlanComments(epicBeadId, legacyComments);
      if (migrateCommentsResult.success === false) {
        this.throwIfInitFailure(migrateCommentsResult.error, '[warcraft] Failed to migrate legacy plan comments');
      }
    }
    return legacyComments;
  }

  setComments(featureName: string, comments: PlanComment[]): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const setCommentsResult = this.repository.setPlanComments(epicBeadId, comments);
    if (setCommentsResult.success === false) {
      this.throwIfInitFailure(
        setCommentsResult.error,
        `[warcraft] Failed to set plan comments for feature '${featureName}'`,
      );
      console.warn(
        `[warcraft] Failed to set plan comments for feature '${featureName}': ${setCommentsResult.error.message}`,
      );
    }
  }
  syncPlanDescription(featureName: string, content: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const result = this.repository.setPlanDescription(epicBeadId, content);
    if (result.success === false) {
      this.throwIfInitFailure(result.error, `[warcraft] Failed to sync plan description for feature '${featureName}'`);
      console.warn(`[warcraft] Failed to sync plan description for feature '${featureName}': ${result.error.message}`);
    }
  }

  syncPlanComment(featureName: string, comment: PlanComment): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const commentText = `[${comment.author}] Line ${comment.line}: ${comment.body}`;
    const result = this.repository.appendPlanComment(epicBeadId, commentText);
    if (result.success === false) {
      this.throwIfInitFailure(result.error, `[warcraft] Failed to sync plan comment for feature '${featureName}'`);
      console.warn(`[warcraft] Failed to sync plan comment for feature '${featureName}': ${result.error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveEpic(featureName: string): string | null {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false) {
      this.throwIfInitFailure(epicResult.error, `Failed to resolve epic for feature '${featureName}'`);
      return null;
    }
    if (!epicResult.value) {
      return null;
    }
    return epicResult.value;
  }

  private throwIfInitFailure(error: unknown, context: string): void {
    if (!isRepositoryInitFailure(error)) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: ${reason}`);
  }
  private readLegacyComments(featureName: string): PlanComment[] {
    const feature = readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'on'));
    return feature?.planComments ?? [];
  }
}
