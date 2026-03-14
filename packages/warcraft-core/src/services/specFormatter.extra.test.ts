import { describe, expect, it } from 'bun:test';
import type { SpecData } from '../types.js';
import { formatSpecContent } from './specFormatter.js';

function createSpecData(overrides: Partial<SpecData> = {}): SpecData {
  return {
    featureName: 'test-feature',
    task: { folder: '01-test-task', name: 'Test task', order: 1 },
    dependsOn: [],
    allTasks: [],
    planSection: null,
    contextFiles: [],
    completedTasks: [],
    ...overrides,
  };
}

describe('formatSpecContent inferTaskType', () => {
  it('infers greenfield when plan section has only Create: directives', () => {
    const formatted = formatSpecContent(
      createSpecData({
        planSection: '- Create: src/new-module.ts\n- Create: src/new-module.test.ts',
      }),
    );
    expect(formatted).toContain('## Task Type');
    expect(formatted).toContain('greenfield');
  });

  it('infers modification when plan section has Modify: directives', () => {
    const formatted = formatSpecContent(
      createSpecData({
        planSection: '- Create: src/helper.ts\n- Modify: src/index.ts',
      }),
    );
    expect(formatted).toContain('modification');
  });

  it('infers testing from plan section with only Test: directives', () => {
    const formatted = formatSpecContent(
      createSpecData({
        planSection: '- Test: src/utils.test.ts\n- Test: src/api.test.ts',
      }),
    );
    expect(formatted).toContain('testing');
  });

  it('returns no task type when plan section has no Create/Modify/Test directives', () => {
    const formatted = formatSpecContent(
      createSpecData({
        task: { folder: '01-setup', name: 'Setup infra', order: 1 },
        planSection: '- Update documentation\n- Fix configuration',
      }),
    );
    expect(formatted).not.toContain('## Task Type');
  });

  it('returns no task type when no plan section and task name has no "test"', () => {
    const formatted = formatSpecContent(
      createSpecData({
        task: { folder: '01-setup', name: 'Setup infra', order: 1 },
      }),
    );
    expect(formatted).not.toContain('## Task Type');
  });

  it('renders _No plan section available._ when planSection is null', () => {
    const formatted = formatSpecContent(createSpecData());
    expect(formatted).toContain('_No plan section available._');
  });
});

describe('formatSpecContent dependency rendering', () => {
  it('renders fallback folder name for unresolved dependencies', () => {
    const formatted = formatSpecContent(
      createSpecData({
        dependsOn: ['99-unknown-task'],
        allTasks: [{ folder: '01-test-task', name: 'Test task', order: 1 }],
      }),
    );
    expect(formatted).toContain('- 99-unknown-task');
  });

  it('renders multiple dependencies with task details', () => {
    const formatted = formatSpecContent(
      createSpecData({
        task: { folder: '03-final', name: 'Final', order: 3 },
        dependsOn: ['01-setup', '02-api'],
        allTasks: [
          { folder: '01-setup', name: 'Setup', order: 1 },
          { folder: '02-api', name: 'API', order: 2 },
          { folder: '03-final', name: 'Final', order: 3 },
        ],
      }),
    );
    expect(formatted).toContain('**1. Setup** (01-setup)');
    expect(formatted).toContain('**2. API** (02-api)');
  });
});

describe('formatSpecContent multiple context files', () => {
  it('renders separator between multiple context sections', () => {
    const formatted = formatSpecContent(
      createSpecData({
        contextFiles: [
          { name: 'research', content: 'Research notes' },
          { name: 'decisions', content: 'Decision log' },
        ],
      }),
    );
    expect(formatted).toContain('## research');
    expect(formatted).toContain('## decisions');
    expect(formatted).toContain('---');
  });
});

describe('formatSpecContent completed tasks', () => {
  it('renders multiple completed tasks', () => {
    const formatted = formatSpecContent(
      createSpecData({
        completedTasks: [
          { name: 'Setup', summary: 'Done' },
          { name: 'API', summary: 'Implemented REST endpoints' },
          { name: 'Config' },
        ],
      }),
    );
    expect(formatted).toContain('- Setup: Done');
    expect(formatted).toContain('- API: Implemented REST endpoints');
    expect(formatted).toContain('- Config');
  });
});
