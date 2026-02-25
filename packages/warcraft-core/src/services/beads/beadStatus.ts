import type { TaskStatusType, FeatureStatusType } from '../../types.js';

/**
 * Map bead status to task status.
 *
 * This centralizes the bead-to-task status mapping used across services.
 *
 * @param beadStatus - The raw bead status string from beads CLI
 * @returns The corresponding TaskStatusType
 */
export function mapBeadStatusToTaskStatus(beadStatus: string): TaskStatusType {
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
    case 'deferred':
      return 'blocked';
    case 'open':
    case 'pinned':
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
    case 'open':
    default:
      return 'planning';
  }
}
