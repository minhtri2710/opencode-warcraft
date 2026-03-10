import type { FeatureStatusType, TaskStatusType } from '../../types.js';

/**
 * Map bead status to task status.
 *
 * This centralizes the bead-to-task status mapping used across services.
 *
 * @param beadStatus - The raw bead status string from beads CLI
 * @param labels - Optional labels attached to the bead (used to disambiguate deferred states)
 * @returns The corresponding TaskStatusType
 */
export function mapBeadStatusToTaskStatus(beadStatus: string, labels?: string[]): TaskStatusType {
  if (!beadStatus) return 'pending';
  switch (beadStatus.toLowerCase()) {
    case 'closed':
    case 'tombstone':
      return 'done';
    case 'in_progress':
    case 'review':
    case 'hooked':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'deferred': {
      if (labels?.includes('failed')) return 'failed';
      if (labels?.includes('partial')) return 'partial';
      if (labels?.includes('cancelled')) return 'cancelled';
      return 'blocked';
    }
    default:
      return 'pending';
  }
}

/**
 * Map bead status to feature status.
 *
 * This centralizes the bead-to-feature status mapping used across services.
 *
 * @param beadStatus - The raw bead status string from beads CLI
 * @returns The corresponding FeatureStatusType
 */
export function mapBeadStatusToFeatureStatus(beadStatus: string): FeatureStatusType {
  if (!beadStatus) return 'planning';
  switch (beadStatus.toLowerCase()) {
    case 'closed':
    case 'tombstone':
      return 'completed';
    case 'in_progress':
    case 'blocked':
    case 'deferred':
    case 'pinned':
    case 'hooked':
    case 'review':
      return 'executing';
    default:
      return 'planning';
  }
}
