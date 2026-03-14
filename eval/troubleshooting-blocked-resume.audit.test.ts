import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('troubleshooting.md blocked-resume wording audit', () => {
  const troubleshootingSrc = readFileSync('docs/troubleshooting.md', 'utf-8');

  it('should not say worker "spawns in the same worktree" for blocked resume', () => {
    // In direct mode there is no worktree, and the worker is launched via task() call, not spawned.
    expect(troubleshootingSrc).not.toMatch(/spawns? in the same worktree/i);
  });

  it('should mention the returned task() call in blocked resume guidance', () => {
    // The blocked resume creates a task() call that must be issued explicitly.
    expect(troubleshootingSrc).toMatch(/task\(\)/);
  });
});
