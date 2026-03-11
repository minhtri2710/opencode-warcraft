/**
 * Tests for task dispatch learnings flow.
 *
 * Verifies:
 * - `fetchSharedDispatchData` includes learnings from done tasks only
 * - `fetchSharedDispatchData` excludes learnings from partial/blocked/failed tasks
 * - Learnings are folded into summary for budget-aware rendering
 * - Empty learnings arrays are handled gracefully
 * - Missing learnings are handled gracefully
 */

import { describe, expect, it } from 'bun:test';
import type { TaskStatus } from 'warcraft-core';
import { fetchSharedDispatchData, type TaskDispatchServices } from './task-dispatch.js';

// ============================================================================
// Test helpers
// ============================================================================

function createMockServices(
  tasks: Array<{
    folder: string;
    name: string;
    status: string;
    summary?: string;
    learnings?: string[];
  }>,
): TaskDispatchServices {
  // Build a lookup of raw statuses indexed by folder
  const statusMap = new Map<string, TaskStatus>();
  for (const t of tasks) {
    statusMap.set(t.folder, {
      status: t.status as TaskStatus['status'],
      origin: 'plan' as const,
      summary: t.summary,
      learnings: t.learnings,
    });
  }

  return {
    planService: {
      read: () => ({ content: '# Plan', status: 'approved' as const, comments: [] }),
    },
    taskService: {
      list: () =>
        tasks.map((t) => ({
          folder: t.folder,
          name: t.name,
          status: t.status as TaskStatus['status'],
          origin: 'plan' as const,
          planTitle: t.name,
          summary: t.summary,
        })),
      getRawStatus: (_feature: string, folder: string) => statusMap.get(folder) ?? null,
    } as unknown as TaskDispatchServices['taskService'],
    contextService: {
      list: () => [],
    },
    verificationModel: 'tdd',
  };
}

// ============================================================================
// fetchSharedDispatchData - learnings for done tasks
// ============================================================================

