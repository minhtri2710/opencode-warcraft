/**
 * Fresh-eye audit: The blocked-resume CRITICAL note in index.ts should not
 * claim the new worker always runs in the SAME worktree — in direct mode
 * it runs in the SAME workspace (project root).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'index.ts');

const source = readFileSync(INDEX_PATH, 'utf-8');

describe('index.ts blocked-resume CRITICAL wording audit', () => {
  it('should not claim the resumed worker always runs in the SAME worktree', () => {
    // The CRITICAL note says "in the SAME worktree" but in direct mode the
    // worker runs in the SAME workspace (project root).
    const criticalBlock = source.slice(source.indexOf('**CRITICAL**'), source.indexOf('**CRITICAL**') + 200);
    expect(criticalBlock).not.toMatch(/SAME worktree/i);
  });
});
