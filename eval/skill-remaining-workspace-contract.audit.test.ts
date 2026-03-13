import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const REGISTRY_PATH = path.resolve(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'skills',
  'registry.generated.ts',
);
const registrySource = readFileSync(REGISTRY_PATH, 'utf-8');

describe('Remaining skill workspace contract audit', () => {
  it('does not describe single-task warcraft execution as implementing in a worktree unconditionally', () => {
    expect(registrySource).not.toContain('[Mekkatorque implements in worktree]');
  });

  it('does not tell writing-plans users to open a new session specifically in a worktree', () => {
    expect(registrySource).not.toContain('Guide them to open new session in worktree');
  });
});
