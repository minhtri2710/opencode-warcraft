import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorktreeService, WorktreeService } from './worktreeService';

// ============================================================================
// Test Helpers
// ============================================================================

let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-worktree-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createService(mode: 'on' | 'off'): WorktreeService {
  return new WorktreeService({
    baseDir: testRoot,
    warcraftDir: mode === 'off' ? path.join(testRoot, 'docs') : path.join(testRoot, '.beads', 'artifacts'),
    beadsMode: mode,
    gitFactory: () => createMockGit() as any,
  });
}

/**
 * Create a mock git object that records calls and returns canned responses.
 * Mirrors the GitClient port interface methods used by WorktreeService.
 */
function createMockGit(overrides: Record<string, (...args: any[]) => any> = {}): Record<string, any> {
  const raw = overrides.raw ?? (async () => '');
  const diff = overrides.diff ?? (async () => '');

  return {
    raw,
    worktreeAdd:
      overrides.worktreeAdd ??
      (async ({ path, branch, commit }: { path: string; branch: string; commit?: string }) => {
        const args = ['worktree', 'add'];
        if (commit) {
          args.push('-b', branch, path, commit);
        } else {
          args.push(path, branch);
        }
        await raw(args);
      }),
    worktreeAddWithBranch:
      overrides.worktreeAddWithBranch ??
      (async ({ path, branch }: { path: string; branch: string }) => {
        await raw(['worktree', 'add', path, branch]);
      }),
    worktreeRemove: overrides.worktreeRemove ?? (async (path: string) => raw(['worktree', 'remove', path, '--force'])),
    worktreePrune: overrides.worktreePrune ?? (async () => raw(['worktree', 'prune'])),
    revparse: overrides.revparse ?? (async () => 'abc123def'),
    status:
      overrides.status ??
      (async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      })),
    add: overrides.add ?? (async () => {}),
    commit: overrides.commit ?? (async () => ({ commit: 'def456' })),
    diff,
    diffStat: overrides.diffStat ?? (async (refspec: string) => diff([refspec, '--stat'])),
    diffCached: overrides.diffCached ?? (async () => diff(['--cached'])),
    diffCachedStat: overrides.diffCachedStat ?? (async () => diff(['--cached', '--stat'])),
    branch:
      overrides.branch ??
      (async () => ({
        current: 'main',
        all: ['main'],
      })),
    deleteBranch:
      overrides.deleteBranch ??
      (async (branchName: string, force?: boolean) => {
        await raw(['branch', force ? '-D' : '-d', branchName]);
      }),
    merge:
      overrides.merge ??
      (async () => ({
        failed: false,
        conflicts: [],
      })),
    mergeSquash: overrides.mergeSquash ?? (async (branchName: string) => raw(['merge', '--squash', branchName])),
    mergeAbort: overrides.mergeAbort ?? (async () => raw(['merge', '--abort'])),
    log:
      overrides.log ??
      (async () => ({
        all: [],
      })),
    cherryPick: overrides.cherryPick ?? (async (commitSha: string) => raw(['cherry-pick', commitSha])),
    cherryPickAbort: overrides.cherryPickAbort ?? (async () => raw(['cherry-pick', '--abort'])),
    rebaseAbort: overrides.rebaseAbort ?? (async () => raw(['rebase', '--abort'])),
    applyPatch: overrides.applyPatch ?? (async () => {}),
  };
}

/**
 * Setup a worktree directory so fs.access checks pass in the service.
 */
function setupWorktreeDir(service: WorktreeService, feature: string, step: string): string {
  const wtPath = (service as any).getWorktreePath(feature, step);
  fs.mkdirSync(wtPath, { recursive: true });
  return wtPath;
}

// ============================================================================
// Helper / Private Method Tests (preserved from original)
// ============================================================================

describe('WorktreeService helpers', () => {
  it('returns canonical tasks status path only', async () => {
    const service = createService('off');
    const v2 = path.join(testRoot, 'docs', 'feat', 'tasks', '01-task', 'status.json');

    const statusPath = await (service as any).getStepStatusPath('feat', '01-task');
    expect(statusPath).toBe(v2);
  });

  it('returns null status path in on-mode service', async () => {
    const service = createService('on');

    const statusPath = await (service as any).getStepStatusPath('feat', '01-task');
    expect(statusPath).toBeNull();
  });

  it('revertFromSavedDiff applies the saved patch file path in reverse', async () => {
    const service = createService('off');
    const diffPath = path.join(testRoot, 'saved.patch');
    const diffContent = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '',
    ].join('\n');
    fs.writeFileSync(diffPath, diffContent, 'utf-8');

    const applyCalls: Array<{ patchPath: string; options?: string[] }> = [];
    (service as any).getGit = () => ({
      applyPatch: async (patchPath: string, options?: string[]) => {
        applyCalls.push({ patchPath, options });
      },
    });

    const result = await service.revertFromSavedDiff(diffPath);

    expect(result).toEqual({ success: true, filesAffected: ['src/a.ts'] });
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0]).toEqual({ patchPath: diffPath, options: ['-R'] });
  });

  it('parses conflict file names from merge error output', () => {
    const service = createService('off');
    const conflicts = (service as any).parseConflictsFromError(
      'CONFLICT (content): Merge conflict in src/a.ts\nCONFLICT (add/add): Merge conflict in src/b.ts\n',
    );

    expect(conflicts).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('parseConflictsFromError returns empty array for non-conflict errors', () => {
    const service = createService('off');
    const conflicts = (service as any).parseConflictsFromError('fatal: not a git repository');
    expect(conflicts).toEqual([]);
  });

  it('getBranchName produces expected format', () => {
    const service = createService('off');
    const branch = (service as any).getBranchName('my-feature', '01-setup');
    expect(branch).toBe('warcraft/my-feature/01-setup');
  });

  it('uses on-mode worktree dir when constructed with on mode', () => {
    const service = createService('on');
    const worktreesDir = (service as any).getWorktreesDir();
    expect(worktreesDir).toBe(path.join(testRoot, '.beads', 'artifacts', '.worktrees'));
  });

  it('uses off-mode worktree dir when constructed with off mode', () => {
    const service = createService('off');
    const worktreesDir = (service as any).getWorktreesDir();
    expect(worktreesDir).toBe(path.join(testRoot, 'docs', '.worktrees'));
  });
});

