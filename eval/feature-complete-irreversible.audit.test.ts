import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('warcraft_feature_complete description accuracy audit', () => {
  const featureToolsSrc = readFileSync('packages/opencode-warcraft/src/tools/feature-tools.ts', 'utf-8');

  it('should not claim feature completion is irreversible', () => {
    // Feature completion IS reversible: syncCompletionFromTasks() in featureService.ts
    // automatically reopens completed features if any task moves away from 'done'.
    // Claiming "irreversible" misleads agents about the permanence of the operation.
    expect(featureToolsSrc).not.toMatch(/irreversible/i);
  });
});
