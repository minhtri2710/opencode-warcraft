import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('plan-authoring.md workspace wording audit', () => {
  const planAuthoringSrc = readFileSync('docs/plan-authoring.md', 'utf-8');

  it('should not claim workers always operate in isolated worktrees', () => {
    // In direct mode, workers operate in the project root, not isolated worktrees.
    expect(planAuthoringSrc).not.toMatch(/operate in isolated worktrees/i);
  });
});
