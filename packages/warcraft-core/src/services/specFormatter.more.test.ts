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

describe('formatSpecContent additional edge cases', () => {
  it('infers greenfield from case-insensitive Create directive', () => {
    const formatted = formatSpecContent(createSpecData({ planSection: '- create: src/new-file.ts' }));
    expect(formatted).toContain('greenfield');
  });

  it('infers modification from case-insensitive Modify directive', () => {
    const formatted = formatSpecContent(createSpecData({ planSection: '- modify: src/existing.ts' }));
    expect(formatted).toContain('modification');
  });

  it('infers testing from case-insensitive Test directive', () => {
    const formatted = formatSpecContent(createSpecData({ planSection: '- test: src/utils.test.ts' }));
    expect(formatted).toContain('testing');
  });

  it('modification takes priority over create+test', () => {
    const formatted = formatSpecContent(
      createSpecData({
        planSection: '- Create: src/new.ts\n- Modify: src/old.ts\n- Test: src/test.ts',
      }),
    );
    expect(formatted).toContain('modification');
    expect(formatted).not.toContain('greenfield');
    expect(formatted).not.toContain('testing');
  });

  it('no task type section when only unrecognized directives', () => {
    const formatted = formatSpecContent(
      createSpecData({
        task: { folder: '01-docs', name: 'Update docs', order: 1 },
        planSection: '- Update: README.md\n- Review: PR comments',
      }),
    );
    expect(formatted).not.toContain('## Task Type');
  });

  it('trims plan section whitespace', () => {
    const formatted = formatSpecContent(
      createSpecData({ planSection: '\n\n  ### 1. Setup\n\n  Configure the project  \n\n' }),
    );
    expect(formatted).toContain('### 1. Setup');
    expect(formatted).toContain('Configure the project');
  });

  it('renders empty completedTasks section omitted', () => {
    const formatted = formatSpecContent(createSpecData({ completedTasks: [] }));
    expect(formatted).not.toContain('## Completed Tasks');
  });

  it('renders empty contextFiles section omitted', () => {
    const formatted = formatSpecContent(createSpecData({ contextFiles: [] }));
    expect(formatted).not.toContain('## Context');
  });

  it('handles very long task folder names', () => {
    const longFolder = '99-' + 'a'.repeat(200);
    const formatted = formatSpecContent(createSpecData({ task: { folder: longFolder, name: 'Long task', order: 99 } }));
    expect(formatted).toContain(`# Task: ${longFolder}`);
  });

  it('renders all sections in correct order', () => {
    const formatted = formatSpecContent(
      createSpecData({
        dependsOn: ['01-dep'],
        allTasks: [
          { folder: '01-dep', name: 'Dep', order: 1 },
          { folder: '02-main', name: 'Main', order: 2 },
        ],
        planSection: '- Create: src/new.ts',
        contextFiles: [{ name: 'notes', content: 'Notes content' }],
        completedTasks: [{ name: 'Dep', summary: 'Done' }],
      }),
    );

    const taskIdx = formatted.indexOf('# Task:');
    const featureIdx = formatted.indexOf('## Feature:');
    const depsIdx = formatted.indexOf('## Dependencies');
    const planIdx = formatted.indexOf('## Plan Section');
    const typeIdx = formatted.indexOf('## Task Type');
    const contextIdx = formatted.indexOf('## Context');
    const completedIdx = formatted.indexOf('## Completed Tasks');

    expect(taskIdx).toBeLessThan(featureIdx);
    expect(featureIdx).toBeLessThan(depsIdx);
    expect(depsIdx).toBeLessThan(planIdx);
    expect(planIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(contextIdx);
    expect(contextIdx).toBeLessThan(completedIdx);
  });
});
