/**
 * Fresh-eye audit: Mekkatorque exported metadata and JSDoc comments must not
 * claim the worker always executes in isolated worktrees — direct mode is supported.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MEKKATORQUE_PATH = join(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'agents',
  'mekkatorque.ts',
);
const INDEX_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'agents', 'index.ts');

const mekkatorqueSrc = readFileSync(MEKKATORQUE_PATH, 'utf-8');
const indexSrc = readFileSync(INDEX_PATH, 'utf-8');

describe('Mekkatorque residual worktree-only claims', () => {
  it('exported mekkatorqueAgent.description should not say "Isolated worktree"', () => {
    // The exported agent metadata still claims "Isolated worktree." which
    // implies direct mode is not supported.
    const descLine = mekkatorqueSrc.match(/description:\s*['"]([^'"]+)['"]/)?.[1] ?? '';
    expect(descLine.toLowerCase()).not.toContain('isolated worktree');
  });

  it('agents/index.ts JSDoc should not say mekkatorque "executes tasks in worktrees"', () => {
    // The JSDoc describes mekkatorque as "(executes tasks in worktrees)" but
    // direct mode is a supported runtime path.
    expect(indexSrc).not.toMatch(/mekkatorque.*executes tasks in worktrees/i);
  });
});
