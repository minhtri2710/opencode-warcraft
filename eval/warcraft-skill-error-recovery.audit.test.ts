/**
 * Audit: warcraft skill "Error Recovery - Task Failed" must mention the returned task() call
 * after warcraft_worktree_create, consistent with every other delegation example in the codebase.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SKILL_PATH = path.resolve('packages/opencode-warcraft/skills/warcraft/SKILL.md');
const skillContent = fs.readFileSync(SKILL_PATH, 'utf-8');

describe('warcraft skill error recovery delegation contract', () => {
  it('Task Failed section should mention issuing the returned task() call after warcraft_worktree_create', () => {
    // Find the "Task Failed" section
    const taskFailedMatch = skillContent.match(/### Task Failed[\s\S]*?(?=###|\n---|Z)/);
    expect(taskFailedMatch).toBeTruthy();

    const section = taskFailedMatch![0];

    // The section should mention the task() call, not just warcraft_worktree_create
    expect(section).toMatch(/task\(\)/i);
  });
});
