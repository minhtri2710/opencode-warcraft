/**
 * Audit: getNextAction should not have a dead 'review' planStatus branch.
 * No FeatureStatusType maps to planStatus 'review' — the mapping is:
 * planning→draft, approved→approved, executing→locked, else→none.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const CONTEXT_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/context-tools.ts');
const contextContent = fs.readFileSync(CONTEXT_TOOLS_PATH, 'utf-8');

describe('getNextAction dead planStatus branch', () => {
  it('should not have a planStatus === review branch (unreachable dead code)', () => {
    // The planStatus mapping never produces 'review':
    // planning→draft, approved→approved, executing→locked, else→none
    // A 'review' branch would be dead code that misleads contributors.
    expect(contextContent).not.toMatch(/planStatus\s*===\s*['"]review['"]/);
  });
});
