/**
 * Fresh-eye audit: dispatch-coordinator.ts JSDoc should not claim the
 * dispatch always creates/reuses worktrees — direct mode is supported.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DC_PATH = join(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'services',
  'dispatch-coordinator.ts',
);

const source = readFileSync(DC_PATH, 'utf-8');

describe('dispatch-coordinator JSDoc workspace wording audit', () => {
  it('class JSDoc should not say "Create/reuse worktree" unconditionally', () => {
    const classJsdoc = source.slice(source.indexOf('Lock/acquire'), source.indexOf('Lock/acquire') + 200);
    expect(classJsdoc).not.toMatch(/Create\/reuse worktree/);
  });

  it('dispatch method JSDoc should not say "single-task (worktree)"', () => {
    const methodJsdoc = source.slice(source.indexOf('single-task'), source.indexOf('single-task') + 100);
    expect(methodJsdoc).not.toMatch(/single-task \(worktree\)/);
  });
});
