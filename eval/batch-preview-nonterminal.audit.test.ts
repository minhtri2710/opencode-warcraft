/**
 * Audit: warcraft_batch_execute preview nextAction should not claim
 * "All tasks complete or blocked" when tasks are in failed/partial/cancelled states.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const BATCH_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/batch-tools.ts');
const batchContent = fs.readFileSync(BATCH_TOOLS_PATH, 'utf-8');

describe('batch-tools preview nextAction non-terminal handling', () => {
  it('should not use "All tasks complete or blocked by dependencies" as the only fallback', () => {
    // The old code had a ternary fallback that said "All tasks complete or blocked by dependencies"
    // without checking for failed/partial/cancelled tasks. This is misleading when tasks need attention.
    expect(batchContent).not.toContain('All tasks complete or blocked by dependencies');
  });

  it('should check for non-terminal task statuses (failed/partial/cancelled) before the all-complete fallback', () => {
    // The preview mode should detect tasks in non-terminal states and surface them
    expect(batchContent).toMatch(/failed.*partial.*cancelled|needsAttention|needs.?Attention/i);
  });
});
