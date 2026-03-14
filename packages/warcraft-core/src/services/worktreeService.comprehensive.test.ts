import { describe, expect, it } from 'bun:test';
import { WorktreeService, createWorktreeService } from './worktreeService.js';
import type { MergeStrategy, MergeOutcome } from './worktreeService.js';

describe('WorktreeService types', () => {
  it('MergeStrategy values', () => {
    const strategies: MergeStrategy[] = ['merge', 'squash', 'rebase'];
    expect(strategies.length).toBe(3);
  });

  it('createWorktreeService returns WorktreeService instance', () => {
    const service = createWorktreeService('/tmp/test-wt', 'off');
    expect(service).toBeInstanceOf(WorktreeService);
  });

  it('WorktreeService has expected methods', () => {
    const service = createWorktreeService('/tmp/test-wt', 'off');
    expect(typeof service.create).toBe('function');
    expect(typeof service.get).toBe('function');
    expect(typeof service.list).toBe('function');
    expect(typeof service.remove).toBe('function');
    expect(typeof service.getDiff).toBe('function');
    expect(typeof service.merge).toBe('function');
    expect(typeof service.commitChanges).toBe('function');
    expect(typeof service.hasUncommittedChanges).toBe('function');
    expect(typeof service.checkConflicts).toBe('function');
    expect(typeof service.prune).toBe('function');
    expect(typeof service.cleanup).toBe('function');
  });
});
