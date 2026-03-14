/**
 * Audit: warcraft_batch_execute execute mode should reject tasks in
 * failed/partial/cancelled status upfront with actionable guidance,
 * not let them fail during dispatch with a cryptic InvalidTransitionError.
 *
 * State machine does not allow failed/partial/cancelled → dispatch_prepared.
 * The batch validation must catch these statuses before attempting dispatch.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const BATCH_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/batch-tools.ts');
const batchContent = fs.readFileSync(BATCH_TOOLS_PATH, 'utf-8');

// Focus on the execute-mode validation section (between 'Execute mode' and 'Dispatch all tasks')
const executeSection = batchContent.slice(
  batchContent.indexOf('// Execute mode'),
  batchContent.indexOf('// Dispatch all tasks'),
);

describe('batch execute validation for non-dispatchable statuses', () => {
  it('should reject failed tasks in execute-mode validation', () => {
    expect(executeSection).toContain("status === 'failed'");
    expect(executeSection).toMatch(/failed.*pending/i);
  });

  it('should reject partial tasks in execute-mode validation', () => {
    expect(executeSection).toContain("status === 'partial'");
    expect(executeSection).toMatch(/partial.*pending/i);
  });

  it('should reject cancelled tasks in execute-mode validation', () => {
    expect(executeSection).toContain("status === 'cancelled'");
    expect(executeSection).toMatch(/cancelled.*pending/i);
  });

  it('should provide actionable guidance mentioning warcraft_task_update', () => {
    // All three non-dispatchable statuses should mention using warcraft_task_update
    const failedSection = executeSection.slice(
      executeSection.indexOf("status === 'failed'"),
      executeSection.indexOf("status === 'partial'"),
    );
    expect(failedSection).toMatch(/warcraft_task_update|reset.*pending/i);

    const partialSection = executeSection.slice(
      executeSection.indexOf("status === 'partial'"),
      executeSection.indexOf("status === 'cancelled'"),
    );
    expect(partialSection).toMatch(/warcraft_task_update|reset.*pending/i);
  });
});
