import { describe, expect, it } from 'bun:test';
import { BLOCKER_PROTOCOL } from '../packages/opencode-warcraft/src/agents/fragments/blocker-handling.js';

describe('Blocker protocol audit', () => {
  it('tells orchestrators to issue the returned task() call after resuming a blocked task', () => {
    expect(BLOCKER_PROTOCOL).toContain('continueFrom: "blocked", decision');
    expect(BLOCKER_PROTOCOL).toMatch(/Issue the (newly )?returned\s+`?task\(\)`? call/i);
  });
});
