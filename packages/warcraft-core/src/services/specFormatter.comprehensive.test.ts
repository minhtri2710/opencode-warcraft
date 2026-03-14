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

describe('specFormatter comprehensive', () => {
  it('includes feature name', () => {
    const result = formatSpecContent(makeSpec());
    expect(result).toContain('test-feature');
  });

  it('includes task folder in title', () => {
    const result = formatSpecContent(makeSpec());
    expect(result).toContain('01-setup');
  });

  it('includes task folder', () => {
    const result = formatSpecContent(makeSpec());
    expect(result).toContain('01-setup');
  });

  it('includes plan section when provided', () => {
    const result = formatSpecContent(makeSpec({ planSection: '## Plan\n\nDo the thing.' }));
    expect(result).toContain('Do the thing');
  });

  it('handles null plan section', () => {
    const result = formatSpecContent(makeSpec({ planSection: null }));
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes context files', () => {
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [{ name: 'decisions', content: 'Use TypeScript' }],
      }),
    );
    expect(result).toContain('Use TypeScript');
  });

  it('includes multiple context files', () => {
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [
          { name: 'decisions', content: 'Decision A' },
          { name: 'learnings', content: 'Learning B' },
        ],
      }),
    );
    expect(result).toContain('Decision A');
    expect(result).toContain('Learning B');
  });

  it('includes completed tasks summaries', () => {
    const result = formatSpecContent(
      makeSpec({
        completedTasks: [{ name: 'Init', summary: 'Created project' }],
      }),
    );
    expect(result).toContain('Created project');
  });

  it('includes dependencies', () => {
    const result = formatSpecContent(
      makeSpec({
        dependsOn: ['00-init'],
      }),
    );
    expect(result).toContain('00-init');
  });

  it('output is a non-empty string with all tasks', () => {
    const result = formatSpecContent(
      makeSpec({
        allTasks: [
          { folder: '01-setup', name: 'Setup', order: 1 },
          { folder: '02-impl', name: 'Implementation', order: 2 },
          { folder: '03-test', name: 'Testing', order: 3 },
        ],
      }),
    );
    expect(result.length).toBeGreaterThan(0);
    // Task folder is always in the spec
    expect(result).toContain('01-setup');
  });

  it('returns string', () => {
    expect(typeof formatSpecContent(makeSpec())).toBe('string');
  });

  it('handles empty completed tasks', () => {
    const result = formatSpecContent(makeSpec({ completedTasks: [] }));
    expect(result).toBeDefined();
  });

  it('handles empty context files', () => {
    const result = formatSpecContent(makeSpec({ contextFiles: [] }));
    expect(result).toBeDefined();
  });

  it('handles empty dependsOn', () => {
    const result = formatSpecContent(makeSpec({ dependsOn: [] }));
    expect(result).toBeDefined();
  });
});
