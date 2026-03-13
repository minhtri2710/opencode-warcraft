/**
 * Fresh-eye audit: Mekkatorque prompt Docker sandbox section should not
 * claim that a worktree is always mounted — in direct mode the project
 * root workspace is mounted instead.
 */
import { describe, expect, it } from 'bun:test';
import { buildMekkatorquePrompt } from '../packages/opencode-warcraft/src/agents/mekkatorque.js';

describe('Mekkatorque prompt Docker sandbox audit', () => {
  it('should not claim "worktree is mounted" unconditionally in the Docker sandbox section', () => {
    const prompt = buildMekkatorquePrompt({ verificationModel: 'tdd' });
    const dockerSection = prompt.slice(prompt.indexOf('Docker Sandbox'), prompt.indexOf('Docker Sandbox') + 500);
    // "worktree is mounted" is misleading in direct mode — should say
    // "workspace is mounted" or similar.
    expect(dockerSection).not.toMatch(/worktree is mounted/i);
  });
});
