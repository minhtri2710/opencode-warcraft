import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorktreeService } from './worktreeService';
import type { TaskStatusType } from '../types';

class FakeBeadsModeProvider {
  constructor(private readonly mode: 'on' | 'off') {}

  getBeadsMode(): 'on' | 'off' {
    return this.mode;
  }
}

class FakeWorktreeBeadClient {
  calls: Array<{ beadId: string; status: TaskStatusType }> = [];
  throwOnSync = false;

  syncTaskStatus(beadId: string, status: TaskStatusType): void {
    if (this.throwOnSync) {
      throw new Error('sync failed');
    }
    this.calls.push({ beadId, status });
  }
}

let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-worktree-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function createService(mode: 'on' | 'off', beadClient?: FakeWorktreeBeadClient): WorktreeService {
  return new WorktreeService(
    { baseDir: testRoot, warcraftDir: mode === 'off' ? path.join(testRoot, 'docs') : path.join(testRoot, '.beads', 'artifacts') },
    new FakeBeadsModeProvider(mode),
    beadClient ?? new FakeWorktreeBeadClient(),
  );
}

describe('WorktreeService bead mode sync', () => {
  it('skips sync when beads mode is off', async () => {
    const beadClient = new FakeWorktreeBeadClient();
    const service = new WorktreeService(
      { baseDir: '/tmp/project', warcraftDir: '/tmp/project/docs' },
      new FakeBeadsModeProvider('off'),
      beadClient,
    );

    (service as any).getTaskBeadId = async () => 'bd-1';

    await (service as any).syncWorktreeTaskBeadStatus('f1', '01-task', 'in_progress', 'test');

    expect(beadClient.calls).toEqual([]);
  });

  it('syncs status when mode is on and task has bead id', async () => {
    const beadClient = new FakeWorktreeBeadClient();
    const service = new WorktreeService(
      { baseDir: '/tmp/project', warcraftDir: '/tmp/project/.beads/artifacts' },
      new FakeBeadsModeProvider('on'),
      beadClient,
    );

    (service as any).getTaskBeadId = async () => 'bd-2';

    await (service as any).syncWorktreeTaskBeadStatus('f1', '02-task', 'done', 'test');

    expect(beadClient.calls).toEqual([{ beadId: 'bd-2', status: 'done' }]);
  });

  it('skips sync when no bead id exists', async () => {
    const beadClient = new FakeWorktreeBeadClient();
    const service = createService('on', beadClient);

    (service as any).getTaskBeadId = async (): Promise<string | null> => null;

    await (service as any).syncWorktreeTaskBeadStatus('f1', '03-task', 'blocked', 'test');

    expect(beadClient.calls).toEqual([]);
  });

  it('does not throw when bead sync fails', async () => {
    const beadClient = new FakeWorktreeBeadClient();
    beadClient.throwOnSync = true;
    const service = createService('on', beadClient);

    (service as any).getTaskBeadId = async () => 'bd-fail';

    await expect(
      (service as any).syncWorktreeTaskBeadStatus('f1', '04-task', 'done', 'test'),
    ).resolves.toBeUndefined();
  });
});

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
