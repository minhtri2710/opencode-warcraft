/**
 * Audit: warcraft_status getNextAction must not say "All tasks complete" when tasks
 * are in non-terminal states (failed, partial, cancelled, blocked).
 *
 * The getNextAction function checks for in_progress, runnable, and pending tasks,
 * but its fallback says "All tasks complete" even when tasks are failed/partial/cancelled/blocked.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const CONTEXT_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/context-tools.ts');
const contextToolsSrc = fs.readFileSync(CONTEXT_TOOLS_PATH, 'utf-8');

describe('warcraft_status getNextAction non-terminal task handling', () => {
  it('should check for failed/partial/cancelled/blocked task statuses before the "All tasks complete" fallback', () => {
    // Extract just the code between the pending check and the "All tasks complete" fallback.
    // If the function properly handles non-terminal statuses, there should be checks
    // for these statuses BETWEEN the pending check and the fallback.
    const betweenPendingAndFallback = contextToolsSrc.match(/if \(pending\)[\s\S]*?return 'All tasks complete/);
    expect(betweenPendingAndFallback).toBeTruthy();

    const section = betweenPendingAndFallback![0];

    // Between the pending check and the "All tasks complete" message,
    // there should be checks for non-terminal task statuses.
    // If there's no check for 'failed' status, the function wrongly claims
    // all tasks are complete when some have failed.
    const checksForFailed = section.includes('failed');
    const checksForPartial = section.includes('partial');
    const checksForCancelled = section.includes('cancelled');
    const checksForBlocked = /status.*===.*['"]blocked['"]|['"]blocked['"].*===.*status/.test(section);

    // At minimum, the function should check for failed tasks before claiming completion.
    // A feature with failed tasks is NOT complete.
    expect(checksForFailed || checksForPartial || checksForCancelled || checksForBlocked).toBe(true);
  });
});
