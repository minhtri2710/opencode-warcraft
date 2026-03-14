import type { FeatureJson } from '../../types.js';
import { readJson, writeJson } from '../../utils/fs.js';
import { getFeatureJsonPath } from '../../utils/paths.js';
import { type BeadsRepository, throwIfInitFailure } from '../beads/BeadsRepository.js';
import type { PlanStore } from './types.js';

/**
 * PlanStore backed by bead label + description equality (beadsMode='on').
 *
 * Approval semantics:
 * 1. Epic bead has the 'approved' label.
 * 2. plan.md content matches the epic description plan section.
 *
 * Local feature.json is updated for status/timestamps but is NOT the source of truth for approval.
 */
export class BeadsPlanStore implements PlanStore {
  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

  approve(featureName: string, planContent: string, timestamp: string, sessionId?: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    // Sync plan content into epic description
    const descResult = this.repository.setPlanDescription(epicBeadId, planContent);
    if (descResult.success === false) {
      throwIfInitFailure(descResult.error, '[warcraft] Failed to sync plan description during approval');
      console.warn(`[warcraft] Failed to sync plan description during approval: ${descResult.error.message}`);
    }

    // Add the 'approved' label
    const addLabelResult = this.repository.addWorkflowLabel(epicBeadId, 'approved');
    if (addLabelResult.success === false) {
      throwIfInitFailure(addLabelResult.error, '[warcraft] Failed to apply approved workflow label');
      console.warn(`[warcraft] Failed to apply approved workflow label: ${addLabelResult.error.message}`);
    }

    // Update local feature.json cache
    const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
    const feature = readJson<FeatureJson>(featurePath);
    if (feature) {
      feature.status = 'approved';
      feature.approvedAt = timestamp;
      if (sessionId) {
        feature.sessionId = sessionId;
      }
      writeJson(featurePath, feature);
    }
  }

  isApproved(featureName: string, planContent: string): boolean {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return false;

    // Check the 'approved' label
    const hasLabel = this.repository.hasWorkflowLabel(epicBeadId, 'approved');
    if (hasLabel.success === false || !hasLabel.value) return false;

    // Compare plan.md content with epic description
    const descResult = this.repository.getPlanDescription(epicBeadId);
    if (descResult.success === false) {
      throwIfInitFailure(descResult.error, `[warcraft] Failed to read plan description for feature '${featureName}'`);
      return false;
    }

    const epicDescription = descResult.value;
    if (!epicDescription) return false;

    return epicDescription === planContent;
  }

  revokeApproval(featureName: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    // Remove the 'approved' label
    const removeLabelResult = this.repository.removeWorkflowLabel(epicBeadId, 'approved');
    if (removeLabelResult.success === false) {
      throwIfInitFailure(
        removeLabelResult.error,
        `[warcraft] Failed to revoke plan approval for feature '${featureName}'`,
      );
    }

    // Reset local feature.json
    const featurePath = getFeatureJsonPath(this.projectRoot, featureName, 'on');
    const feature = readJson<FeatureJson>(featurePath);
    if (feature && feature.status === 'approved') {
      feature.status = 'planning';
      delete feature.approvedAt;
      writeJson(featurePath, feature);
    }
  }

  syncPlanDescription(featureName: string, content: string): void {
    const epicBeadId = this.resolveEpic(featureName);
    if (!epicBeadId) return;

    const result = this.repository.setPlanDescription(epicBeadId, content);
    if (result.success === false) {
      throwIfInitFailure(result.error, `[warcraft] Failed to sync plan description for feature '${featureName}'`);
      console.warn(`[warcraft] Failed to sync plan description for feature '${featureName}': ${result.error.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolveEpic(featureName: string): string | null {
    const epicResult = this.repository.getEpicByFeatureName(featureName, false);
    if (epicResult.success === false) {
      throwIfInitFailure(epicResult.error, `Failed to resolve epic for feature '${featureName}'`);
      return null;
    }
    if (!epicResult.value) {
      return null;
    }
    return epicResult.value;
  }
}
