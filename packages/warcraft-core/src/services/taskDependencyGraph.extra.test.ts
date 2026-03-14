import { describe, expect, it } from 'bun:test';
import type { TaskWithDeps } from './taskDependencyGraph.js';
import {
  buildEffectiveDependencies,
  computeRunnableAndBlocked,
  validateUniquePrefixes,
} from './taskDependencyGraph.js';

describe('computeRunnableAndBlocked edge cases', () => {
  it('handles tasks with no numeric prefix (non-sequential folders)', () => {
    const tasks: TaskWithDeps[] = [
      { folder: 'setup', status: 'pending', dependsOn: undefined },
      { folder: 'api', status: 'pending', dependsOn: undefined },
    ];

    const result = computeRunnableAndBlocked(tasks);
    // Non-numeric folders with undefined dependsOn get empty deps
    expect(result.runnable).toContain('setup');
    expect(result.runnable).toContain('api');
    expect(result.blocked).toEqual({});
  });

  it('handles mix of explicit and implicit dependencies', () => {
    const tasks: TaskWithDeps[] = [
      { folder: '01-base', status: 'done', dependsOn: [] },
      { folder: '02-middle', status: 'pending', dependsOn: undefined }, // implicit dep on 01
      { folder: '03-end', status: 'pending', dependsOn: ['01-base'] }, // explicit dep
    ];

    const result = computeRunnableAndBlocked(tasks);
    // 01-base is done, so 02-middle (implicit dep on 01) is runnable
    expect(result.runnable).toContain('02-middle');
    // 03-end explicit dep on 01-base which is done, so also runnable
    expect(result.runnable).toContain('03-end');
    expect(result.blocked).toEqual({});
  });

  it('handles gap in numeric sequence (01, 03 - no 02)', () => {
    const tasks: TaskWithDeps[] = [
      { folder: '01-first', status: 'done', dependsOn: undefined },
      { folder: '03-third', status: 'pending', dependsOn: undefined },
    ];

    const result = computeRunnableAndBlocked(tasks);
    // 03 has implicit dep on 02, but 02 doesn't exist (folderByOrder.get(2) is undefined)
    // So effective deps = []
    expect(result.runnable).toContain('03-third');
  });

  it('all tasks done returns empty runnable and blocked', () => {
    const tasks: TaskWithDeps[] = [
      { folder: '01-a', status: 'done', dependsOn: [] },
      { folder: '02-b', status: 'done', dependsOn: ['01-a'] },
    ];

    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable).toEqual([]);
    expect(result.blocked).toEqual({});
  });

  it('single pending task with no deps is runnable', () => {
    const tasks: TaskWithDeps[] = [{ folder: '01-solo', status: 'pending', dependsOn: [] }];

    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable).toEqual(['01-solo']);
    expect(result.blocked).toEqual({});
  });
});

describe('buildEffectiveDependencies edge cases', () => {
  it('tasks with non-numeric prefix get empty dependencies', () => {
    const tasks: TaskWithDeps[] = [{ folder: 'no-number', status: 'pending', dependsOn: undefined }];

    const deps = buildEffectiveDependencies(tasks);
    expect(deps.get('no-number')).toEqual([]);
  });

  it('task with order 0 has no implicit dependency', () => {
    const tasks: TaskWithDeps[] = [{ folder: '00-init', status: 'pending', dependsOn: undefined }];

    const deps = buildEffectiveDependencies(tasks);
    expect(deps.get('00-init')).toEqual([]);
  });

  it('explicit dependsOn overrides implicit sequential fallback', () => {
    const tasks: TaskWithDeps[] = [
      { folder: '01-a', status: 'done', dependsOn: [] },
      { folder: '02-b', status: 'done', dependsOn: [] },
      { folder: '03-c', status: 'pending', dependsOn: ['01-a'] }, // explicit, not 02
    ];

    const deps = buildEffectiveDependencies(tasks);
    expect(deps.get('03-c')).toEqual(['01-a']);
  });

  it('empty dependsOn array means no dependencies (not implicit)', () => {
    const tasks: TaskWithDeps[] = [
      { folder: '01-a', status: 'done', dependsOn: [] },
      { folder: '02-b', status: 'pending', dependsOn: [] }, // explicitly no deps
    ];

    const deps = buildEffectiveDependencies(tasks);
    expect(deps.get('02-b')).toEqual([]);
  });
});

describe('validateUniquePrefixes edge cases', () => {
  it('returns empty for empty input', () => {
    expect(validateUniquePrefixes([])).toEqual([]);
  });

  it('returns empty for single folder', () => {
    expect(validateUniquePrefixes(['01-setup'])).toEqual([]);
  });

  it('handles all non-numeric folders', () => {
    expect(validateUniquePrefixes(['setup', 'api', 'frontend'])).toEqual([]);
  });

  it('handles mixed numeric and non-numeric folders', () => {
    expect(validateUniquePrefixes(['01-setup', 'misc', '02-api'])).toEqual([]);
  });

  it('detects triple collision on same prefix', () => {
    const errors = validateUniquePrefixes(['01-a', '01-b', '01-c']);
    expect(errors).toHaveLength(2); // b and c collide with a
  });
});
