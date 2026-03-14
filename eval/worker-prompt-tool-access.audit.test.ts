/**
 * Audit: Worker prompt "Tool Access" section must match Mekkatorque's actual permission allowlist.
 *
 * The worker prompt tells Mekkatorque which tools it has access to. If the prompt
 * claims access to a tool that tool-permissions.ts denies, the worker will attempt
 * calls that fail at runtime with permission errors.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const WORKER_PROMPT_PATH = path.resolve('packages/opencode-warcraft/src/utils/worker-prompt.ts');
const TOOL_PERMISSIONS_PATH = path.resolve('packages/opencode-warcraft/src/agents/tool-permissions.ts');

const workerPromptSrc = fs.readFileSync(WORKER_PROMPT_PATH, 'utf-8');
const toolPermissionsSrc = fs.readFileSync(TOOL_PERMISSIONS_PATH, 'utf-8');

describe('worker prompt tool access vs Mekkatorque permissions', () => {
  it('should not claim access to warcraft_worktree_discard (not in Mekkatorque allowlist)', () => {
    // Extract Mekkatorque's allowlist from tool-permissions.ts
    const mekkatorqueMatch = toolPermissionsSrc.match(/mekkatorque:\s*\[([^\]]+)\]/);
    expect(mekkatorqueMatch).toBeTruthy();
    const mekkatorqueTools = mekkatorqueMatch![1];

    // warcraft_worktree_discard must NOT be in Mekkatorque's allowlist
    expect(mekkatorqueTools).not.toContain('warcraft_worktree_discard');

    // The "You have access to" section in worker prompt should NOT list warcraft_worktree_discard
    // Find the section between "You have access to" and "You do NOT have access to"
    const accessSection = workerPromptSrc.match(/\*\*You have access to:\*\*[\s\S]*?\*\*You do NOT have access to/);
    expect(accessSection).toBeTruthy();

    expect(accessSection![0]).not.toContain('warcraft_worktree_discard');
  });

  it('should list warcraft_worktree_discard in the "do NOT have access to" section', () => {
    // Since Mekkatorque cannot use warcraft_worktree_discard, the worker prompt
    // should tell the worker NOT to use it (to avoid confusion).
    const noAccessSection = workerPromptSrc.match(/\*\*You do NOT have access to[\s\S]*?---/);
    expect(noAccessSection).toBeTruthy();

    expect(noAccessSection![0]).toContain('warcraft_worktree_discard');
  });

  it('every tool claimed in "You have access to" should be in Mekkatorque allowlist', () => {
    // Extract Mekkatorque's actual allowlist
    const mekkatorqueMatch = toolPermissionsSrc.match(/mekkatorque:\s*\[([^\]]+)\]/);
    expect(mekkatorqueMatch).toBeTruthy();
    const mekkatorqueAllowlist = mekkatorqueMatch![1]
      .split(',')
      .map((s: string) => s.trim().replace(/['"]/g, ''))
      .filter(Boolean);

    // Extract warcraft_* tools from the "You have access to" section
    const accessSection = workerPromptSrc.match(/\*\*You have access to:\*\*([\s\S]*?)\*\*You do NOT have access to/);
    expect(accessSection).toBeTruthy();

    const claimedTools = [...accessSection![1].matchAll(/warcraft_\w+/g)].map((m) => m[0]);
    expect(claimedTools.length).toBeGreaterThan(0);

    for (const tool of claimedTools) {
      expect(mekkatorqueAllowlist).toContain(tool);
    }
  });
});
