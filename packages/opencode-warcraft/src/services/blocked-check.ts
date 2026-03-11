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
    let blockedPath = '';

    try {
      blockedPath = path.join(getFeaturePathFn(feature), 'BLOCKED');
      const reason = fs.readFileSync(blockedPath, 'utf-8').trim();
      const message = `⛔ BLOCKED by Commander

${reason || '(No reason provided)'}

The human has blocked this feature. Wait for them to unblock it.
To unblock: Remove ${blockedPath}`;
      return { blocked: true, reason, message, blockedPath };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        // BLOCKED file does not exist — feature is not blocked
        return { blocked: false };
      }

      const detail = err.message || err.code || 'Unknown read failure';
      const resolvedBlockedPath = blockedPath || path.join(`<feature:${feature}>`, 'BLOCKED');
      return {
        blocked: true,
        reason: `Unable to read BLOCKED file: ${detail}`,
        message: `⛔ BLOCKED by Commander

Warcraft could not read ${resolvedBlockedPath}.

Read failure: ${detail}

Treating the feature as blocked so a filesystem error cannot bypass a human safety gate.`,
        blockedPath: blockedPath || undefined,
      };
    }
  };
}
