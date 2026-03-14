import { describe, expect, it } from 'bun:test';
import type { TaskStatusType } from '../types.js';
import { computeRunnableAndBlocked, type TaskWithDeps } from './taskDependencyGraph.js';

function task(folder: string, status: TaskStatusType, deps: string[] = []): TaskWithDeps {
  return { folder, status, dependsOn: deps };
}

describe('taskDependencyGraph exhaustive status', () => {
  const ALL_STATUSES: TaskStatusType[] = [
    'pending',
    'in_progress',
    'dispatch_prepared',
    'done',
    'cancelled',
    'blocked',
    'failed',
    'partial',
  ];

  describe('single task with each status', () => {
    for (const status of ALL_STATUSES) {
      it(`${status} task categorized`, () => {
        const result = computeRunnableAndBlocked([task('01-a', status)]);
        // pending should be runnable, done/cancelled/etc should not
        if (status === 'pending') {
          expect(result.runnable).toContain('01-a');
        } else {
          expect(result.runnable).not.toContain('01-a');
        }
      });
    }
  });

  describe('dependency satisfaction per status', () => {
    for (const depStatus of ALL_STATUSES) {
      it(`pending task with ${depStatus} dep`, () => {
        const result = computeRunnableAndBlocked([task('01-dep', depStatus), task('02-child', 'pending', ['01-dep'])]);
        if (depStatus === 'done') {
          expect(result.runnable).toContain('02-child');
        } else {
          expect(result.blocked['02-child']).toBeDefined();
        }
      });
    }
  });

  describe('multiple statuses mixed', () => {
    it('done + pending + blocked chain', () => {
      const result = computeRunnableAndBlocked([
        task('01-a', 'done'),
        task('02-b', 'pending', ['01-a']),
        task('03-c', 'pending', ['02-b']),
        task('04-d', 'blocked'),
      ]);
      expect(result.runnable).toContain('02-b');
      expect(result.blocked['03-c']).toBeDefined();
    });

    it('all done leaves nothing runnable', () => {
      const result = computeRunnableAndBlocked([
        task('01-a', 'done'),
        task('02-b', 'done', ['01-a']),
        task('03-c', 'done', ['02-b']),
      ]);
      expect(result.runnable).toEqual([]);
    });

    it('failed dep blocks child', () => {
      const result = computeRunnableAndBlocked([task('01-a', 'failed'), task('02-b', 'pending', ['01-a'])]);
      expect(result.blocked['02-b']).toBeDefined();
    });

    it('partial dep blocks child', () => {
      const result = computeRunnableAndBlocked([task('01-a', 'partial'), task('02-b', 'pending', ['01-a'])]);
      expect(result.blocked['02-b']).toBeDefined();
    });
  });
});
