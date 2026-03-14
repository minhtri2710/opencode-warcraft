import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('warcraft skill merge tool description', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'skills', 'warcraft', 'SKILL.md'),
    'utf-8',
  );

  it('should not say "Integrate task branch" unconditionally in tool table', () => {
    // In direct mode there is no branch to integrate
    expect(content).not.toMatch(/warcraft_merge.*Integrate task branch/);
  });

  it('should describe merge as integrating completed work', () => {
    expect(content).toMatch(/warcraft_merge.*Integrate completed task work/);
  });
});
