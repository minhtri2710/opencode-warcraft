import {
  getPlanPath,
  getFeatureJsonPath,
  readJson,
  writeJson,
  readText,
  writeText,
  fileExists,
} from '../utils/paths.js';
import { FeatureJson, CommentsJson, PlanComment, PlanReadResult } from '../types.js';
import type { BeadsMode, BeadsModeProvider } from '../types.js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ConfigService } from './configService.js';
import { BeadsRepository } from './beads/BeadsRepository.js';

import type { PlanApprovalPayload } from './beads/BeadGateway.types.js';

type FeatureJsonWithPlanState = FeatureJson & {
  planApprovalHash?: string;
  planComments?: PlanComment[];
};

/**
 * Compute SHA-256 hash of plan content.
 * Returns 64-character hex string.
 */
function computePlanHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

export class PlanService {
  private readonly repository: BeadsRepository;
  private readonly beadsModeProvider: BeadsModeProvider;

  constructor(
    private projectRoot: string,
    repository: BeadsRepository | undefined = undefined,
    beadsModeProvider: BeadsModeProvider = new ConfigService(),
  ) {
    this.beadsModeProvider = beadsModeProvider;
    // Create repository if not provided (for backward compatibility)
    const beadsMode = beadsModeProvider.getBeadsMode();
    this.repository = repository ?? new BeadsRepository(projectRoot, {}, beadsMode);
  }

  write(featureName: string, content: string): string {
    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());

    // Check if plan content actually changed (for approval invalidation)
    const currentContent = readText(planPath);
    const contentChanged = currentContent !== null && currentContent !== content;

    writeText(planPath, content);

    this.clearComments(featureName);

    // Invalidate approval if plan changed
    if (contentChanged) {
      this.revokeApproval(featureName);
    }

    // Sync to bead when beadsMode is on
    this.syncPlanDescription(featureName, content);