// ============================================================================
// Path Sanitization Tests (preserved from original)
// ============================================================================

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

// ============================================================================
// create() Tests
// ============================================================================

describe('WorktreeService.create', () => {
  it('creates a worktree and returns WorktreeInfo on happy path', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];

    const mockGit = createMockGit({
      revparse: async () => 'base-sha-123',
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    // Ensure lock parent dir exists
    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    const result = await service.create('my-feature', '01-setup');

    expect(result.mode).toBe('worktree');
    expect(result.feature).toBe('my-feature');
    expect(result.step).toBe('01-setup');
    expect(result.branch).toBe('warcraft/my-feature/01-setup');
    expect(result.commit).toBe('base-sha-123');
    expect(result.path).toContain('my-feature');
    expect(result.path).toContain('01-setup');

    // Should have called worktree add
    const worktreeAddCall = rawCalls.find((c) => c.includes('worktree') && c.includes('add'));
    expect(worktreeAddCall).toBeDefined();
  });

  it('returns existing worktree if it already exists', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'existing-sha-456',
    });
    (service as any).getGit = () => mockGit;

    // Create the worktree directory so get() finds it
    const wtPath = setupWorktreeDir(service, 'my-feature', '01-setup');

    // Ensure lock parent dir exists
    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    const result = await service.create('my-feature', '01-setup');

    expect(result.mode).toBe('worktree');
    expect(result.path).toBe(wtPath);
    expect(result.commit).toBe('existing-sha-456');
    expect(result.branch).toBe('warcraft/my-feature/01-setup');
  });

  it('retries with existing branch when initial create fails', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];
    let callCount = 0;

    const mockGit = createMockGit({
      revparse: async () => 'retry-sha-789',
      raw: async (...args: any[]) => {
        callCount++;
        const flatArgs = args.flat();
        rawCalls.push(flatArgs);
        // First worktree add fails, second succeeds
        if (callCount === 1 && flatArgs.includes('-b')) {
          throw new Error('branch already exists');
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    const result = await service.create('my-feature', '02-impl');

    expect(result.mode).toBe('worktree');
    expect(result.feature).toBe('my-feature');
    expect(result.step).toBe('02-impl');
    // Should have tried twice: first with -b, then without
    const worktreeCalls = rawCalls.filter((c) => c.includes('worktree'));
    expect(worktreeCalls.length).toBe(2);
    expect(worktreeCalls[0]).toContain('-b');
    expect(worktreeCalls[1]).not.toContain('-b');
  });

  it('throws when both create attempts fail', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      revparse: async () => 'fail-sha',
      raw: async () => {
        throw new Error('worktree add failed');
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await expect(service.create('my-feature', '03-fail')).rejects.toThrow('Failed to create worktree');
  });

  it('returns direct workspace when git repository is unavailable', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => {
        throw new Error('fatal: not a git repository');
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    const result = await service.create('my-feature', '05-direct');

    expect(result).toEqual({
      mode: 'direct',
      path: testRoot,
      feature: 'my-feature',
      step: '05-direct',
    });
  });

  it('uses provided baseBranch when given', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];

    const mockGit = createMockGit({
      revparse: async () => 'custom-base-sha',
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await service.create('my-feature', '04-custom', 'develop');

    const addCall = rawCalls.find((c) => c.includes('worktree') && c.includes('add'));
    expect(addCall).toBeDefined();
    // baseBranch 'develop' should be the last arg in: worktree add -b <branch> <path> <base>
    expect(addCall).toContain('develop');
  });
});

// ============================================================================
// get() Tests
// ============================================================================

describe('WorktreeService.get', () => {
  it('returns WorktreeInfo when worktree exists', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'get-sha-abc',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.get('feat', '01-step');

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('worktree');
    expect(result!.feature).toBe('feat');
    expect(result!.step).toBe('01-step');
    expect(result!.branch).toBe('warcraft/feat/01-step');
    expect(result!.commit).toBe('get-sha-abc');
  });

  it('returns null when worktree does not exist', async () => {
    const service = createService('off');
    const result = await service.get('nonexistent', 'step');
    expect(result).toBeNull();
  });
});

// ============================================================================
// merge() Tests
// ============================================================================

