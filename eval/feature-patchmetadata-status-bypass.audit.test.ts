/**
 * Audit: featureService.patchMetadata must block status changes.
 *
 * Bug: patchMetadata accepted Partial<FeatureJson> including status, allowing callers
 * to bypass the normal feature lifecycle (updateStatus/complete/syncCompletionFromTasks).
 * In beads mode, this would desync the feature.json status from the bead state because
 * patchMetadata calls store.save() which doesn't trigger bead close/reopen.
 * It also skips timestamp management (completedAt, approvedAt).
 *
 * Fix: Added 'status' to the immutable keys list in patchMetadata. Status changes
 * must go through updateStatus(), complete(), or syncCompletionFromTasks().
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

describe('featureService.patchMetadata status bypass audit', () => {
  const servicePath = 'packages/warcraft-core/src/services/featureService.ts';
  const source = fs.readFileSync(servicePath, 'utf-8');

  it('should include status in the immutable keys list', () => {
    // The immutableKeys array must contain 'status' to prevent lifecycle bypass
    const immutableLine = source.match(/const immutableKeys.*=\s*\[([^\]]+)\]/);
    expect(immutableLine).not.toBeNull();
    expect(immutableLine![1]).toContain("'status'");
  });

  it('should block name, epicBeadId, createdAt, and status', () => {
    // All four fields must be blocked
    const immutableLine = source.match(/const immutableKeys.*=\s*\[([^\]]+)\]/);
    expect(immutableLine).not.toBeNull();
    const fields = immutableLine![1];
    expect(fields).toContain("'name'");
    expect(fields).toContain("'epicBeadId'");
    expect(fields).toContain("'createdAt'");
    expect(fields).toContain("'status'");
  });
});
