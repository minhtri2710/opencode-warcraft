import { beforeEach, describe, expect, it } from 'bun:test';
import type { GitClient } from './git-client.js';
import { SimpleGitClient } from './simple-git-client.js';

/**
 * Test SimpleGitClient by creating a mock SimpleGit instance.
 *
 * We use a lightweight mock that implements the SimpleGit methods
 * needed by SimpleGitClient.
 */
type MockSimpleGit = {
  _calls: Record<string, unknown[]>;
  raw: (args: string[]) => Promise<string>;
  revparse: (args: string[]) => Promise<string>;
  diff: (args?: string[]) => Promise<string>;
  status: () => Promise<{
    files: never[];
    modified: string[];
    staged: string[];
    not_added: string[];
    deleted: string[];
    created: string[];
    conflicted: never[];
  }>;
  applyPatch: (path: string, options?: string[]) => Promise<void>;
  branch: () => Promise<{ current: string; all: string[] }>;
  log: () => Promise<{ all: Array<{ hash: string }> }>;
  add: (args: string[]) => Promise<void>;
  commit: (message: string, args?: string[]) => Promise<{ commit: string }>;
  merge: (args: string[]) => Promise<{ failed: boolean; conflicts: never[] }>;
  deleteLocalBranch: (branch: string, force?: boolean) => Promise<void>;
};

function createMockGit(): MockSimpleGit {
  const mockGit: Partial<MockSimpleGit> = {
    _calls: {},
  };

  // Track method calls for assertions
  const track = (method: string, args: unknown[]): void => {
    if (!mockGit._calls) {
      mockGit._calls = {};
    }
    if (!mockGit._calls[method]) {
      mockGit._calls[method] = [];
    }
    mockGit._calls[method].push(args);
  };

  mockGit.raw = async (args: string[]): Promise<string> => {
    track('raw', args);
    return '';
  };

  mockGit.revparse = async (args: string[]): Promise<string> => {
    track('revparse', args);
    return 'abc123';
  };

  mockGit.diff = async (args?: string[], cwd?: string): Promise<string> => {
    track('diff', [args, cwd]);
    return '';
  };

  mockGit.status = async (cwd?: string) => {
    track('status', [cwd]);
    return {
      files: [],
      modified: [],
      staged: [],
      not_added: [],
      deleted: [],
      created: [],
      conflicted: [],
    };
  };

  mockGit.applyPatch = async (path: string, options?: string[], cwd?: string): Promise<void> => {
    track('applyPatch', [path, options, cwd]);
  };

  mockGit.branch = async (cwd?: string) => {
    track('branch', [cwd]);
    return {
      current: 'main',
      all: ['main', 'feature/test'],
    };
  };

  mockGit.log = async (args?: string[], cwd?: string) => {
    track('log', [args, cwd]);
    return { all: [{ hash: 'abc123' }] };
  };

  mockGit.add = async (args: string[], exclude?: string[], cwd?: string): Promise<void> => {
    track('add', [args, exclude, cwd]);
  };

  mockGit.commit = async (message: string, args?: string[], cwd?: string): Promise<{ commit: string }> => {
    track('commit', [message, args, cwd]);
    return { commit: 'abc123' };
  };

  mockGit.merge = async (args: string[], cwd?: string) => {
    track('merge', [args, cwd]);
    return { failed: false, conflicts: [] };
  };

  mockGit.deleteLocalBranch = async (branch: string, force?: boolean, cwd?: string): Promise<void> => {
    track('deleteLocalBranch', [branch, force, cwd]);
  };

  mockGit.revparse = async (ref: string | string[], cwd?: string): Promise<string> => {
    track('revparse', [ref, cwd]);
    return 'abc123';
  };

  return mockGit as MockSimpleGit;
}