describe('WorktreeService.merge', () => {
  it('reports merged outcome and actual changed files for merge strategy', async () => {
    const service = createService('off');
    const diffStatCalls: string[] = [];
    const revparseValues = ['main-sha-000', 'merge-sha-111'];

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/01-step'],
      }),
      log: async () => ({
        all: [{ hash: 'commit-a' }],
      }),
      diffStat: async (refspec: string) => {
        diffStatCalls.push(refspec);
        if (refspec === 'main-sha-000..merge-sha-111') {
          return ' src/actual.ts | 5 +++--\n 1 file changed\n';
        }
        return '';
      },
      merge: async () => ({
        failed: false,
        conflicts: [],
        result: 'success',
        files: [],
      }),
      revparse: async () => revparseValues.shift() ?? 'merge-sha-111',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '01-step', 'merge');

    expect(result).toEqual({
      success: true,
      outcome: 'merged',
      strategy: 'merge',
      sha: 'merge-sha-111',
      filesChanged: ['src/actual.ts'],
      conflicts: [],
    });
    expect(diffStatCalls).toEqual(['main-sha-000..merge-sha-111']);
  });

  it('reports merged outcome for squash strategy', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];
    const revparseValues = ['main-sha-000'];

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/02-squash'],
      }),
      log: async () => ({
        all: [{ hash: 'commit-squash' }],
      }),
      diffStat: async (refspec: string) => {
        expect(refspec).toBe('main-sha-000..squash-sha-222');
        return ' src/b.ts | 3 +++\n 1 file changed\n';
      },
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
      commit: async () => ({ commit: 'squash-sha-222' }),
      revparse: async () => revparseValues.shift() ?? 'squash-sha-222',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '02-squash', 'squash');

    expect(result).toEqual({
      success: true,
      outcome: 'merged',
      strategy: 'squash',
      sha: 'squash-sha-222',
      filesChanged: ['src/b.ts'],
      conflicts: [],
    });

    const squashCall = rawCalls.find((c) => c.includes('--squash'));
    expect(squashCall).toBeDefined();
  });

  it('reports merged outcome for rebase strategy via cherry-pick', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];
    const revparseValues = ['main-sha-000', 'rebase-sha-333'];

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/03-rebase'],
      }),
      log: async () => ({
        all: [{ hash: 'commit-a' }, { hash: 'commit-b' }],
      }),
      diffStat: async (refspec: string) => {
        expect(refspec).toBe('main-sha-000..rebase-sha-333');
        return ' src/c.ts | 2 +-\n 1 file changed\n';
      },
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
      revparse: async () => revparseValues.shift() ?? 'rebase-sha-333',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '03-rebase', 'rebase');

    expect(result).toEqual({
      success: true,
      outcome: 'merged',
      strategy: 'rebase',
      sha: 'rebase-sha-333',
      filesChanged: ['src/c.ts'],
      conflicts: [],
    });

    const cherryPicks = rawCalls.filter((c) => c.includes('cherry-pick'));
    expect(cherryPicks.length).toBe(2);
    expect(cherryPicks[0]).toContain('commit-b');
    expect(cherryPicks[1]).toContain('commit-a');
  });

  it('returns already-up-to-date when merge branch has no new commits', async () => {
    const service = createService('off');
    let mergeCalled = false;

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/04-up-to-date'],
      }),
      log: async () => ({
        all: [],
      }),
      merge: async () => {
        mergeCalled = true;
        return { failed: false, conflicts: [], result: 'success', files: [] };
      },
      revparse: async () => 'main-sha-000',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '04-up-to-date', 'merge');

    expect(result).toEqual({
      success: true,
      outcome: 'already-up-to-date',
      strategy: 'merge',
      sha: 'main-sha-000',
      filesChanged: [],
      conflicts: [],
    });
    expect(mergeCalled).toBe(false);
  });

  it('returns no-commits-to-apply when squash branch has no new commits', async () => {
    const service = createService('off');
    let mergeSquashCalled = false;

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/05-no-squash'],
      }),
      log: async () => ({
        all: [],
      }),
      mergeSquash: async () => {
        mergeSquashCalled = true;
      },
      revparse: async () => 'main-sha-000',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '05-no-squash', 'squash');

    expect(result).toEqual({
      success: true,
      outcome: 'no-commits-to-apply',
      strategy: 'squash',
      sha: 'main-sha-000',
      filesChanged: [],
      conflicts: [],
    });
    expect(mergeSquashCalled).toBe(false);
  });

  it('returns no-commits-to-apply when rebase branch has no new commits', async () => {
    const service = createService('off');
    let cherryPickCalled = false;

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/06-no-rebase'],
      }),
      log: async () => ({
        all: [],
      }),
      cherryPick: async () => {
        cherryPickCalled = true;
      },
      revparse: async () => 'main-sha-000',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '06-no-rebase', 'rebase');

    expect(result).toEqual({
      success: true,
      outcome: 'no-commits-to-apply',
      strategy: 'rebase',
      sha: 'main-sha-000',
      filesChanged: [],
      conflicts: [],
    });
    expect(cherryPickCalled).toBe(false);
  });

  it('returns failed outcome when branch does not exist', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main'],
      }),
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', 'nonexistent');

    expect(result).toEqual({
      success: false,
      outcome: 'failed',
      strategy: 'merge',
      filesChanged: [],
      conflicts: [],
      error: 'Branch warcraft/feat/nonexistent not found',
    });
  });

  it('returns conflicted outcome when merge hits conflicts', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/07-conflict'],
      }),
      log: async () => ({
        all: [{ hash: 'commit-conflict' }],
      }),
      merge: async () => {
        throw new Error(
          'CONFLICT (content): Merge conflict in src/conflict.ts\nAutomatic merge failed; fix conflicts and then commit the result.',
        );
      },
      raw: async () => '',
      revparse: async () => 'main-sha-000',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '07-conflict');

    expect(result).toEqual({
      success: false,
      outcome: 'conflicted',
      strategy: 'merge',
      sha: 'main-sha-000',
      filesChanged: [],
      conflicts: ['src/conflict.ts'],
      error: 'Merge conflicts detected',
    });
  });

  it('returns failed outcome for non-conflict merge errors', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      branch: async () => ({
        current: 'main',
        all: ['main', 'warcraft/feat/08-error'],
      }),
      log: async () => ({
        all: [{ hash: 'commit-error' }],
      }),
      merge: async () => {
        throw new Error('fatal: repository corrupted');
      },
      revparse: async () => 'main-sha-000',
    });
    (service as any).getGit = () => mockGit;

    const result = await service.merge('feat', '08-error');

    expect(result).toEqual({
      success: false,
      outcome: 'failed',
      strategy: 'merge',
      sha: 'main-sha-000',
      filesChanged: [],
      conflicts: [],
      error: 'fatal: repository corrupted',
    });
  });
});

