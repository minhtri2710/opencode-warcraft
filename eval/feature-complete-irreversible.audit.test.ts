import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('warcraft_feature_complete description accuracy audit', () => {
  const featureToolsSrc = readFileSync('packages/opencode-warcraft/src/tools/feature-tools.ts', 'utf-8');
  const toolDocsSrc = readFileSync('packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md', 'utf-8');
  const quickstartSrc = readFileSync('docs/quickstart.md', 'utf-8');

  it('should not claim feature completion is irreversible in tool description', () => {
    // Feature completion IS reversible: syncCompletionFromTasks() in featureService.ts
    // automatically reopens completed features if any task moves away from 'done'.
    expect(featureToolsSrc).not.toMatch(/irreversible/i);
  });

  it('should not claim feature completion is irreversible in WARCRAFT-TOOLS.md', () => {
    expect(toolDocsSrc).not.toMatch(/irreversible/i);
  });

  it('should not claim feature completion is irreversible in quickstart.md', () => {
    expect(quickstartSrc).not.toMatch(/irreversible/i);
  });
});