describe('fetchSharedDispatchData learnings', () => {
  it('includes learnings from done tasks', () => {
    const services = createMockServices([
      {
        folder: '01-setup',
        name: 'Setup',
        status: 'done',
        summary: 'Set up the project.',
        learnings: ['Use bun, not npm', 'Tests live next to source files'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].name).toBe('01-setup');
    expect(data.rawPreviousTasks[0].learnings).toEqual(['Use bun, not npm', 'Tests live next to source files']);
  });

  it('excludes learnings from partial tasks', () => {
    const services = createMockServices([
      {
        folder: '01-partial',
        name: 'Partial Task',
        status: 'partial',
        summary: 'Got halfway.',
        learnings: ['Should not appear'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    // partial tasks should not be in rawPreviousTasks at all
    expect(data.rawPreviousTasks).toHaveLength(0);
  });

  it('excludes learnings from blocked tasks', () => {
    const services = createMockServices([
      {
        folder: '01-blocked',
        name: 'Blocked Task',
        status: 'blocked',
        summary: 'Blocked on something.',
        learnings: ['Should not appear'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(0);
  });

  it('excludes learnings from failed tasks', () => {
    const services = createMockServices([
      {
        folder: '01-failed',
        name: 'Failed Task',
        status: 'failed',
        summary: 'Failed hard.',
        learnings: ['Should not appear'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(0);
  });

  it('excludes summaries from blocked tasks even when learnings exist', () => {
    const services = createMockServices([
      {
        folder: '01-blocked',
        name: 'Blocked Task',
        status: 'blocked',
        summary: 'Blocked summary should not flow downstream.',
        learnings: ['Should not appear downstream'],
      },
      {
        folder: '02-done',
        name: 'Done Task',
        status: 'done',
        summary: 'Completed summary should remain available.',
        learnings: ['Only completed learnings should appear'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].name).toBe('02-done');
    expect(data.rawPreviousTasks[0].summary).toContain('Completed summary should remain available.');
    expect(data.rawPreviousTasks[0].summary).toContain('Only completed learnings should appear');
    expect(data.rawPreviousTasks[0].summary).not.toContain('Blocked summary should not flow downstream.');
    expect(data.rawPreviousTasks[0].summary).not.toContain('Should not appear downstream');
  });

  it('handles done tasks with empty learnings array', () => {
    const services = createMockServices([
      {
        folder: '01-empty',
        name: 'Empty Learnings',
        status: 'done',
        summary: 'Completed task.',
        learnings: [],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
  });

  it('handles done tasks with no learnings (undefined)', () => {
    const services = createMockServices([
      {
        folder: '01-none',
        name: 'No Learnings',
        status: 'done',
        summary: 'Completed task.',
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
  });

  it('folds learnings into summary for budget-aware rendering', () => {
    const services = createMockServices([
      {
        folder: '01-setup',
        name: 'Setup',
        status: 'done',
        summary: 'Set up the project.',
        learnings: ['Use bun, not npm', 'ESM requires .js extensions'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    // Summary should contain the original summary plus learnings bullets
    expect(data.rawPreviousTasks[0].summary).toContain('Set up the project.');
    expect(data.rawPreviousTasks[0].summary).toContain('Use bun, not npm');
    expect(data.rawPreviousTasks[0].summary).toContain('ESM requires .js extensions');
  });

  it('preserves summary unchanged when no learnings exist', () => {
    const services = createMockServices([
      {
        folder: '01-plain',
        name: 'Plain Task',
        status: 'done',
        summary: 'Just a plain task.',
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks[0].summary).toBe('Just a plain task.');
  });
});

// ============================================================================
// fetchSharedDispatchData - malformed persisted learnings (runtime guards)
// ============================================================================

describe('fetchSharedDispatchData malformed learnings runtime guards', () => {
  it('does not crash when persisted learnings is a string (not array)', () => {
    const services = createMockServices([
      {
        folder: '01-corrupt',
        name: 'Corrupt Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: 'not an array' as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
    // Summary should not contain malformed learnings
    expect(data.rawPreviousTasks[0].summary).toBe('Completed OK.');
  });

  it('does not crash when persisted learnings is a number', () => {
    const services = createMockServices([
      {
        folder: '01-number',
        name: 'Number Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: 42 as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
    expect(data.rawPreviousTasks[0].summary).toBe('Completed OK.');
  });

  it('does not crash when persisted learnings is an object', () => {
    const services = createMockServices([
      {
        folder: '01-object',
        name: 'Object Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: { key: 'value' } as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
    expect(data.rawPreviousTasks[0].summary).toBe('Completed OK.');
  });

  it('filters out non-string elements from persisted learnings array', () => {
    const services = createMockServices([
      {
        folder: '01-mixed',
        name: 'Mixed Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: ['valid learning', 42, null, 'another valid', { obj: true }] as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toEqual(['valid learning', 'another valid']);
    expect(data.rawPreviousTasks[0].summary).toContain('valid learning');
    expect(data.rawPreviousTasks[0].summary).toContain('another valid');
  });

  it('filters out empty strings from persisted learnings array', () => {
    const services = createMockServices([
      {
        folder: '01-empty-strings',
        name: 'Empty String Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: ['valid learning', '', '  ', 'another valid'],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toEqual(['valid learning', 'another valid']);
  });

  it('treats all-invalid learnings array same as no learnings', () => {
    const services = createMockServices([
      {
        folder: '01-all-invalid',
        name: 'All Invalid Learnings',
        status: 'done',
        summary: 'Completed OK.',
        learnings: [42, null, '', '  '] as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    expect(data.rawPreviousTasks).toHaveLength(1);
    expect(data.rawPreviousTasks[0].learnings).toBeUndefined();
    expect(data.rawPreviousTasks[0].summary).toBe('Completed OK.');
  });

  it('does not pollute summary with malformed learnings', () => {
    const services = createMockServices([
      {
        folder: '01-no-pollution',
        name: 'No Pollution',
        status: 'done',
        summary: 'Original summary only.',
        learnings: 'string not array' as unknown as string[],
      },
    ]);

    const data = fetchSharedDispatchData('test-feature', services);

    // Summary must remain exactly the original
    expect(data.rawPreviousTasks[0].summary).toBe('Original summary only.');
    expect(data.rawPreviousTasks[0].summary).not.toContain('Learnings');
    expect(data.rawPreviousTasks[0].summary).not.toContain('string not array');
  });
});
