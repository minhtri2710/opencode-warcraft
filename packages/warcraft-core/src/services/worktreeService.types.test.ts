import { describe, expect, it } from 'bun:test';
import type { MergeStrategy, MergeSuccessOutcome, MergeFailureOutcome, MergeOutcome } from './worktreeService.js';

describe('worktreeService types', () => {
  it('MergeStrategy includes merge', () => {
    const strategy: MergeStrategy = 'merge';
    expect(strategy).toBe('merge');
  });

  it('MergeStrategy includes squash', () => {
    const strategy: MergeStrategy = 'squash';
    expect(strategy).toBe('squash');
  });

  it('MergeStrategy includes rebase', () => {
    const strategy: MergeStrategy = 'rebase';
    expect(strategy).toBe('rebase');
  });

  it('MergeSuccessOutcome includes merged', () => {
    const outcome: MergeSuccessOutcome = 'merged';
    expect(outcome).toBe('merged');
  });

  it('MergeSuccessOutcome includes already-up-to-date', () => {
    const outcome: MergeSuccessOutcome = 'already-up-to-date';
    expect(outcome).toBe('already-up-to-date');
  });

  it('MergeSuccessOutcome includes no-commits-to-apply', () => {
    const outcome: MergeSuccessOutcome = 'no-commits-to-apply';
    expect(outcome).toBe('no-commits-to-apply');
  });

  it('MergeFailureOutcome includes conflicted', () => {
    const outcome: MergeFailureOutcome = 'conflicted';
    expect(outcome).toBe('conflicted');
  });

  it('MergeFailureOutcome includes failed', () => {
    const outcome: MergeFailureOutcome = 'failed';
    expect(outcome).toBe('failed');
  });

  it('MergeOutcome accepts success outcomes', () => {
    const outcomes: MergeOutcome[] = ['merged', 'already-up-to-date', 'no-commits-to-apply'];
    expect(outcomes).toHaveLength(3);
  });

  it('MergeOutcome accepts failure outcomes', () => {
    const outcomes: MergeOutcome[] = ['conflicted', 'failed'];
    expect(outcomes).toHaveLength(2);
  });
});
