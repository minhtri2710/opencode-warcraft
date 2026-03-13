/**
 * Fresh-eye audit: batch-tools preview nextAction should mention the full
 * delegation contract — after warcraft_batch_execute, the orchestrator must
 * issue all returned task() calls in the same assistant message.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BATCH_TOOLS_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'tools', 'batch-tools.ts');

const source = readFileSync(BATCH_TOOLS_PATH, 'utf-8');

describe('Batch preview nextAction audit', () => {
  it('preview nextAction should mention issuing returned task() calls after execute', () => {
    // The preview nextAction currently only says to call warcraft_batch_execute
    // with mode "execute", but doesn't mention the required follow-up: issuing
    // all returned task() calls in the same assistant message.
    const nextActionBlock = source.slice(source.indexOf('nextAction:'), source.indexOf('nextAction:') + 400);
    expect(nextActionBlock).toMatch(/task\(\)/);
  });
});
