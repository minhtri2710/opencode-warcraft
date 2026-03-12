import { describe, expect, it } from 'bun:test';
import type { SpecData } from '../types.js';
import { formatSpecContent } from './specFormatter.js';

function createSpecData(overrides: Partial<SpecData> = {}): SpecData {
  return {
    featureName: 'test-feature',
    task: {
      folder: '01-test-task',
      name: 'Test task',
      order: 1,
    },
    dependsOn: [],
    allTasks: [],
    planSection: null,
    contextFiles: [],
    completedTasks: [],
    ...overrides,
  };
}

describe('formatSpecContent context rendering', () => {
  it('strips duplicate leading headings that match the context file name', () => {
    const specData = createSpecData({
      contextFiles: [
        {
          name: 'execution-decisions',
          content: '## Execution Decisions\n\n- Parallelize the runnable tasks',
        },
      ],
    });

    const formatted = formatSpecContent(specData);

    expect(formatted).toContain('## Context\n\n## execution-decisions\n\n- Parallelize the runnable tasks');
    expect(formatted).not.toContain('## Execution Decisions');
  });

  it('preserves non-matching leading headings inside the rendered context section', () => {
    const specData = createSpecData({
      contextFiles: [
        {
          name: 'research-notes',
          content: '## Operator Notes\n\n- Keep the rollout sequential',
        },
      ],
    });

    const formatted = formatSpecContent(specData);

    expect(formatted).toContain('## research-notes\n\n## Operator Notes\n\n- Keep the rollout sequential');
  });
});
