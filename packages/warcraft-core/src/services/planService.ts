import {
  getPlanPath,
} from '../utils/paths.js';
import { readText, writeText, fileExists } from '../utils/fs.js';
import type { PlanComment, PlanReadResult } from '../types.js';
import type { BeadsMode } from '../types.js';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { PlanStore } from './state/types.js';

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
    private readonly store: PlanStore,
    private readonly beadsMode: BeadsMode = 'on',
  ) {}

  write(featureName: string, content: string): string {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);

    // Check if plan content actually changed (for approval invalidation)
    const currentContent = readText(planPath);
    const contentChanged = currentContent !== null && currentContent !== content;

    writeText(planPath, content);

    this.store.setComments(featureName, []);

    // Invalidate approval if plan changed
    if (contentChanged) {
      this.store.revokeApproval(featureName);
    }

    // Sync plan description to external store
    this.store.syncPlanDescription(featureName, content);

    return planPath;
  }

  read(featureName: string): PlanReadResult | null {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
    const content = readText(planPath);
    
    if (content === null) return null;

    const comments = this.store.getComments(featureName);
    const currentHash = computePlanHash(content);
    const isApproved = this.store.isApproved(featureName, currentHash);

    return {
      content,
      status: isApproved ? 'approved' : 'planning',
      comments,
    };
  }

  approve(featureName: string, sessionId?: string): void {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
    if (!fileExists(planPath)) {
      throw new Error(`No plan.md found for feature '${featureName}'`);
    }

    const planContent = fs.readFileSync(planPath, 'utf-8');
    const planHash = computePlanHash(planContent);
    const timestamp = new Date().toISOString();

    this.store.approve(featureName, planContent, planHash, timestamp, sessionId);
  }

  isApproved(featureName: string): boolean {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
    if (!fileExists(planPath)) {
      return false;
    }

    const currentPlanContent = fs.readFileSync(planPath, 'utf-8');
    const currentHash = computePlanHash(currentPlanContent);
    return this.store.isApproved(featureName, currentHash);
  }

  revokeApproval(featureName: string): void {
    this.store.revokeApproval(featureName);
  }

  getComments(featureName: string): PlanComment[] {
    return this.store.getComments(featureName);
  }

  addComment(featureName: string, comment: Omit<PlanComment, 'id' | 'timestamp'>): PlanComment {
    const newComment: PlanComment = {
      ...comment,
      id: `comment-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };

    const comments = this.store.getComments(featureName);
    this.store.setComments(featureName, [...comments, newComment]);

    this.store.syncPlanComment(featureName, newComment);

    return newComment;
  }

  clearComments(featureName: string): void {
    this.store.setComments(featureName, []);
  }
}
