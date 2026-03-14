import { describe, expect, it } from 'bun:test';
import { computeRunnableAndBlocked, type TaskWithDeps } from './taskDependencyGraph.js';

function task(folder: string, status: string, deps: string[] = []): TaskWithDeps {
  return { folder, status: status as any, dependsOn: deps };
}

describe('taskDependencyGraph more scenarios', () => {
  it('single task with no deps is runnable', () => {
    const result = computeRunnableAndBlocked([task('01-a', 'pending')]);
    expect(result.runnable).toEqual(['01-a']);
    expect(Object.keys(result.blocked)).toHaveLength(0);
  });

  it('single done task has no runnable or blocked', () => {
    const result = computeRunnableAndBlocked([task('01-a', 'done')]);
    expect(result.runnable).toEqual([]);
    expect(Object.keys(result.blocked)).toHaveLength(0);
  });

  it('chain: only first pending after done is runnable', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'done'),
      task('02-b', 'pending', ['01-a']),
      task('03-c', 'pending', ['02-b']),
    ]);
    expect(result.runnable).toEqual(['02-b']);
    expect(result.blocked['03-c']).toBeDefined();
  });

  it('parallel tasks with no deps are all runnable', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'pending'),
      task('02-b', 'pending'),
      task('03-c', 'pending'),
    ]);
    expect(result.runnable).toHaveLength(3);
  });

  it('diamond: d blocked until both b and c done', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'done'),
      task('02-b', 'done', ['01-a']),
      task('03-c', 'pending', ['01-a']),
      task('04-d', 'pending', ['02-b', '03-c']),
    ]);
    expect(result.runnable).toEqual(['03-c']);
    expect(result.blocked['04-d']).toBeDefined();
    expect(result.blocked['04-d']).toContain('03-c');
  });

  it('in_progress tasks are not in runnable', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'in_progress'),
      task('02-b', 'pending', ['01-a']),
    ]);
    expect(result.runnable).not.toContain('01-a');
    expect(result.blocked['02-b']).toBeDefined();
  });

  it('cancelled tasks do not satisfy dependencies', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'cancelled'),
      task('02-b', 'pending', ['01-a']),
    ]);
    expect(result.blocked['02-b']).toBeDefined();
  });

  it('empty task list returns empty', () => {
    const result = computeRunnableAndBlocked([]);
    expect(result.runnable).toEqual([]);
    expect(Object.keys(result.blocked)).toHaveLength(0);
  });

  it('non-existent dep blocks task', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'pending', ['99-ghost']),
    ]);
    expect(result.blocked['01-a']).toBeDefined();
    expect(result.blocked['01-a']).toContain('99-ghost');
  });

  it('all done means nothing runnable or blocked', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'done'),
      task('02-b', 'done', ['01-a']),
    ]);
    expect(result.runnable).toEqual([]);
    expect(Object.keys(result.blocked)).toHaveLength(0);
  });
});