// ============================================================================
// remove() Tests
// ============================================================================

describe('WorktreeService.remove', () => {
  it('removes worktree and prunes', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];

    const mockGit = createMockGit({
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await service.remove('feat', '01-step');

    const removeCall = rawCalls.find((c) => c.includes('worktree') && c.includes('remove'));
    expect(removeCall).toBeDefined();

    const pruneCall = rawCalls.find((c) => c.includes('worktree') && c.includes('prune'));
    expect(pruneCall).toBeDefined();
  });

  it('deletes branch when deleteBranch flag is true', async () => {
    const service = createService('off');
    let deletedBranch = '';

    const mockGit = createMockGit({
      raw: async () => '',
      deleteBranch: async (name: string) => {
        deletedBranch = name;
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await service.remove('feat', '01-step', true);

    expect(deletedBranch).toBe('warcraft/feat/01-step');
  });

  it('does not delete branch when deleteBranch flag is false', async () => {
    const service = createService('off');
    let deleteCalled = false;

    const mockGit = createMockGit({
      raw: async () => '',
      deleteBranch: async () => {
        deleteCalled = true;
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await service.remove('feat', '01-step', false);

    expect(deleteCalled).toBe(false);
  });

  it('falls back to fs.rm when git worktree remove fails', async () => {
    const service = createService('off');
    const rawCalls: string[][] = [];

    const wtPath = setupWorktreeDir(service, 'feat', '01-step');
    // Place a file inside so we can verify cleanup
    fs.writeFileSync(path.join(wtPath, 'file.txt'), 'content');

    const mockGit = createMockGit({
      raw: async (...args: any[]) => {
        const flatArgs = args.flat();
        rawCalls.push(flatArgs);
        if (flatArgs.includes('remove')) {
          throw new Error('worktree remove failed');
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });

    await service.remove('feat', '01-step');

    // Directory should be cleaned up via fs.rm fallback
    expect(fs.existsSync(wtPath)).toBe(false);
  });
});

// ============================================================================
// commitChanges() Tests
// ============================================================================

describe('WorktreeService.commitChanges', () => {
  it('stages, commits, and returns sha on happy path', async () => {
    const service = createService('off');
    const addCalls: any[][] = [];

    const mockGit = createMockGit({
      add: async (...args: any[]) => {
        addCalls.push(args);
      },
      status: async () => ({
        staged: ['file.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      commit: async () => ({ commit: 'commit-sha-999' }),
      revparse: async () => 'commit-sha-999',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.commitChanges('feat', '01-step', 'test commit msg');

    expect(result.committed).toBe(true);
    expect(result.sha).toBe('commit-sha-999');
    expect(result.message).toBe('test commit msg');
    expect(addCalls.length).toBeGreaterThanOrEqual(1);
    expect(addCalls[0][0]).toEqual(['.', '--', ':!*.patch']);
  });

  it('returns committed=false when there are no changes', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      add: async () => {},
      status: async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      revparse: async () => 'no-change-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.commitChanges('feat', '01-step', 'nothing to commit');

    expect(result.committed).toBe(false);
    expect(result.sha).toBe('no-change-sha');
    expect(result.message).toBe('No changes to commit');
  });

  it('returns committed=false when worktree directory does not exist', async () => {
    const service = createService('off');

    const result = await service.commitChanges('nonexistent', 'step');

    expect(result.committed).toBe(false);
    expect(result.sha).toBe('');
    expect(result.message).toBe('Worktree not found');
  });

  it('uses default commit message when none provided', async () => {
    const service = createService('off');
    let committedMessage = '';

    const mockGit = createMockGit({
      add: async () => {},
      status: async () => ({
        staged: ['file.ts'],
        modified: [],
        not_added: [],
      }),
      commit: async (msg: string) => {
        committedMessage = msg;
        return { commit: 'default-msg-sha' };
      },
      revparse: async () => 'default-msg-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.commitChanges('feat', '01-step');

    expect(result.committed).toBe(true);
    expect(committedMessage).toBe('warcraft(01-step): task changes');
  });

  it('handles commit failure gracefully', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      add: async () => {},
      status: async () => ({
        staged: ['file.ts'],
        modified: [],
        not_added: [],
      }),
      commit: async () => {
        throw new Error('commit failed: permission denied');
      },
      revparse: async () => 'fallback-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.commitChanges('feat', '01-step', 'will fail');

    expect(result.committed).toBe(false);
    expect(result.message).toContain('commit failed');
  });
});

// ============================================================================
// getDiff() Tests
// ============================================================================

describe('WorktreeService.getDiff', () => {
  it('returns diff with file stats for staged changes', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/a.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('HEAD') && values.includes('--stat')) {
          return ' src/a.ts | 5 +++--\n 1 file changed, 3 insertions(+), 2 deletions(-)\n';
        }
        if (values.includes('HEAD')) {
          return 'diff --git a/src/a.ts b/src/a.ts\n+added line\n';
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.getDiff('feat', '01-step', 'HEAD');

    expect(result.hasDiff).toBe(true);
    expect(result.diffContent).toContain('added line');
    expect(result.filesChanged).toContain('src/a.ts');
    expect(result.insertions).toBe(3);
    expect(result.deletions).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it('returns diff between base and HEAD for unstaged changes', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: ['src/b.ts'],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('abc123') && values.includes('--stat')) {
          return ' src/b.ts | 10 ++++++++++\n 1 file changed, 10 insertions(+)\n';
        }
        if (values.includes('abc123')) {
          return 'diff --git a/src/b.ts b/src/b.ts\n+new content\n';
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '02-step');

    const result = await service.getDiff('feat', '02-step', 'abc123');

    expect(result.hasDiff).toBe(true);
    expect(result.diffContent).toContain('new content');
    expect(result.insertions).toBe(10);
    expect(result.deletions).toBe(0);
  });

  it('returns empty diff when no changes exist', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async () => '',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '03-step');

    const result = await service.getDiff('feat', '03-step', 'HEAD');

    expect(result.hasDiff).toBe(false);
    expect(result.diffContent).toBe('');
    expect(result.filesChanged).toEqual([]);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('returns error result when git operations fail', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => {
        throw new Error('git status failed');
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '04-step');

    const result = await service.getDiff('feat', '04-step', 'HEAD');

    expect(result.hasDiff).toBe(false);
    expect(result.error).toContain('getDiff failed');
    expect(result.error).toContain('git status failed');
  });

  it('reads baseCommit from status.json when not provided', async () => {
    const service = createService('off');

    // Write a status.json with baseCommit
    const statusPath = (service as any).getStepStatusPath('feat', '05-step');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({ baseCommit: 'status-base-sha' }));

    let capturedBase = '';
    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        const refArg = values.find((a: string) => a.includes('..HEAD'));
        if (refArg) capturedBase = refArg;
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '05-step');

    await service.getDiff('feat', '05-step');

    expect(capturedBase).toBe('status-base-sha..HEAD');
  });

  it('returns explicit error in beads mode when baseCommit is missing', async () => {
    const service = createService('on');
    setupWorktreeDir(service, 'feat', '06-step');

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await service.getDiff('feat', '06-step');

      expect(result.hasDiff).toBe(false);
      expect(result.error).toContain('Missing base commit');
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('uses the provided non-HEAD base for dirty worktrees instead of rejecting staged changes', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/staged.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('abc123') && values.includes('--stat')) {
          return ' src/staged.ts | 2 ++\n 1 file changed, 2 insertions(+)\n';
        }
        if (values.includes('abc123')) {
          return 'diff --git a/src/staged.ts b/src/staged.ts\n+line 1\n+line 2\n';
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '07-step');

    const result = await service.getDiff('feat', '07-step', 'abc123');

    expect(result.hasDiff).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.filesChanged).toEqual(['src/staged.ts']);
    expect(result.insertions).toBe(2);
  });
});

// ============================================================================
// hasUncommittedChanges() Tests
// ============================================================================

describe('WorktreeService.hasUncommittedChanges', () => {
  it('returns true when worktree has modified files', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        modified: ['src/a.ts'],
        not_added: [],
        staged: [],
        deleted: [],
        created: [],
      }),
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    expect(await service.hasUncommittedChanges('feat', '01-step')).toBe(true);
  });

  it('returns true when worktree has untracked files', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        modified: [],
        not_added: ['new-file.ts'],
        staged: [],
        deleted: [],
        created: [],
      }),
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '02-step');

    expect(await service.hasUncommittedChanges('feat', '02-step')).toBe(true);
  });

  it('returns true when worktree has staged files', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        modified: [],
        not_added: [],
        staged: ['staged.ts'],
        deleted: [],
        created: [],
      }),
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '03-step');

    expect(await service.hasUncommittedChanges('feat', '03-step')).toBe(true);
  });

  it('returns true when worktree has deleted files', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        modified: [],
        not_added: [],
        staged: [],
        deleted: ['removed.ts'],
        created: [],
      }),
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '04-step');

    expect(await service.hasUncommittedChanges('feat', '04-step')).toBe(true);
  });

  it('returns false when worktree is clean', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        modified: [],
        not_added: [],
        staged: [],
        deleted: [],
        created: [],
      }),
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '05-step');

    expect(await service.hasUncommittedChanges('feat', '05-step')).toBe(false);
  });

  it('returns false when worktree does not exist (error case)', async () => {
    const service = createService('off');

    // No worktree dir created, getGit will fail when accessing status
    expect(await service.hasUncommittedChanges('nonexistent', 'step')).toBe(false);
  });
});