describe('SimpleGitClient', () => {
  let mockGit: MockSimpleGit;
  let client: GitClient;
  let cwdRequests: string[];

  beforeEach(() => {
    mockGit = createMockGit();
    client = new SimpleGitClient(mockGit as any);
    cwdRequests = [];
    (client as unknown as { withCwd: (cwd: string) => unknown }).withCwd = (cwd: string) => {
      cwdRequests.push(cwd);
      return mockGit as unknown;
    };
  });

  describe('worktree operations', () => {
    it('should add worktree with new branch', async () => {
      await client.worktreeAdd({
        path: '/tmp/worktree',
        branch: 'feature/test',
        commit: 'abc123',
      });

      expect(mockGit._calls.raw).toContainEqual(['worktree', 'add', '-b', 'feature/test', '/tmp/worktree', 'abc123']);
    });

    it('should add worktree with existing branch', async () => {
      await client.worktreeAddWithBranch({
        path: '/tmp/worktree',
        branch: 'feature/test',
      });

      expect(mockGit._calls.raw).toContainEqual(['worktree', 'add', '/tmp/worktree', 'feature/test']);
    });

    it('should remove worktree', async () => {
      await client.worktreeRemove('/tmp/worktree');

      expect(mockGit._calls.raw).toContainEqual(['worktree', 'remove', '/tmp/worktree', '--force']);
    });

    it('should prune worktrees', async () => {
      await client.worktreePrune();

      expect(mockGit._calls.raw).toContainEqual(['worktree', 'prune']);
    });
  });

  describe('diff operations', () => {
    it('should get diff between refs', async () => {
      const result = await client.diff('HEAD~1..HEAD');

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['HEAD~1..HEAD'], undefined]);
      expect(result).toBe('');
    });

    it('should get diff with cwd', async () => {
      const result = await client.diff('HEAD~1..HEAD', '/path/to/worktree');

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['HEAD~1..HEAD'], undefined]);
      expect(cwdRequests).toContain('/path/to/worktree');
      expect(result).toBe('');
    });

    it('should get diff stat', async () => {
      const result = await client.diffStat('HEAD~1..HEAD');

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['HEAD~1..HEAD', '--stat'], undefined]);
      expect(result).toBe('');
    });

    it('should get cached diff', async () => {
      const result = await client.diffCached();

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['--cached'], undefined]);
      expect(result).toBe('');
    });

    it('should get cached diff with cwd', async () => {
      const result = await client.diffCached('/path/to/worktree');

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['--cached'], undefined]);
      expect(cwdRequests).toContain('/path/to/worktree');
      expect(result).toBe('');
    });

    it('should get cached diff stat', async () => {
      const result = await client.diffCachedStat();

      expect(mockGit._calls.diff).toHaveLength(1);
      expect(mockGit._calls.diff[0]).toEqual([['--cached', '--stat'], undefined]);
      expect(result).toBe('');
    });
  });

  describe('status operations', () => {
    it('should get status', async () => {
      const result = await client.status();

      expect(mockGit._calls.status).toHaveLength(1);
      expect(result.modified).toEqual([]);
      expect(result.staged).toEqual([]);
      expect(result.not_added).toEqual([]);
      expect(result.deleted).toEqual([]);
      expect(result.created).toEqual([]);
    });
  });

  describe('patch operations', () => {
    it('should apply patch', async () => {
      await client.applyPatch('/tmp/patch.patch');

      expect(mockGit._calls.applyPatch).toContainEqual(['/tmp/patch.patch', undefined]);
    });

    it('should apply patch with reverse', async () => {
      await client.applyPatch('/tmp/patch.patch', { reverse: true });

      expect(mockGit._calls.applyPatch).toContainEqual(['/tmp/patch.patch', ['-R']]);
    });

    it('should check patch', async () => {
      await client.applyPatch('/tmp/patch.patch', { check: true });

      expect(mockGit._calls.applyPatch).toContainEqual(['/tmp/patch.patch', ['--check']]);
    });
  });

  describe('commit operations', () => {
    it('should add files', async () => {
      await client.add(['.', '--', ':!*.patch']);

      expect(mockGit._calls.add).toContainEqual([['.', '--', ':!*.patch'], undefined, undefined]);
    });

    it('should commit changes', async () => {
      const result = await client.commit('test message');

      expect(mockGit._calls.commit).toContainEqual(['test message', undefined, undefined]);
      expect(result.commit).toBe('abc123');
    });

    it('should commit with allow-empty-message', async () => {
      await client.commit('test message', { allowEmptyMessage: true });

      expect(mockGit._calls.commit).toContainEqual(['test message', ['--allow-empty-message'], undefined]);
    });

    it('should revparse HEAD', async () => {
      const result = await client.revparse('HEAD');

      expect(mockGit._calls.revparse).toContainEqual(['HEAD', undefined]);
      expect(result).toBe('abc123');
    });
  });

  describe('branch operations', () => {
    it('should get branch info', async () => {
      const result = await client.branch();

      expect(mockGit._calls.branch).toHaveLength(1);
      expect(result.current).toBe('main');
      expect(result.all).toEqual(['main', 'feature/test']);
    });

    it('should delete branch', async () => {
      await client.deleteBranch('feature/test', true);

      expect(mockGit._calls.deleteLocalBranch).toContainEqual(['feature/test', true]);
    });
  });

  describe('merge operations', () => {
    it('should merge branch', async () => {
      await client.merge('feature/test', { noFastForward: true, message: 'test' });

      expect(mockGit._calls.merge).toContainEqual([['feature/test', '--no-ff', '-m', 'test'], undefined]);
    });

    it('should squash merge', async () => {
      await client.mergeSquash('feature/test');

      expect(mockGit._calls.raw).toContainEqual(['merge', '--squash', 'feature/test']);
    });

    it('should abort merge', async () => {
      await client.mergeAbort();

      expect(mockGit._calls.raw).toContainEqual(['merge', '--abort']);
    });

    it('should abort rebase', async () => {
      await client.rebaseAbort();

      expect(mockGit._calls.raw).toContainEqual(['rebase', '--abort']);
    });

    it('should abort cherry-pick', async () => {
      await client.cherryPickAbort();

      expect(mockGit._calls.raw).toContainEqual(['cherry-pick', '--abort']);
    });
  });

  describe('log operations', () => {
    it('should get log', async () => {
      const result = await client.log('HEAD~1..HEAD');

      expect(mockGit._calls.log).toContainEqual([['HEAD~1..HEAD'], undefined]);
      expect(result.all).toHaveLength(1);
      expect(result.all[0].hash).toBe('abc123');
    });
  });

  describe('cherry-pick operations', () => {
    it('should cherry-pick commit', async () => {
      await client.cherryPick('abc123');

      expect(mockGit._calls.raw).toContainEqual(['cherry-pick', 'abc123']);
    });
  });
});
