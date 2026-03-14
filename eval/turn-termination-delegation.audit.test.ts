/**
 * Fresh-eye audit: the turn-termination fragment lists "Worker delegation
 * (warcraft_worktree_create)" as a valid turn ending, but the real delegation
 * requires warcraft_worktree_create AND issuing the returned task() call.
 * Stopping at just warcraft_worktree_create is an incomplete turn.
 */
import { describe, expect, it } from 'bun:test';
import { TURN_TERMINATION_RULES } from '../packages/opencode-warcraft/src/agents/fragments/turn-termination.js';

describe('turn-termination delegation completeness audit', () => {
  it('should describe worker delegation as including the returned task() call, not just warcraft_worktree_create', () => {
    // The valid endings list must not imply warcraft_worktree_create alone
    // completes a delegation — the orchestrator must also issue the returned task() call.
    const validEndingsBlock = TURN_TERMINATION_RULES.slice(
      TURN_TERMINATION_RULES.indexOf('Valid endings:'),
      TURN_TERMINATION_RULES.indexOf('NEVER end with:'),
    );
    // Should mention task() in the delegation line
    expect(validEndingsBlock).toMatch(/task\(\)/);
  });
});
