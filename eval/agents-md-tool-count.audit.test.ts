import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('AGENTS.md tool count audit', () => {
  const agentsMdSrc = readFileSync('AGENTS.md', 'utf-8');

  it('should not claim 17 tools', () => {
    expect(agentsMdSrc).not.toMatch(/17 tools/);
  });

  it('should not claim 18 tools', () => {
    expect(agentsMdSrc).not.toMatch(/18 tools/);
  });
});
