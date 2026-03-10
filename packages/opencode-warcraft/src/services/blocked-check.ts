import * as fs from 'fs';
import * as path from 'path';
import type { BlockedResult } from '../types.js';

// ============================================================================
// Blocked Check Service
// Checks whether a feature is blocked by a human-placed BLOCKED file.
// ============================================================================

/**
 * Create a checkBlocked function that reads a BLOCKED file from the feature path.
 *
 * @param getFeaturePathFn - Function that resolves a feature name to its directory path.
 */
export function createCheckBlocked(getFeaturePathFn: (feature: string) => string): (feature: string) => BlockedResult {
  return (feature: string): BlockedResult => {
    const blockedPath = path.join(getFeaturePathFn(feature), 'BLOCKED');
    try {
      const reason = fs.readFileSync(blockedPath, 'utf-8').trim();
      const message = `⛔ BLOCKED by Commander

${reason || '(No reason provided)'}

The human has blocked this feature. Wait for them to unblock it.
To unblock: Remove ${blockedPath}`;
      return { blocked: true, reason, message, blockedPath };
    } catch {
      // BLOCKED file does not exist — feature is not blocked
      return { blocked: false };
    }
  };
}
