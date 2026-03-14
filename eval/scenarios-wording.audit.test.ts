import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('eval/scenarios workspace and delegation wording audit', () => {
  const scenarioDir = 'eval/scenarios';
  const scenarioFiles = readdirSync(scenarioDir).filter((f) => f.endsWith('.md'));

  for (const file of scenarioFiles) {
    const src = readFileSync(join(scenarioDir, file), 'utf-8');

    it(`${file}: should not say worker "spawned in worktree"`, () => {
      expect(src).not.toMatch(/spawned? in.*worktree/i);
    });

    it(`${file}: should not say "changes committed to task branch" unconditionally`, () => {
      expect(src).not.toMatch(/changes committed to (respective )?task branch/i);
    });
  }
});