// ============================================================================
// list() Tests
// ============================================================================

describe('WorktreeService.list', () => {
  it('lists all worktrees when no feature filter is provided', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'list-sha',
    });
    (service as any).getGit = () => mockGit;

    // Set up multiple worktree directories
    setupWorktreeDir(service, 'feat-a', '01-step');
    setupWorktreeDir(service, 'feat-b', '02-step');

    const results = await service.list();

    expect(results.length).toBe(2);
    const features = results.map((r) => r.feature).sort();
    expect(features).toEqual(['feat-a', 'feat-b']);
  });

  it('lists only worktrees for specific feature when filter is provided', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'filtered-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-step');
    setupWorktreeDir(service, 'feat-a', '02-step');
    setupWorktreeDir(service, 'feat-b', '03-step');

    const results = await service.list('feat-a');

    expect(results.length).toBe(2);
    expect(results.every((r) => r.feature === 'feat-a')).toBe(true);
  });

  it('returns empty array when no worktrees exist', async () => {
    const service = createService('off');
    const results = await service.list();
    expect(results).toEqual([]);
  });
});

// ============================================================================
// checkConflicts() Tests
// ============================================================================

describe('WorktreeService.checkConflicts', () => {
  it('returns empty array when no conflicts exist', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/a.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string[]) => {
        if (args.includes('--cached')) {
          return 'diff --git a/src/a.ts b/src/a.ts\n+clean\n';
        }
        return '';
      },
      applyPatch: async () => {},
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const conflicts = await service.checkConflicts('feat', '01-step');
    expect(conflicts).toEqual([]);
  });

  it('returns conflicting file names when patch check fails', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/conflict.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('HEAD')) {
          return 'diff --git a/src/conflict.ts b/src/conflict.ts\n+conflict\n';
        }
        return '';
      },
      applyPatch: async () => {
        throw new Error('error: patch failed: src/conflict.ts:5\nerror: src/conflict.ts: patch does not apply');
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '02-step');

    const conflicts = await service.checkConflicts('feat', '02-step');
    expect(conflicts).toContain('src/conflict.ts');
  });

  it('returns empty array when there is no diff', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async () => '',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '03-step');

    const conflicts = await service.checkConflicts('feat', '03-step');
    expect(conflicts).toEqual([]);
  });
});

