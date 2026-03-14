import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('WARCRAFT-TOOLS.md tool count and completeness audit', () => {
  const docsSrc = readFileSync('packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md', 'utf-8');

  it('should list the correct total number of tools (19)', () => {
    // Runtime registers 19 tools. The docs must match.
    expect(docsSrc).toMatch(/## Tools \(19 total\)/);
  });

  it('should include warcraft_doctor in the docs', () => {
    expect(docsSrc).toMatch(/warcraft_doctor/);
  });

  it('should include warcraft_worktree_prune in the docs', () => {
    expect(docsSrc).toMatch(/warcraft_worktree_prune/);
  });

  it('should not claim 17 total in the categories summary', () => {
    expect(docsSrc).not.toMatch(/\*\*Total\*\*.*\*\*17\*\*/);
  });

  it('should not claim discard tool "Discard changes, reset status" unconditionally', () => {
    // Direct mode does NOT discard file changes — only resets status.
    expect(docsSrc).not.toMatch(/Discard changes, reset status/);
  });
});
