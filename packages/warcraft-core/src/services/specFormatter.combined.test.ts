import { describe, expect, it } from 'bun:test';
import type { SpecData } from '../types.js';
import { formatSpecContent } from './specFormatter.js';

function makeSpec(overrides: Partial<SpecData> = {}): SpecData {
  return {
    featureName: 'f',
    task: { folder: '01-t', name: 't', order: 1 },
    dependsOn: [],
    allTasks: [],
    planSection: null,
    contextFiles: [],
    completedTasks: [],
    ...overrides,
  };
}

describe('formatSpecContent combined scenarios', () => {
  it('full spec with all sections populated', () => {
    const formatted = formatSpecContent(
      makeSpec({
        featureName: 'my-feature',
        task: { folder: '02-api', name: 'API endpoints', order: 2 },
        dependsOn: ['01-setup'],
        allTasks: [
          { folder: '01-setup', name: 'Setup', order: 1 },
          { folder: '02-api', name: 'API endpoints', order: 2 },
        ],
        planSection: '### 2. API endpoints\n\n- Create: src/api.ts\n- Modify: src/routes.ts',
        contextFiles: [{ name: 'decisions', content: 'Use REST, not GraphQL' }],
        completedTasks: [{ name: 'Setup', summary: 'Project bootstrapped' }],
      }),
    );

    expect(formatted).toContain('# Task: 02-api');
    expect(formatted).toContain('## Feature: my-feature');
    expect(formatted).toContain('**1. Setup** (01-setup)');
    expect(formatted).toContain('API endpoints');
    expect(formatted).toContain('modification');
    expect(formatted).toContain('## Context');
    expect(formatted).toContain('## Completed Tasks');
    expect(formatted).toContain('- Setup: Project bootstrapped');
  });

  it('minimal spec with no optional data', () => {
    const formatted = formatSpecContent(makeSpec());
    expect(formatted).toContain('# Task: 01-t');
    expect(formatted).toContain('## Feature: f');
    expect(formatted).toContain('_None_');
    expect(formatted).toContain('_No plan section available._');
    expect(formatted).not.toContain('## Task Type');
    expect(formatted).not.toContain('## Context');
    expect(formatted).not.toContain('## Completed Tasks');
  });

  it('spec with only dependencies', () => {
    const formatted = formatSpecContent(
      makeSpec({
        dependsOn: ['01-a', '02-b'],
        allTasks: [
          { folder: '01-a', name: 'A', order: 1 },
          { folder: '02-b', name: 'B', order: 2 },
          { folder: '03-c', name: 'C', order: 3 },
        ],
      }),
    );
    expect(formatted).toContain('**1. A** (01-a)');
    expect(formatted).toContain('**2. B** (02-b)');
    expect(formatted).not.toContain('_None_');
  });

  it('spec with only context', () => {
    const formatted = formatSpecContent(
      makeSpec({
        contextFiles: [
          { name: 'notes', content: 'Note 1' },
          { name: 'research', content: 'Research 1' },
        ],
      }),
    );
    expect(formatted).toContain('## Context');
    expect(formatted).toContain('## notes');
    expect(formatted).toContain('## research');
  });

  it('spec with only completed tasks', () => {
    const formatted = formatSpecContent(
      makeSpec({
        completedTasks: [
          { name: 'A' },
          { name: 'B', summary: 'Done' },
          { name: 'C', summary: '' },
        ],
      }),
    );
    expect(formatted).toContain('## Completed Tasks');
    expect(formatted).toContain('- A');
    expect(formatted).toContain('- B: Done');
    expect(formatted).toContain('- C');
  });
});
