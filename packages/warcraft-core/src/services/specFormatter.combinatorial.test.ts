import { describe, expect, it } from 'bun:test';
import type { SpecData } from '../types.js';
import { formatSpecContent } from './specFormatter.js';

function makeSpec(overrides: Partial<SpecData> = {}): SpecData {
  return {
    featureName: 'test-feature',
    task: { folder: '01-setup', name: 'Setup', order: 1 },
    dependsOn: [],
    allTasks: [{ folder: '01-setup', name: 'Setup', order: 1 }],
    planSection: null,
    contextFiles: [],
    completedTasks: [],
    ...overrides,
  };
}

describe('specFormatter combinatorial', () => {
  const PLAN_SECTIONS = [
    null,
    '## Simple plan',
    '## Plan\n\nDetailed plan with **bold** and *italic*',
    '## Plan\n\n```code\nblock\n```',
  ];

  const CONTEXT_FILES = [
    [],
    [{ name: 'decisions', content: 'Decision A' }],
    [
      { name: 'a', content: 'A' },
      { name: 'b', content: 'B' },
    ],
  ];

  const DEPS = [[], ['00-init'], ['00-a', '00-b', '00-c']];

  const COMPLETED = [
    [],
    [{ name: 'Init', summary: 'Done init' }],
    [
      { name: 'A', summary: 'Did A' },
      { name: 'B', summary: 'Did B' },
    ],
  ];

  for (const plan of PLAN_SECTIONS) {
    for (const ctx of CONTEXT_FILES) {
      for (const deps of DEPS) {
        for (const comp of COMPLETED) {
          const desc = `plan=${plan ? 'yes' : 'null'} ctx=${ctx.length} deps=${deps.length} comp=${comp.length}`;
          it(desc, () => {
            const result = formatSpecContent(
              makeSpec({
                planSection: plan,
                contextFiles: ctx,
                dependsOn: deps,
                completedTasks: comp,
              }),
            );
            expect(result).toBeDefined();
            expect(result.length).toBeGreaterThan(0);
            expect(result).toContain('test-feature');
          });
        }
      }
    }
  }
});
