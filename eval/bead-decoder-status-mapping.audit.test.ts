/**
 * Audit: decodeTasksFromDepList must use the canonical mapBeadStatusToTaskStatus.
 *
 * Bug: beadDecoders.ts had a local BEAD_STATUS_TO_TASK map with only 2 entries
 * (closed→done, deferred→blocked), while the canonical mapper in beadStatus.ts
 * handles 8+ bead statuses including in_progress, review, hooked, and blocked.
 * Tasks with those bead statuses were incorrectly decoded as 'pending'.
 *
 * Fix: Replaced the incomplete local map with an import of mapBeadStatusToTaskStatus
 * from beadStatus.ts, eliminating the duplicate mapping.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

describe('beadDecoders status mapping audit', () => {
  const decodersPath = 'packages/warcraft-core/src/services/beads/beadDecoders.ts';
  const source = fs.readFileSync(decodersPath, 'utf-8');

  it('should not have a local BEAD_STATUS_TO_TASK map', () => {
    // The local incomplete map has been replaced with the canonical mapper
    expect(source).not.toContain('BEAD_STATUS_TO_TASK');
  });

  it('should import mapBeadStatusToTaskStatus from beadStatus', () => {
    // The canonical mapper should be imported for consistent status mapping
    expect(source).toContain("import { mapBeadStatusToTaskStatus } from './beadStatus.js'");
  });

  it('should use mapBeadStatusToTaskStatus in decodeTasksFromDepList', () => {
    // The decode function must use the canonical mapper, not a local fallback
    expect(source).toContain('mapBeadStatusToTaskStatus(item.status)');
  });
});
