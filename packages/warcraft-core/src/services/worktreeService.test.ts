import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorktreeService } from './worktreeService';

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
  );
}

describe('WorktreeService helpers', () => {
  it('returns canonical tasks status path only', async () => {
    const service = createService('off');
    const v2 = path.join(testRoot, 'docs', 'feat', 'tasks', '01-task', 'status.json');

    const statusPath = await (service as any).getStepStatusPath('feat', '01-task');
    expect(statusPath).toBe(v2);
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
      "-old",
      "+new",
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
