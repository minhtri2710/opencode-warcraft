import { describe, expect, it } from 'bun:test';
import { computeRunnableAndBlocked, type TaskWithDeps } from './taskDependencyGraph.js';
import type { TaskStatusType } from '../types.js';

function task(folder: string, status: TaskStatusType, deps?: string[]): TaskWithDeps {
  return { folder, status, dependsOn: deps };
}

describe('taskDependencyGraph advanced patterns', () => {
  it('complex diamond with 7 tasks', () => {
    const result = computeRunnableAndBlocked([
      task('01-base', 'pending'),
      task('02-left-a', 'pending', ['01-base']),
      task('03-left-b', 'pending', ['02-left-a']),
      task('04-right-a', 'pending', ['01-base']),
      task('05-right-b', 'pending', ['04-right-a']),
      task('06-merge', 'pending', ['03-left-b', '05-right-b']),
      task('07-final', 'pending', ['06-merge']),
    ]);
    expect(result.runnable).toEqual(['01-base']);
    expect(Object.keys(result.blocked).length).toBe(6);
  });

  it('completing base unblocks two paths', () => {
    const result = computeRunnableAndBlocked([
      task('01-base', 'done'),
      task('02-left', 'pending', ['01-base']),
      task('03-right', 'pending', ['01-base']),
      task('04-merge', 'pending', ['02-left', '03-right']),
    ]);
    expect(result.runnable).toContain('02-left');
    expect(result.runnable).toContain('03-right');
    expect(result.blocked['04-merge']).toBeDefined();
  });

  it('mix of done and in_progress', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'done'),
      task('02-b', 'in_progress', ['01-a']),
      task('03-c', 'pending', ['02-b']),
    ]);
    expect(result.runnable).toEqual([]);
    expect(result.blocked['03-c']).toBeDefined();
  });

  it('failed task blocks downstream', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'failed'),
      task('02-b', 'pending', ['01-a']),
      task('03-c', 'pending', ['02-b']),
    ]);
    expect(result.blocked['02-b']).toBeDefined();
    expect(result.blocked['03-c']).toBeDefined();
  });

  it('cancelled task blocks downstream', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'cancelled'),
      task('02-b', 'pending', ['01-a']),
    ]);
    expect(result.blocked['02-b']).toBeDefined();
  });

  it('no dependencies: behavior depends on implicit deps', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'pending'),
      task('02-b', 'pending'),
      task('03-c', 'pending'),
    ]);
    // Without explicit deps, implicit sequential may apply
    expect(result.runnable.length).toBeGreaterThanOrEqual(1);
  });

  it('undefined deps: implicit sequential', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'pending', undefined),
      task('02-b', 'pending', undefined),
    ]);
    expect(result.runnable.length).toBeGreaterThanOrEqual(1);
  });

  it('empty deps array: runnable', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'pending', []),
    ]);
    expect(result.runnable).toContain('01-a');
  });

  it('20 task linear chain: only first runnable', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => {
      const folder = `${String(i + 1).padStart(2, '0')}-task`;
      return task(folder, 'pending', i === 0 ? [] : [`${String(i).padStart(2, '0')}-task`]);
    });
    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable).toEqual(['01-task']);
  });

  it('20 independent tasks: all runnable', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => 
      task(`${String(i + 1).padStart(2, '0')}-task`, 'pending', [])
    );
    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable.length).toBe(20);
  });
});
