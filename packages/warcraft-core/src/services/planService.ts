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
import { BeadGateway } from './beads/BeadGateway.js';
import { syncFeatureBeadLabel } from './beads/syncFeatureBeadLabel.js';
import type { PlanApprovalPayload } from './beads/BeadGateway.types.js';

interface PlanBeadClient {
  addLabel(beadId: string, label: string): void;
  updateDescription(beadId: string, content: string): void;
  addComment(beadId: string, comment: string): void;
  upsertArtifact(beadId: string, kind: 'plan_approval' | 'approved_plan' | 'plan_comments', content: string): void;
  readArtifact(beadId: string, kind: 'plan_approval' | 'approved_plan' | 'plan_comments'): string | null;
}

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
  constructor(
    private projectRoot: string,
    private readonly beadsModeProvider: BeadsModeProvider = new ConfigService(),
    private readonly planBeadClient: PlanBeadClient = new BeadGateway(projectRoot),
  ) {}

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
      const epicBeadId = this.getEpicBeadId(featureName);
      if (epicBeadId) {
        const approvalPayload: PlanApprovalPayload = {
          hash: planHash,
          approvedAt: timestamp,
          approvedBySession: sessionId,
        };
        this.planBeadClient.upsertArtifact(epicBeadId, 'plan_approval', JSON.stringify(approvalPayload));
        // Store full approved plan snapshot
        this.planBeadClient.upsertArtifact(epicBeadId, 'approved_plan', planContent);
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

    this.syncPlanBeadLabel(featureName, true);
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
    const epicBeadId = this.getEpicBeadId(featureName);
    if (!epicBeadId) {
      return false;
    }

    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());
    if (!fileExists(planPath)) {
      return false;
    }

    const currentPlanContent = fs.readFileSync(planPath, 'utf-8');
    const currentHash = computePlanHash(currentPlanContent);

    let approvalData: PlanApprovalPayload | null = null;
    try {
      const artifactContent = this.planBeadClient.readArtifact(epicBeadId, 'plan_approval');
      if (artifactContent) {
        approvalData = JSON.parse(artifactContent) as PlanApprovalPayload;
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
        this.planBeadClient.upsertArtifact(epicBeadId, 'plan_approval', JSON.stringify(migratedApproval));
        this.planBeadClient.upsertArtifact(epicBeadId, 'approved_plan', currentPlanContent);
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
    const epicBeadId = this.getEpicBeadId(featureName);

    // Remove bead artifacts in on-mode
    if (beadsMode === 'on' && epicBeadId) {
      try {
        // Upsert with empty content effectively removes the artifacts
        this.planBeadClient.upsertArtifact(epicBeadId, 'plan_approval', '');
        this.planBeadClient.upsertArtifact(epicBeadId, 'approved_plan', '');
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

    this.syncPlanBeadLabel(featureName, false);
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
    const epicBeadId = this.getEpicBeadId(featureName);
    if (!epicBeadId) {
      return [];
    }
    const content = this.planBeadClient.readArtifact(epicBeadId, 'plan_comments');
    if (!content) {
      return [];
    }
    try {
      const parsed = JSON.parse(content) as CommentsJson;
      return parsed.threads ?? [];
    } catch {
      return [];
    }
  }

  private writeCommentsToBead(featureName: string, comments: PlanComment[]): void {
    const epicBeadId = this.getEpicBeadId(featureName);
    if (!epicBeadId) {
      return;
    }
    this.planBeadClient.upsertArtifact(epicBeadId, 'plan_comments', JSON.stringify({ threads: comments }));
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

  private syncPlanBeadLabel(featureName: string, approved: boolean): void {
    syncFeatureBeadLabel({
      projectRoot: this.projectRoot,
      featureName,
      label: approved ? 'plan-approved' : 'plan-revoked',
      context: approved ? 'approve plan' : 'revoke plan approval',
      warningPrefix: 'plan label',
      beadsModeProvider: this.beadsModeProvider,
      client: this.planBeadClient,
    });
  }

  private getEpicBeadId(featureName: string): string | null {
    const feature = readJson<{ epicBeadId?: string }>(
      getFeatureJsonPath(this.projectRoot, featureName, this.getBeadsMode()),
    );
    if (feature?.epicBeadId) {
      return feature.epicBeadId;
    }

    if (this.getBeadsMode() === 'on') {
      const epics = new BeadGateway(this.projectRoot).list({ type: 'epic', status: 'all' });
      const epic = epics.find((entry) => entry.title === featureName);
      return epic?.id ?? null;
    }

    return feature?.epicBeadId ?? null;
  }

  private syncPlanDescription(featureName: string, content: string): void {
    if (this.getBeadsMode() === 'off') {
      return;
    }

    const epicBeadId = this.getEpicBeadId(featureName);
    if (!epicBeadId) {
      return;
    }

    try {
      this.planBeadClient.updateDescription(epicBeadId, content);
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

    const epicBeadId = this.getEpicBeadId(featureName);
    if (!epicBeadId) {
      return;
    }

    try {
      const commentText = `[${comment.author}] Line ${comment.line}: ${comment.body}`;
      this.planBeadClient.addComment(epicBeadId, commentText);
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