// ============================================================================
// exportPatch() Tests
// ============================================================================

describe('WorktreeService.exportPatch', () => {
  it('writes the diff resolved through getDiff base-commit handling', async () => {
    const service = createService('off');

    const statusPath = (service as any).getStepStatusPath('feat', '01-step');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, JSON.stringify({ baseCommit: 'status-base-sha' }));

    let capturedRefspec = '';
    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: ['src/file.ts'],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        const refArg = values.find((a: string) => a === 'status-base-sha');

        if (refArg && values.includes('--stat')) {
          capturedRefspec = refArg;
          return ' src/file.ts | 1 +\n 1 file changed, 1 insertion(+)\n';
        }

        if (refArg) {
          capturedRefspec = refArg;
          return 'diff --git a/src/file.ts b/src/file.ts\n+added\n';
        }

        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const patchPath = await service.exportPatch('feat', '01-step');

    expect(capturedRefspec).toBe('status-base-sha');
    expect(patchPath).toContain('01-step.patch');
    expect(fs.existsSync(patchPath)).toBe(true);
    expect(fs.readFileSync(patchPath, 'utf-8')).toContain('added');
  });

  it('writes a patch for dirty worktrees even when the provided base is not HEAD', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/staged.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('abc123') && values.includes('--stat')) {
          return ' src/staged.ts | 1 +\n 1 file changed, 1 insertion(+)\n';
        }
        if (values.includes('abc123')) {
          return 'diff --git a/src/staged.ts b/src/staged.ts\n+line\n';
        }
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreePath = setupWorktreeDir(service, 'feat', '02-step');
    const patchPath = path.join(worktreePath, '..', '02-step.patch');

    await expect(service.exportPatch('feat', '02-step', 'abc123')).resolves.toBe(patchPath);
    expect(fs.existsSync(patchPath)).toBe(true);
    expect(fs.readFileSync(patchPath, 'utf-8')).toContain('+line');
  });
});

// ============================================================================
// applyDiff() Tests
// ============================================================================

