import { describe, expect, it } from 'bun:test';
import { formatSpecContent } from './specFormatter.js';
import type { SpecData } from '../types.js';

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

describe('specFormatter edge cases', () => {
  it('handles plan section with code blocks', () => {
    const plan = '## Plan\n\n```typescript\nconst x = 1;\n```\n';
    const result = formatSpecContent(makeSpec({ planSection: plan }));
    expect(result).toContain('const x = 1');
  });

  it('handles plan section with markdown lists', () => {
    const plan = '## Plan\n\n- Item 1\n- Item 2\n  - Sub item\n';
    const result = formatSpecContent(makeSpec({ planSection: plan }));
    expect(result).toContain('Item 1');
  });

  it('handles empty allTasks', () => {
    const result = formatSpecContent(makeSpec({ allTasks: [] }));
    expect(result).toBeDefined();
  });

  it('handles many dependencies', () => {
    const deps = Array.from({ length: 5 }, (_, i) => `${String(i).padStart(2, '0')}-dep`);
    const result = formatSpecContent(makeSpec({ dependsOn: deps }));
    for (const dep of deps) {
      expect(result).toContain(dep);
    }
  });

  it('handles large number of completed tasks', () => {
    const completed = Array.from({ length: 10 }, (_, i) => ({
      name: `Task ${i}`,
      summary: `Completed task ${i}`,
    }));
    const result = formatSpecContent(makeSpec({ completedTasks: completed }));
    expect(result).toContain('Completed task 0');
    expect(result).toContain('Completed task 9');
  });

  it('handles special characters in feature name', () => {
    const result = formatSpecContent(makeSpec({ featureName: 'my-special_feature-v2' }));
    expect(result).toContain('my-special_feature-v2');
  });

  it('handles task with high order number', () => {
    const result = formatSpecContent(makeSpec({
      task: { folder: '99-final', name: 'Final', order: 99 },
    }));
    expect(result).toContain('99-final');
  });

  it('output always starts with heading', () => {
    const result = formatSpecContent(makeSpec());
    expect(result.trimStart().startsWith('#')).toBe(true);
  });

  it('handles unicode in context files', () => {
    const result = formatSpecContent(makeSpec({
      contextFiles: [{ name: 'notes', content: '日本語テスト 🎉' }],
    }));
    expect(result).toContain('🎉');
  });
});