    return planPath;
  }

  read(featureName: string): PlanReadResult | null {
    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());
    const content = readText(planPath);
    
    if (content === null) return null;

    const comments = this.getComments(featureName);
    const isApproved = this.isApproved(featureName);

    return {
      content,
      status: isApproved ? 'approved' : 'planning',
      comments,
    };
  }

  approve(featureName: string, sessionId?: string): void {
    const beadsMode = this.getBeadsMode();
    const planPath = getPlanPath(this.projectRoot, featureName, beadsMode);
    if (!fileExists(planPath)) {
      throw new Error(`No plan.md found for feature '${featureName}'`);
    }

    // Read plan content and compute hash
    const planContent = fs.readFileSync(planPath, 'utf-8');
    const planHash = computePlanHash(planContent);
    const timestamp = new Date().toISOString();

    if (beadsMode === 'on') {
      // Store approval in bead artifact
      const epicResult = this.repository.getEpicByFeatureName(featureName, false);
      if (epicResult.success === true && epicResult.value) {
        const epicBeadId = epicResult.value;
        
        // Set plan approval
        const setApprovalResult = this.repository.setPlanApproval(epicBeadId, planHash, timestamp, sessionId);
        if (setApprovalResult.success === false) {
          console.warn(`[warcraft] Failed to set plan approval: ${setApprovalResult.error.message}`);
        }
        
        // Store full approved plan snapshot
        const setPlanResult = this.repository.setApprovedPlan(epicBeadId, planContent, planHash);
        if (setPlanResult.success === false) {
          console.warn(`[warcraft] Failed to set approved plan: ${setPlanResult.error.message}`);
        }
        
        // Add approved label
        this.repository.addWorkflowLabel(epicBeadId, 'approved');

        // Update feature state to 'approved' (parity with off-mode)
        const featurePath = getFeatureJsonPath(this.projectRoot, featureName, beadsMode);
        const feature = readJson<FeatureJsonWithPlanState>(featurePath);
        if (feature) {
          feature.status = 'approved';
          feature.approvedAt = timestamp;
          feature.planApprovalHash = planHash;
          writeJson(featurePath, feature);
          this.repository.setFeatureState(epicBeadId, feature);
        }
      }
    }

    if (beadsMode === 'off') {
      const featurePath = getFeatureJsonPath(this.projectRoot, featureName, beadsMode);
      const feature = readJson<FeatureJsonWithPlanState>(featurePath);
      if (feature) {
        feature.status = 'approved';
        feature.approvedAt = timestamp;
        feature.planApprovalHash = planHash;
        writeJson(featurePath, feature);
      }
    }
  }

  isApproved(featureName: string): boolean {
    const beadsMode = this.getBeadsMode();

    if (beadsMode === 'on') {
      // Check bead artifact for approval
      return this.isApprovedViaBead(featureName);
    }

    // Off mode: check feature.json workflow state
    return this.isApprovedViaFeatureJson(featureName);
  }

  private isApprovedViaBead(featureName: string): boolean {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return false;
    }
    const epicBeadId = epicResult.value;

    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());
    if (!fileExists(planPath)) {
      return false;
    }

    const currentPlanContent = fs.readFileSync(planPath, 'utf-8');
    const currentHash = computePlanHash(currentPlanContent);

    let approvalData: PlanApprovalPayload | null = null;
    try {
      const approvalResult = this.repository.getPlanApproval(epicBeadId);
      if (approvalResult.success === true && approvalResult.value) {
        approvalData = approvalResult.value;
      }
    } catch {
      // Artifact doesn't exist or is invalid - fall through to legacy check
    }

    if (!approvalData) {
      const legacyFeature = this.readLegacyFeatureJson(featureName);
      if (
        legacyFeature?.status === 'approved'
        && legacyFeature.planApprovalHash
        && legacyFeature.planApprovalHash === currentHash
      ) {
        const migratedApproval: PlanApprovalPayload = {
          hash: legacyFeature.planApprovalHash,
          approvedAt: legacyFeature.approvedAt ?? new Date().toISOString(),
          approvedBySession: legacyFeature.sessionId,
        };
        // Migrate to bead artifacts
        this.repository.setPlanApproval(epicBeadId, migratedApproval.hash, migratedApproval.approvedAt, migratedApproval.approvedBySession);
        this.repository.setApprovedPlan(epicBeadId, currentPlanContent, migratedApproval.hash);
        return true;
      }
      return false;
    }

    // Validate hash format
    if (!approvalData.hash || !/^[a-f0-9]{64}$/.test(approvalData.hash)) {
      return false;
    }

    return approvalData.hash === currentHash;
  }

  private isApprovedViaFeatureJson(featureName: string): boolean {
    const feature = this.getFeatureJson(featureName);
    if (!feature || feature.status !== 'approved') {
      return false;
    }
    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());
    if (!fileExists(planPath)) {
      return false;
    }
    const currentPlanContent = fs.readFileSync(planPath, 'utf-8');
    const currentHash = computePlanHash(currentPlanContent);
    if (!feature.planApprovalHash) {
      return true;
    }
    return feature.planApprovalHash === currentHash;
  }

  revokeApproval(featureName: string): void {
    const beadsMode = this.getBeadsMode();
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);

    // Remove bead artifacts in on-mode
    if (beadsMode === 'on' && epicResult.success === true && epicResult.value) {
      const epicBeadId = epicResult.value;
      try {
        // Clear approval artifacts by setting empty values
        this.repository.setPlanApproval(epicBeadId, '', '', undefined);
        this.repository.setApprovedPlan(epicBeadId, '', '');

        // Reset feature state to 'planning' (parity with off-mode)
        const featurePath = getFeatureJsonPath(this.projectRoot, featureName, beadsMode);
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
    
    if (beadsMode === 'off') {
      const featurePath = getFeatureJsonPath(this.projectRoot, featureName, beadsMode);
      const feature = readJson<FeatureJsonWithPlanState>(featurePath);
      if (feature && feature.status === 'approved') {
        feature.status = 'planning';
        delete feature.approvedAt;
        delete feature.planApprovalHash;
        writeJson(featurePath, feature);
      }
    }
  }

  getComments(featureName: string): PlanComment[] {
    if (this.beadsModeProvider.getBeadsMode() === 'on') {
      const beadComments = this.readCommentsFromBead(featureName);
      if (beadComments.length > 0) {
        return beadComments;
      }

      const legacyComments = this.readCommentsFromFeature(featureName);
      if (legacyComments.length > 0) {
        this.writeCommentsToBead(featureName, legacyComments);
      }
      return legacyComments;
    }
    return this.readCommentsFromFeature(featureName);
  }

  addComment(featureName: string, comment: Omit<PlanComment, 'id' | 'timestamp'>): PlanComment {
    const newComment: PlanComment = {
      ...comment,
      id: `comment-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    if (this.beadsModeProvider.getBeadsMode() === 'on') {
      const comments = this.readCommentsFromBead(featureName);
      comments.push(newComment);
      this.writeCommentsToBead(featureName, comments);
    } else {
      const feature = this.getFeatureJson(featureName);
      if (!feature) {
        throw new Error(`Feature '${featureName}' not found`);
      }
      feature.planComments = [...(feature.planComments ?? []), newComment];
      writeJson(getFeatureJsonPath(this.projectRoot, featureName, this.getBeadsMode()), feature);
    }

    // Sync to bead when beadsMode is on
    this.syncPlanComment(featureName, newComment);

    return newComment;
  }

  clearComments(featureName: string): void {
    const beadsMode = this.getBeadsMode();

    if (beadsMode === 'on') {
      this.writeCommentsToBead(featureName, []);
      return;
    }

    const feature = this.getFeatureJson(featureName);
    if (!feature) {
      return;
    }
    feature.planComments = [];
    writeJson(getFeatureJsonPath(this.projectRoot, featureName, beadsMode), feature);
  }

  private readCommentsFromBead(featureName: string): PlanComment[] {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return [];
    }
    const epicBeadId = epicResult.value;
    
    const commentsResult = this.repository.getPlanComments(epicBeadId);
    if (commentsResult.success === false || !commentsResult.value) {
      return [];
    }
    return commentsResult.value;
  }

  private writeCommentsToBead(featureName: string, comments: PlanComment[]): void {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return;
    }
    const epicBeadId = epicResult.value;
    
    this.repository.setPlanComments(epicBeadId, comments);
  }

  private readCommentsFromFeature(featureName: string): PlanComment[] {
    const feature = this.getFeatureJson(featureName);
    return feature?.planComments ?? [];
  }

  private getFeatureJson(featureName: string): FeatureJsonWithPlanState | null {
    return readJson<FeatureJsonWithPlanState>(
      getFeatureJsonPath(this.projectRoot, featureName, this.getBeadsMode()),
    );
  }

  private readLegacyFeatureJson(featureName: string): FeatureJsonWithPlanState | null {
    return (
      readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'on'))
      ?? readJson<FeatureJsonWithPlanState>(getFeatureJsonPath(this.projectRoot, featureName, 'off'))
    );
  }
  private syncPlanDescription(featureName: string, content: string): void {
    if (this.getBeadsMode() === 'off') {
      return;
    }

    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return;
    }
    const epicBeadId = epicResult.value;

    try {
      this.repository.setPlanDescription(epicBeadId, content);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to sync plan description during write for feature '${featureName}' (${epicBeadId}): ${reason}`,
      );
    }
  }

  private syncPlanComment(featureName: string, comment: PlanComment): void {
    if (this.getBeadsMode() === 'off') {
      return;
    }

    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false || !epicResult.value) {
      return;
    }
    const epicBeadId = epicResult.value;

    try {
      const commentText = `[${comment.author}] Line ${comment.line}: ${comment.body}`;
      this.repository.appendPlanComment(epicBeadId, commentText);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to sync plan comment during addComment for feature '${featureName}' (${epicBeadId}): ${reason}`,
      );
    }
  }

  private getBeadsMode(): BeadsMode {
    return this.beadsModeProvider.getBeadsMode();
  }
}
