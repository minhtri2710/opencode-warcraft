import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('README.md tool count and completeness audit', () => {
  const readmeSrc = readFileSync('packages/opencode-warcraft/README.md', 'utf-8');

  it('should list 19 total tools', () => {
    expect(readmeSrc).toMatch(/## Tools \(19 total\)/);
  });

  it('should include warcraft_doctor', () => {
    expect(readmeSrc).toMatch(/warcraft_doctor/);
  });

  it('should include warcraft_worktree_prune', () => {
    expect(readmeSrc).toMatch(/warcraft_worktree_prune/);
  });

  it('should not claim Khadgar has 17 tools', () => {
    expect(readmeSrc).not.toMatch(/all 17 tools/);
  });

  it('should not claim merge tool merges a task branch', () => {
    expect(readmeSrc).not.toMatch(/Merge task branch/i);
  });
});
