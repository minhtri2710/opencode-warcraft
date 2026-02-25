import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorktreeService } from './worktreeService';

class FakeBeadsModeProvider {
  constructor(private readonly mode: 'on' | 'off') {}

  getBeadsMode(): 'on' | 'off' {
    return this.mode;
  }
}


let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-worktree-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createService(mode: 'on' | 'off'): WorktreeService {
  return new WorktreeService(
    { baseDir: testRoot, warcraftDir: mode === 'off' ? path.join(testRoot, 'docs') : path.join(testRoot, '.beads', 'artifacts') },
    new FakeBeadsModeProvider(mode),
    { syncTaskStatus: () => {} } as any,
  );
}

describe('WorktreeService helpers', () => {
  it('returns canonical tasks status path only', async () => {
    const service = createService('off');
    const v2 = path.join(testRoot, 'docs', 'feat', 'tasks', '01-task', 'status.json');

    const statusPath = await (service as any).getStepStatusPath('feat', '01-task');
    expect(statusPath).toBe(v2);
  });

  it('derives default base commit from git history count', async () => {
    const service = createService('off');

    const manyCommits = await (service as any).getDefaultBaseCommit({
      raw: async (): Promise<string> => '5\n',
    });
    const singleCommit = await (service as any).getDefaultBaseCommit({
      raw: async (): Promise<string> => '1\n',
    });
    const parseFailure = await (service as any).getDefaultBaseCommit({
      raw: async (): Promise<string> => 'not-a-number\n',
    });

    expect(manyCommits).toBe('HEAD~1');
    expect(singleCommit).toBe('HEAD');
    expect(parseFailure).toBe('HEAD');
  });

  it('parses conflict file names from merge error output', () => {
    const service = createService('off');
    const conflicts = (service as any).parseConflictsFromError(
      'CONFLICT (content): Merge conflict in src/a.ts\nCONFLICT (add/add): Merge conflict in src/b.ts\n',
    );

    expect(conflicts).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('WorktreeService path sanitization', () => {
  it('rejects path traversal in feature name', () => {
    const service = createService('off');
    expect(() => (service as any).getWorktreePath('../../etc/passwd', '01-task')).toThrow();
  });

  it('rejects path traversal in step name', () => {
    const service = createService('off');
    expect(() => (service as any).getWorktreePath('my-feature', '../../etc/passwd')).toThrow();
  });

  it('rejects dot-dot in step status path', () => {
    const service = createService('off');
    expect(() => (service as any).getStepStatusPath('my-feature', '..')).toThrow();
  });

  it('rejects path traversal in branch name', () => {
    const service = createService('off');
    expect(() => (service as any).getBranchName('../escape', '01-task')).toThrow();
  });

  it('accepts valid feature and step names', () => {
    const service = createService('off');
    const worktreePath = (service as any).getWorktreePath('my-feature', '01-setup');
    expect(worktreePath).toContain('my-feature');
    expect(worktreePath).toContain('01-setup');
    expect(worktreePath).not.toContain('..');
  });
});

describe('WorktreeService commitChanges staging', () => {
  it('uses pathspec to exclude .patch files from staging', async () => {
    const service = createService('off');
    const addCalls: any[][] = [];
    const mockGit = {
      add: async (...args: any[]) => { addCalls.push(args); },
      status: async () => ({ staged: ['file.ts'], modified: [], not_added: [] }),
      revparse: async () => 'abc123',
      commit: async (_msg: string) => ({ commit: 'def456' }),
    };

    // Override getGit to return mock
    (service as any).getGit = () => mockGit;

    // Set up worktree directory at the correct off-mode path (docs/.worktrees)
    const wtDir = path.join(testRoot, 'docs', '.worktrees', 'feat', '01-step');
    fs.mkdirSync(wtDir, { recursive: true });

    // Call commitChanges
    const result = await service.commitChanges('feat', '01-step', 'test commit');

    // Verify add was called with pathspec exclusion
    expect(addCalls.length).toBeGreaterThanOrEqual(1);
    const addArgs = addCalls[0][0];
    expect(addArgs).toEqual(['.', '--', ':!*.patch']);
  });
});
