import { describe, expect, it } from 'bun:test';
import type { BranchResult, CommitResult, GitClient, LogResult, StatusResult } from './git-client.js';

describe('git-client types', () => {
  it('StatusResult has clean property', () => {
    const result: StatusResult = { isClean: true, files: [] };
    expect(result.isClean).toBe(true);
  });

  it('StatusResult with files', () => {
    const result: StatusResult = {
      isClean: false,
      files: [{ path: 'test.ts', index: 'M', working_dir: ' ' }],
    };
    expect(result.files).toHaveLength(1);
  });

  it('BranchResult has current', () => {
    const result: BranchResult = { current: 'main', all: ['main', 'develop'] };
    expect(result.current).toBe('main');
  });

  it('CommitResult has hash', () => {
    const result: CommitResult = { hash: 'abc1234', message: 'test commit' };
    expect(result.hash).toBe('abc1234');
  });

  it('LogResult has entries', () => {
    const result: LogResult = {
      all: [{ hash: 'abc', message: 'commit', date: '2024-01-01' }],
    };
    expect(result.all).toHaveLength(1);
  });

  it('GitClient interface shape', () => {
    const client: GitClient = {
      status: async () => ({ isClean: true, files: [] }),
      branch: async () => ({ current: 'main', all: ['main'] }),
      log: async () => ({ all: [] }),
      add: async () => {},
      commit: async () => ({ hash: '', message: '' }),
      diff: async () => '',
      merge: async () => ({ result: 'success' }),
    };
    expect(typeof client.status).toBe('function');
    expect(typeof client.branch).toBe('function');
  });
});
