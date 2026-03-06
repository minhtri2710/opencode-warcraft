import type { BeadsMode, PlanReadResult } from '../types.js';
import { fileExists, readText, writeText } from '../utils/fs.js';
import { getPlanPath } from '../utils/paths.js';
import type { PlanStore } from './state/types.js';

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

    const isApproved = this.store.isApproved(featureName, content);

    return {
      content,
      status: isApproved ? 'approved' : 'planning',
    };
  }

  /**
   * Approve the current plan.
   * Optionally accepts already-read plan content to avoid re-reading plan.md.
   */
  approve(featureName: string, sessionId?: string, preloadedContent?: string): void {
    let planContent = preloadedContent ?? null;

    if (planContent === null) {
      const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
      if (!fileExists(planPath)) {
        throw new Error(`No plan.md found for feature '${featureName}'`);
      }
      planContent = readText(planPath);
      if (planContent === null) {
        throw new Error(`No plan.md found for feature '${featureName}'`);
      }
    }

    const timestamp = new Date().toISOString();
    this.store.approve(featureName, planContent, timestamp, sessionId);
  }

  isApproved(featureName: string): boolean {
    const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
    if (!fileExists(planPath)) {
      return false;
    }

    const currentPlanContent = readText(planPath);
    if (currentPlanContent === null) {
      return false;
    }
    return this.store.isApproved(featureName, currentPlanContent);
  }

  revokeApproval(featureName: string): void {
    this.store.revokeApproval(featureName);
  }
}
