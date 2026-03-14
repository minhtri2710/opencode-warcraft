/**
 * Audit: warcraft skill tool reference table should not use misleading descriptions
 * for warcraft_worktree_discard — must not imply file changes are always discarded.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SKILL_PATH = path.resolve('packages/opencode-warcraft/skills/warcraft/SKILL.md');
const skillContent = fs.readFileSync(SKILL_PATH, 'utf-8');

describe('warcraft skill tool reference table accuracy', () => {
  it('warcraft_worktree_discard should not be described as just "Discard task" in tool table', () => {
    // "Discard task" implies file changes are always discarded, but in direct mode they are not.
    // The description should reflect abort/reset semantics, not unconditional discard.
    const tableRow = skillContent.match(/warcraft_worktree_discard[^|]*\|[^|]+\|/);
    expect(tableRow).toBeTruthy();
    // Should not say just "Discard task" or "Discard changes"
    expect(tableRow![0]).not.toMatch(/Discard task\s*\|/);
  });
});
