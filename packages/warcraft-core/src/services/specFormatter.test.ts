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

describe('formatSpecContent structure', () => {
  it('includes task header, feature name, and dependencies section', () => {
    const formatted = formatSpecContent(createSpecData());
    expect(formatted).toContain('# Task: 01-test-task');
    expect(formatted).toContain('## Feature: test-feature');
    expect(formatted).toContain('## Dependencies');
    expect(formatted).toContain('_None_');
  });

  it('renders dependency list with task details', () => {
    const specData = createSpecData({
      dependsOn: ['01-setup'],
      allTasks: [
        { folder: '01-setup', name: 'Setup', order: 1 },
        { folder: '02-build', name: 'Build', order: 2 },
      ],
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('**1. Setup** (01-setup)');
  });

  it('renders plan section content', () => {
    const specData = createSpecData({
      planSection: '### 1. Test task\n\nImplement the feature.',
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('## Plan Section');
    expect(formatted).toContain('Implement the feature.');
  });

  it('renders completed tasks section', () => {
    const specData = createSpecData({
      completedTasks: [{ name: 'Setup', summary: 'Created project skeleton' }],
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('## Completed Tasks');
    expect(formatted).toContain('- Setup: Created project skeleton');
  });

  it('renders completed tasks without summary gracefully', () => {
    const specData = createSpecData({
      completedTasks: [{ name: 'Setup', summary: undefined as unknown as string }],
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('- Setup');
    expect(formatted).not.toContain('undefined');
  });

  it('infers testing task type from plan section', () => {
    const specData = createSpecData({
      planSection: '- Test: src/utils.test.ts',
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('## Task Type');
    expect(formatted).toContain('testing');
  });

  it('infers testing task type from task name when no plan section', () => {
    const specData = createSpecData({
      task: { folder: '01-test-utils', name: 'Test utils', order: 1 },
    });

    const formatted = formatSpecContent(specData);
    expect(formatted).toContain('## Task Type');
    expect(formatted).toContain('testing');
  });
});
