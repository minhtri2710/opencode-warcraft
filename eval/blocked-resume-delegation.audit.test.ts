import { describe, expect, it } from 'bun:test';
import { KHADGAR_PROMPT } from '../packages/opencode-warcraft/src/agents/khadgar.js';
import { SAURFANG_PROMPT } from '../packages/opencode-warcraft/src/agents/saurfang.js';

describe('Blocked resume delegation audit', () => {
  it('tells Khadgar to issue the returned task() call after warcraft_worktree_create resumes a blocked task', () => {
    expect(KHADGAR_PROMPT).toContain('continueFrom: "blocked", decision');
    expect(KHADGAR_PROMPT).toMatch(/Issue the (newly )?returned\s+`?task\(\)`? call/i);
  });

  it('tells Saurfang to issue the returned task() call after warcraft_worktree_create resumes a blocked task', () => {
    expect(SAURFANG_PROMPT).toContain('continueFrom: "blocked", decision');
    expect(SAURFANG_PROMPT).toMatch(/Issue the (newly )?returned\s+`?task\(\)`? call/i);
  });
});
