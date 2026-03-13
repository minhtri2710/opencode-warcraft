import { describe, expect, it } from 'bun:test';
import { KHADGAR_PROMPT } from '../packages/opencode-warcraft/src/agents/khadgar.js';
import { SAURFANG_PROMPT } from '../packages/opencode-warcraft/src/agents/saurfang.js';

describe('Agent worktree delegation audit', () => {
  it('documents Khadgar worktree delegation as requiring an explicit returned task() call', () => {
    expect(KHADGAR_PROMPT).toContain('task() payload');
    expect(KHADGAR_PROMPT).toContain('Issue the returned `task()` call');
    expect(KHADGAR_PROMPT).not.toContain('creates worktree + Mekkatorque');
  });

  it('documents Saurfang worktree delegation as requiring an explicit returned task() call', () => {
    expect(SAURFANG_PROMPT).toContain('task() payload');
    expect(SAURFANG_PROMPT).toContain('Issue the returned `task()` call');
    expect(SAURFANG_PROMPT).not.toContain('Creates worktree + Mekkatorque');
  });
});
