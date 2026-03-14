/**
 * Audit test: warcraft_worktree_commit must reject completion/failure/partial
 * from a blocked task before performing side effects (git commit, report write).
 *
 * Bug: The tool allowed blocked tasks through the initial status check but only
 * caught the invalid transition (blocked → done/failed/partial) at the
 * taskService.transition() call — AFTER side effects (git commit, report write)
 * had already occurred. This guard catches the invalid statuses early.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

const SOURCE = fs.readFileSync('packages/opencode-warcraft/src/tools/worktree-tools.ts', 'utf-8');

describe('warcraft_worktree_commit blocked task transition guard', () => {
  it('should have an early guard for blocked tasks attempting non-blocked/non-cancelled statuses', () => {
    // The guard must exist BEFORE the completion gates check
    const blockedGuardIndex = SOURCE.indexOf("taskInfo.status === 'blocked' && status !== 'blocked'");
    const completionGatesIndex = SOURCE.indexOf("status === 'completed'", SOURCE.indexOf('GATE: Check for explicit'));

    expect(blockedGuardIndex).toBeGreaterThan(-1);
    expect(completionGatesIndex).toBeGreaterThan(-1);
    expect(blockedGuardIndex).toBeLessThan(completionGatesIndex);
  });

  it('should mention resuming via warcraft_worktree_create in the error message', () => {
    expect(SOURCE).toContain('warcraft_worktree_create(continueFrom: "blocked"');
  });

  it('should allow cancelled status from blocked tasks', () => {
    // The guard should only block completion/failure/partial, not cancellation
    // since blocked → cancelled is a valid state machine transition
    expect(SOURCE).toContain("const allowed = ['cancelled']");
  });
});
