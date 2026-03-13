/**
 * Fresh-eye audit: Mekkatorque prompt header should not claim the worker
 * works "in isolation" since direct mode does not provide filesystem isolation.
 */
import { describe, expect, it } from 'bun:test';
import { buildMekkatorquePrompt } from '../packages/opencode-warcraft/src/agents/mekkatorque.js';

describe('Mekkatorque prompt isolation claim audit', () => {
  it('should not claim "Work in isolation" unconditionally', () => {
    const prompt = buildMekkatorquePrompt({ verificationModel: 'tdd' });
    // The header says "Work in isolation" but direct mode doesn't provide
    // filesystem isolation.
    const headerBlock = prompt.slice(prompt.indexOf('# Mekkatorque'), prompt.indexOf('## Allowed'));
    expect(headerBlock).not.toMatch(/Work in isolation/i);
  });
});