describe('WorktreeService.applyDiff', () => {
  it('applies diff patch to base repo', async () => {
    const service = createService('off');
    let patchApplied = false;

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/a.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('HEAD') && values.includes('--stat')) {
          return ' src/a.ts | 1 +\n 1 file changed, 1 insertion(+)\n';
        }
        if (values.includes('HEAD')) {
          return 'diff --git a/src/a.ts b/src/a.ts\n+line\n';
        }
        return '';
      },
      applyPatch: async () => {
        patchApplied = true;
      },
    });
    (service as any).getGit = () => mockGit;

    // Create the worktrees dir so the patch file can be written
    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(path.join(worktreesDir, 'feat'), { recursive: true });
    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.applyDiff('feat', '01-step');

    expect(result.success).toBe(true);
    expect(patchApplied).toBe(true);
    expect(result.filesAffected).toContain('src/a.ts');
  });

  it('returns success with empty filesAffected when no diff exists', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: [],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async () => '',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.applyDiff('feat', '01-step');

    expect(result.success).toBe(true);
    expect(result.filesAffected).toEqual([]);
  });

  it('returns error when patch apply fails', async () => {
    const service = createService('off');

    const mockGit = createMockGit({
      status: async () => ({
        staged: ['src/a.ts'],
        modified: [],
        not_added: [],
        deleted: [],
        created: [],
      }),
      diff: async (args: string | string[]) => {
        const values = Array.isArray(args) ? args : [args];
        if (values.includes('HEAD') && values.includes('--stat')) {
          return ' src/a.ts | 1 +\n 1 file changed, 1 insertion(+)\n';
        }
        if (values.includes('HEAD')) {
          return 'diff --git a/src/a.ts b/src/a.ts\n+line\n';
        }
        return '';
      },
      applyPatch: async () => {
        throw new Error('patch apply failed');
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(path.join(worktreesDir, 'feat'), { recursive: true });
    setupWorktreeDir(service, 'feat', '01-step');

    const result = await service.applyDiff('feat', '01-step');

    expect(result.success).toBe(false);
    expect(result.error).toContain('patch apply failed');
  });
});

// ============================================================================
// cleanup() Tests
// ============================================================================

describe('WorktreeService.cleanup', () => {
  it('removes stale worktrees that fail HEAD check', async () => {
    const service = createService('off');
    let pruned = false;
    const rawCalls: string[][] = [];

    // worktree exists but git fails (stale)
    let callCount = 0;
    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 1) {
          // First call: stale worktree fails
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
      raw: async (...args: any[]) => {
        const flatArgs = args.flat();
        rawCalls.push(flatArgs);
        if (flatArgs.includes('prune')) pruned = true;
        return '';
      },
      deleteLocalBranch: async () => {},
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat', 'stale-step');

    const result = await service.cleanup();

    expect(pruned).toBe(true);
    expect(result.pruned).toBe(true);
    expect(result.removed.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// listAll() Tests
// ============================================================================

describe('WorktreeService.listAll', () => {
  it('returns WorktreeInfo with stale metadata for each worktree', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'list-all-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-step');

    const results = await service.listAll();

    expect(results.length).toBe(1);
    expect(results[0].feature).toBe('feat-a');
    expect(results[0].step).toBe('01-step');
    expect(results[0].commit).toBe('list-all-sha');
    expect(results[0]).toHaveProperty('isStale');
    expect(results[0]).toHaveProperty('lastCommitAge');
    expect(results[0].isStale).toBe(false);
  });

  it('marks worktree as stale when git HEAD check fails', async () => {
    const service = createService('off');
    let callCount = 0;
    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-stale');

    const results = await service.listAll('feat-a');

    expect(results.length).toBe(1);
    expect(results[0].isStale).toBe(true);
  });

  it('filters by feature when provided', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'filtered-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-step');
    setupWorktreeDir(service, 'feat-b', '02-step');

    const results = await service.listAll('feat-a');

    expect(results.length).toBe(1);
    expect(results[0].feature).toBe('feat-a');
  });

  it('returns empty array when no worktrees exist', async () => {
    const service = createService('off');
    const results = await service.listAll();
    expect(results).toEqual([]);
  });
});

// ============================================================================
// prune() Tests
// ============================================================================

describe('WorktreeService.prune', () => {
  it('dry-run returns list of stale worktrees without removing them', async () => {
    const service = createService('off');
    let callCount = 0;
    let removeWasCalled = false;

    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
      raw: async () => {
        removeWasCalled = true;
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-stale');

    const result = await service.prune({ dryRun: true });

    expect(result.wouldRemove.length).toBe(1);
    expect(result.wouldRemove[0].feature).toBe('feat-a');
    expect(result.wouldRemove[0].step).toBe('01-stale');
    expect(result.removed).toEqual([]);
    expect(removeWasCalled).toBe(false);
  });

  it('destructive mode removes stale worktrees when confirm is true', async () => {
    const service = createService('off');
    let callCount = 0;
    const rawCalls: string[][] = [];

    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
      raw: async (...args: any[]) => {
        rawCalls.push(args.flat());
        return '';
      },
    });
    (service as any).getGit = () => mockGit;

    const worktreesDir = (service as any).getWorktreesDir();
    fs.mkdirSync(worktreesDir, { recursive: true });
    setupWorktreeDir(service, 'feat-a', '01-stale');

    const result = await service.prune({ dryRun: false, confirm: true });

    expect(result.removed.length).toBe(1);
    expect(result.removed[0]).toContain('01-stale');
    expect(result.wouldRemove).toEqual([]);
  });

  it('destructive mode refuses to remove without confirm flag', async () => {
    const service = createService('off');
    let callCount = 0;

    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-stale');

    const result = await service.prune({ dryRun: false, confirm: false });

    expect(result.removed).toEqual([]);
    expect(result.wouldRemove.length).toBe(1);
    expect(result.requiresConfirm).toBe(true);
  });

  it('filters by feature when provided', async () => {
    const service = createService('off');
    let callCount = 0;

    const mockGit = createMockGit({
      revparse: async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('not a git repository');
        }
        return 'valid-sha';
      },
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-stale');
    setupWorktreeDir(service, 'feat-b', '02-stale');

    const result = await service.prune({ dryRun: true, feature: 'feat-a' });

    expect(result.wouldRemove.length).toBe(1);
    expect(result.wouldRemove[0].feature).toBe('feat-a');
  });

  it('does not prune healthy worktrees', async () => {
    const service = createService('off');
    const mockGit = createMockGit({
      revparse: async () => 'healthy-sha',
    });
    (service as any).getGit = () => mockGit;

    setupWorktreeDir(service, 'feat-a', '01-step');

    const result = await service.prune({ dryRun: true });

    expect(result.wouldRemove).toEqual([]);
  });
});

// ============================================================================
// Integration Test: create → commit → merge flow (real git)
// ============================================================================

describe('WorktreeService integration', () => {
  it('create → commit → merge flow in temp git repo', async () => {
    const { execSync } = await import('child_process');

    // Initialize a real git repo in testRoot
    execSync('git init', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRoot, stdio: 'pipe' });

    // Create initial commit on main
    fs.writeFileSync(path.join(testRoot, 'README.md'), '# Test\n');
    execSync('git add .', { cwd: testRoot, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', { cwd: testRoot, stdio: 'pipe' });

    // Rename default branch to 'main' for consistency
    execSync('git branch -M main', { cwd: testRoot, stdio: 'pipe' });

    // Create a real WorktreeService pointing at this repo
    const warcraftDir = path.join(testRoot, '.beads', 'artifacts');
    fs.mkdirSync(warcraftDir, { recursive: true });

    const service = createWorktreeService(testRoot);

    // Step 1: Create worktree
    const info = await service.create('int-test', '01-task');

    expect(info.feature).toBe('int-test');
    expect(info.step).toBe('01-task');
    expect(info.branch).toBe('warcraft/int-test/01-task');
    expect(fs.existsSync(info.path)).toBe(true);

    // Step 2: Make changes in the worktree
    const newFile = path.join(info.path, 'new-file.ts');
    fs.writeFileSync(newFile, 'export const hello = "world";\n');

    // Step 3: Commit changes
    const commitResult = await service.commitChanges('int-test', '01-task', 'feat: add new file');

    expect(commitResult.committed).toBe(true);
    expect(commitResult.sha).toBeTruthy();
    expect(commitResult.message).toBe('feat: add new file');

    // Step 4: Verify diff exists (relative to initial commit on main)
    // Get the base commit (the commit the worktree was created from)
    const baseCommit = execSync('git rev-parse main', { cwd: testRoot, encoding: 'utf-8' }).trim();
    const diff = await service.getDiff('int-test', '01-task', baseCommit);
    expect(diff.hasDiff).toBe(true);
    expect(diff.filesChanged).toContain('new-file.ts');

    // Step 5: Merge back to main
    const mergeResult = await service.merge('int-test', '01-task', 'merge');

    expect(mergeResult.success).toBe(true);
    expect(mergeResult.outcome).toBe('merged');
    expect(mergeResult.filesChanged).toContain('new-file.ts');

    // Step 6: Verify file exists on main branch
    const mainFile = path.join(testRoot, 'new-file.ts');
    expect(fs.existsSync(mainFile)).toBe(true);
    expect(fs.readFileSync(mainFile, 'utf-8')).toBe('export const hello = "world";\n');

    // Step 7: Clean up worktree
    await service.remove('int-test', '01-task', true);
    expect(fs.existsSync(info.path)).toBe(false);
  }, 30000);

  it('merge returns conflict info when branches diverge', async () => {
    const { execSync } = await import('child_process');

    // Initialize repo
    execSync('git init', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRoot, stdio: 'pipe' });

    fs.writeFileSync(path.join(testRoot, 'shared.ts'), 'line 1\nline 2\nline 3\n');
    execSync('git add .', { cwd: testRoot, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: testRoot, stdio: 'pipe' });

    const warcraftDir = path.join(testRoot, '.beads', 'artifacts');
    fs.mkdirSync(warcraftDir, { recursive: true });

    const service = createWorktreeService(testRoot);

    // Create worktree and modify shared.ts
    const info = await service.create('conflict-test', '01-conflict');
    fs.writeFileSync(path.join(info.path, 'shared.ts'), 'branch line 1\nline 2\nline 3\n');
    await service.commitChanges('conflict-test', '01-conflict', 'branch change');

    // Modify same file on main to create conflict
    fs.writeFileSync(path.join(testRoot, 'shared.ts'), 'main line 1\nline 2\nline 3\n');
    execSync('git add .', { cwd: testRoot, stdio: 'pipe' });
    execSync('git commit -m "main change"', { cwd: testRoot, stdio: 'pipe' });

    // Attempt merge — should detect conflict
    const mergeResult = await service.merge('conflict-test', '01-conflict');

    expect(mergeResult.success).toBe(false);
    expect(mergeResult.outcome).toBe('conflicted');
    expect(mergeResult.conflicts).toContain('shared.ts');
    expect(mergeResult.error).toBeDefined();

    // Clean up
    await service.remove('conflict-test', '01-conflict', true);
  }, 30000);

  it('getDiff includes unstaged tracked changes from a real worktree', async () => {
    const { execSync } = await import('child_process');

    execSync('git init', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRoot, stdio: 'pipe' });

    fs.writeFileSync(path.join(testRoot, 'file.ts'), 'original\n');
    execSync('git add .', { cwd: testRoot, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: testRoot, stdio: 'pipe' });

    const warcraftDir = path.join(testRoot, '.beads', 'artifacts');
    fs.mkdirSync(warcraftDir, { recursive: true });

    const service = createWorktreeService(testRoot);
    const info = await service.create('dirty-diff', '01-task');
    const baseCommit = execSync('git rev-parse main', { cwd: testRoot, encoding: 'utf-8' }).trim();

    fs.writeFileSync(path.join(info.path, 'file.ts'), 'original\nchanged\n');

    const diff = await service.getDiff('dirty-diff', '01-task', baseCommit);

    expect(diff.hasDiff).toBe(true);
    expect(diff.diffContent).toContain('+changed');
    expect(diff.filesChanged).toContain('file.ts');

    await service.remove('dirty-diff', '01-task', true);
  }, 30000);

  it('hasUncommittedChanges returns true for dirty worktree', async () => {
    const { execSync } = await import('child_process');

    execSync('git init', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: testRoot, stdio: 'pipe' });

    fs.writeFileSync(path.join(testRoot, 'file.ts'), 'original\n');
    execSync('git add .', { cwd: testRoot, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: testRoot, stdio: 'pipe' });
    execSync('git branch -M main', { cwd: testRoot, stdio: 'pipe' });

    const warcraftDir = path.join(testRoot, '.beads', 'artifacts');
    fs.mkdirSync(warcraftDir, { recursive: true });

    const service = createWorktreeService(testRoot);

    const info = await service.create('dirty-test', '01-dirty');

    // Worktree starts clean
    expect(await service.hasUncommittedChanges('dirty-test', '01-dirty')).toBe(false);

    // Add an uncommitted file
    fs.writeFileSync(path.join(info.path, 'dirty.ts'), 'uncommitted\n');

    // Now it should be dirty
    expect(await service.hasUncommittedChanges('dirty-test', '01-dirty')).toBe(true);

    // Clean up
    await service.remove('dirty-test', '01-dirty', true);
  }, 30000);
});
