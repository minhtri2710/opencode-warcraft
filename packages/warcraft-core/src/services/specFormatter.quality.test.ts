import { describe, expect, it } from 'bun:test';
import type { SpecData } from '../types.js';
import { formatSpecContent } from './specFormatter.js';

describe('specFormatter output quality', () => {
  function makeSpec(overrides: Partial<SpecData> = {}): SpecData {
    return {
      featureName: 'test-feature',
      task: { folder: '01-setup', name: 'Setup', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-setup', name: 'Setup', order: 1 }],
      planSection: '## Setup\nInitialize everything',
      contextFiles: [],
      completedTasks: [],
      ...overrides,
    };
  }

  it('contains feature name', () => {
    expect(formatSpecContent(makeSpec())).toContain('test-feature');
  });

  it('contains task name', () => {
    expect(formatSpecContent(makeSpec())).toContain('Setup');
  });

  it('contains plan section', () => {
    expect(formatSpecContent(makeSpec())).toContain('Initialize everything');
  });

  it('lists task info in output', () => {
    const result = formatSpecContent(
      makeSpec({
        allTasks: [
          { folder: '01-setup', name: 'Setup', order: 1 },
          { folder: '02-build', name: 'Build', order: 2 },
          { folder: '03-test', name: 'Test', order: 3 },
        ],
      }),
    );
    // Current task name should appear
    expect(result).toContain('Setup');
    // Some reference to all tasks should exist
    expect(result.length).toBeGreaterThan(100);
  });

  it('shows dependencies', () => {
    const result = formatSpecContent(
      makeSpec({
        dependsOn: ['01-setup'],
        task: { folder: '02-build', name: 'Build', order: 2 },
      }),
    );
    expect(result).toContain('01-setup');
  });

  it('shows completed tasks', () => {
    const result = formatSpecContent(
      makeSpec({
        completedTasks: [{ name: 'Init', summary: 'Initialized the project successfully' }],
      }),
    );
    expect(result).toContain('Initialized the project');
  });

  it('shows context files', () => {
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [{ name: 'decisions', content: 'Use TypeScript for everything' }],
      }),
    );
    expect(result).toContain('TypeScript');
  });

  it('handles null plan section', () => {
    const result = formatSpecContent(makeSpec({ planSection: null }));
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty context and completed', () => {
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [],
        completedTasks: [],
      }),
    );
    expect(result).toBeDefined();
  });

  it('is valid markdown', () => {
    const result = formatSpecContent(makeSpec());
    // Should contain markdown headings
    expect(result).toContain('#');
  });

  it('does not contain undefined or null strings', () => {
    const result = formatSpecContent(makeSpec());
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });

  it('large context file preserved', () => {
    const bigContent = 'x'.repeat(10000);
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [{ name: 'big', content: bigContent }],
      }),
    );
    expect(result).toContain(bigContent);
  });

  it('multiple context files all included', () => {
    const result = formatSpecContent(
      makeSpec({
        contextFiles: [
          { name: 'a', content: 'Content Alpha' },
          { name: 'b', content: 'Content Beta' },
          { name: 'c', content: 'Content Gamma' },
        ],
      }),
    );
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
    expect(result).toContain('Gamma');
  });
});
