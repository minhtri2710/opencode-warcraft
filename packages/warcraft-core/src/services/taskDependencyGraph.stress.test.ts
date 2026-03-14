import { describe, expect, it } from 'bun:test';
import { computeRunnableAndBlocked, type TaskWithDeps } from './taskDependencyGraph.js';

function task(folder: string, status: string, deps: string[] = []): TaskWithDeps {
  return { folder, status: status as any, dependsOn: deps };
}

describe('taskDependencyGraph stress', () => {
  it('handles 50 independent tasks', () => {
    const tasks = Array.from({ length: 50 }, (_, i) => task(`${String(i).padStart(2, '0')}-task`, 'pending'));
    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable).toHaveLength(50);
  });

  it('handles long chain', () => {
    const tasks: TaskWithDeps[] = [];
    for (let i = 0; i < 20; i++) {
      const folder = `${String(i + 1).padStart(2, '0')}-step`;
      const deps = i > 0 ? [`${String(i).padStart(2, '0')}-step`] : [];
      tasks.push(task(folder, i === 0 ? 'done' : 'pending', deps));
    }
    const result = computeRunnableAndBlocked(tasks);
    expect(result.runnable).toHaveLength(1);
    expect(result.runnable[0]).toBe('02-step');
  });

  it('wide fan-out then fan-in', () => {
    const root = task('00-root', 'done');
    const middle = Array.from({ length: 5 }, (_, i) =>
      task(`${String(i + 1).padStart(2, '0')}-mid`, 'pending', ['00-root']),
    );
    const final = task(
      '10-final',
      'pending',
      middle.map((t) => t.folder),
    );
    const result = computeRunnableAndBlocked([root, ...middle, final]);
    expect(result.runnable).toHaveLength(5);
    expect(result.blocked['10-final']).toBeDefined();
  });

  it('mixed done and pending siblings', () => {
    const result = computeRunnableAndBlocked([
      task('01-a', 'done'),
      task('02-b', 'done'),
      task('03-c', 'pending'),
      task('04-d', 'pending'),
      task('05-e', 'pending', ['01-a', '02-b']),
    ]);
    expect(result.runnable).toContain('03-c');
    expect(result.runnable).toContain('04-d');
    expect(result.runnable).toContain('05-e');
  });
});
