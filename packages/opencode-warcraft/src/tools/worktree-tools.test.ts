import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { formatSpecContent } from 'warcraft-core';
import type { WorktreeToolsDependencies } from './worktree-tools.js';
import { WorktreeTools } from './worktree-tools.js';

const TEST_DIR = `/tmp/opencode-warcraft-worktree-tools-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function _setupFeature(featureName: string): void {
  const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
  fs.mkdirSync(featurePath, { recursive: true });

  fs.writeFileSync(
    path.join(featurePath, 'feature.json'),
    JSON.stringify({
      name: featureName,
      epicBeadId: 'bd-epic-test',
      status: 'executing',
      createdAt: new Date().toISOString(),
    }),
  );

  fs.writeFileSync(
    path.join(featurePath, 'plan.md'),
    `# Plan

### 1. Test Task

Description of the test task.
`,
  );
}

function _setupTask(featureName: string, taskFolder: string, status: Record<string, unknown> = {}): void {
  const taskPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', taskFolder);
  fs.mkdirSync(taskPath, { recursive: true });

  const taskStatus = {
    status: 'pending',
    origin: 'plan',
    planTitle: 'Test Task',
    ...status,
  };

  fs.writeFileSync(path.join(taskPath, 'status.json'), JSON.stringify(taskStatus, null, 2));
}

/**
 * Create minimal mock deps for WorktreeTools with configurable verificationModel.
 */
function createMergeDeps(overrides: Partial<WorktreeToolsDependencies> = {}): WorktreeToolsDependencies {
  return {
    featureService: {} as WorktreeToolsDependencies['featureService'],
    planService: {} as WorktreeToolsDependencies['planService'],
    taskService: {
      get: () => ({ folder: '01-task', name: 'Task', status: 'done', origin: 'plan' as const }),
      getRawStatus: () => ({ workerSession: { workspaceMode: 'worktree' as const } }),
      ...((overrides as Record<string, unknown>).taskServiceOverrides ?? {}),
    } as unknown as WorktreeToolsDependencies['taskService'],
    worktreeService: {
      merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
      ...((overrides as Record<string, unknown>).worktreeServiceOverrides ?? {}),
    } as unknown as WorktreeToolsDependencies['worktreeService'],
    contextService: { list: () => [] } as unknown as WorktreeToolsDependencies['contextService'],
    validateTaskStatus: ((s: string) => s) as unknown as WorktreeToolsDependencies['validateTaskStatus'],
    checkBlocked: () => ({ blocked: false }),
    checkDependencies: () => ({ allowed: true }),
    hasCompletionGateEvidence: () => true,
    completionGates: ['build', 'test', 'lint'] as const,
    verificationModel: 'tdd',
    workflowGatesMode: 'warn',
    eventLogger: { emit: () => {}, getLatestTraceContext: () => undefined } as WorktreeToolsDependencies['eventLogger'],
    ...overrides,
  };
}

describe('WorktreeTools', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let childCounter = 0;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    childCounter = 0;
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...execArgs: unknown[]) => {
      const [command, args] = execArgs;
      if (command !== 'br') {
        throw new Error(`Unexpected command: ${String(command)}`);
      }
      const argList = Array.isArray(args) ? args.map(String) : [];
      if (argList[0] === 'create') {
        childCounter += 1;
        return JSON.stringify({ id: `bd-task-${childCounter}` }) as unknown as Buffer;
      }
      if (argList[0] === 'update' || argList[0] === 'close') {
        return '' as unknown as Buffer;
      }
      if (argList[0] === 'show') {
        return JSON.stringify({ description: '' }) as unknown as Buffer;
      }
      return '' as unknown as Buffer;
    });
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });
});

/** Parse tool result JSON string into data object */
function parseToolResult(result: unknown): Record<string, unknown> {
  const json = JSON.parse(result as string);
  return json.data ?? json;
}

/** Create a mock execAsync that tracks calls and returns success */
function createMockExec(options: { shouldFail?: boolean; failOnCall?: number } = {}) {
  let callCount = 0;
  const calls: Array<{ command: string; options: { cwd: string; timeout: number } }> = [];

  const mockExec = async (command: string, opts: { cwd: string; timeout: number }) => {
    callCount++;
    calls.push({ command, options: opts });

    if (options.shouldFail || (options.failOnCall && callCount >= options.failOnCall)) {
      const err = new Error('Command failed') as Error & { stdout: string; stderr: string };
      err.stdout = 'FAIL src/test.ts';
      err.stderr = 'Error: assertion failed';
      throw err;
    }
    return { stdout: `${command} passed\n`, stderr: '' };
  };

  return { mockExec, getCalls: () => calls, getCallCount: () => callCount };
}

describe('mergeTaskTool cleanup', () => {
  const resolveFeature = () => 'test-feature';

  it('includes cleanup.requested=false and cleanup.removed=false when cleanup is omitted', async () => {
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({ verificationModel: 'best-effort', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.cleanup).toBeDefined();
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(false);
    expect(cleanup.removed).toBe(false);
    expect(cleanup.reason).toBe('not-requested');
  });

  it('includes cleanup.requested=false and cleanup.removed=false when cleanup is false', async () => {
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({ verificationModel: 'best-effort', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: false },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.cleanup).toBeDefined();
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(false);
    expect(cleanup.removed).toBe(false);
    expect(cleanup.reason).toBe('not-requested');
  });

  it('removes worktree when cleanup is true and reports cleanup.removed=true', async () => {
    const removeCalls: Array<{ feature: string; step: string; deleteBranch: boolean }> = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
        remove: async (feature: string, step: string, deleteBranch: boolean) => {
          removeCalls.push({ feature, step, deleteBranch });
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.cleanup).toBeDefined();
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(true);
    // Verify remove was called with deleteBranch=false
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].feature).toBe('test-feature');
    expect(removeCalls[0].step).toBe('01-task');
    expect(removeCalls[0].deleteBranch).toBe(false);
  });

  it('reports cleanup error as non-fatal when cleanup fails after successful merge', async () => {
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
        remove: async () => {
          throw new Error('Permission denied');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    // Merge should still succeed (non-fatal cleanup error)
    const data = parseToolResult(result);
    expect(data.message).toContain('merged successfully');
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(false);
    expect(cleanup.error).toBe('Permission denied');
  });

  it('does not perform cleanup when merge fails', async () => {
    const removeCalls: string[] = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: false, error: 'Merge conflict' }),
        remove: async () => {
          removeCalls.push('called');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    // Merge failed, so cleanup should not have been called
    expect(removeCalls).toHaveLength(0);
    // Result should be an error (toolError)
    const json = JSON.parse(result as string);
    expect(json.error).toBeDefined();
  });

  it('includes cleanup object even when verification runs after merge', async () => {
    const removeCalls: string[] = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'tdd',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
        remove: async () => {
          removeCalls.push('called');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.cleanup).toBeDefined();
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(true);
    // Verification should also have run
    expect(data.verification).toBeDefined();
    expect(removeCalls).toHaveLength(1);
  });
});

describe('mergeTaskTool cleanup edge cases', () => {
  const resolveFeature = () => 'test-feature';

  it('does not attempt cleanup when merge fails with conflicts', async () => {
    const removeCalls: string[] = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: false, conflicts: ['src/a.ts', 'src/b.ts'] }),
        remove: async () => {
          removeCalls.push('called');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    // Merge failed with conflicts, so cleanup should not have been called
    expect(removeCalls).toHaveLength(0);
    // Result should be an error mentioning conflicts
    const json = JSON.parse(result as string);
    expect(json.error).toBeDefined();
    expect(json.error).toContain('conflicts');
  });

  it('performs cleanup with squash strategy after successful merge', async () => {
    const removeCalls: Array<{ feature: string; step: string; deleteBranch: boolean }> = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'def456', filesChanged: ['b.ts'] }),
        remove: async (feature: string, step: string, deleteBranch: boolean) => {
          removeCalls.push({ feature, step, deleteBranch });
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'squash', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.message).toContain('squash');
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(true);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].deleteBranch).toBe(false);
  });

  it('uses fallback message when cleanup error has no message property', async () => {
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
        remove: async () => {
          throw { code: 'ENOENT' }; // Error object without message property
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.message).toContain('merged successfully');
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(false);
    expect(cleanup.error).toBe('Worktree cleanup failed');
  });

  it('includes both cleanup error and verification when cleanup fails and verify runs', async () => {
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'tdd',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: ['a.ts'] }),
        remove: async () => {
          throw new Error('Stale lock file');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    // Cleanup error should be present
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(false);
    expect(cleanup.error).toBe('Stale lock file');
    // Verification should also have run despite cleanup failure
    const verification = data.verification as Record<string, unknown>;
    expect(verification).toBeDefined();
    expect(verification.passed).toBe(true);
  });

  it('does not attempt cleanup when task is not found', async () => {
    const removeCalls: string[] = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      taskServiceOverrides: {
        get: () => null, // Task not found
      },
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: [] }),
        remove: async () => {
          removeCalls.push('called');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-missing', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    expect(removeCalls).toHaveLength(0);
    const json = JSON.parse(result as string);
    expect(json.error).toBeDefined();
  });

  it('does not attempt cleanup when task status is not done', async () => {
    const removeCalls: string[] = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      taskServiceOverrides: {
        get: () => ({ folder: '01-task', name: 'Task', status: 'in_progress', origin: 'plan' as const }),
      },
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'abc123', filesChanged: [] }),
        remove: async () => {
          removeCalls.push('called');
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    expect(removeCalls).toHaveLength(0);
    const json = JSON.parse(result as string);
    expect(json.error).toBeDefined();
  });

  it('performs cleanup with rebase strategy after successful merge', async () => {
    const removeCalls: Array<{ feature: string; step: string; deleteBranch: boolean }> = [];
    const { mockExec } = createMockExec();
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      execAsync: mockExec,
      worktreeServiceOverrides: {
        merge: async () => ({ success: true, sha: 'ghi789', filesChanged: ['c.ts'] }),
        remove: async (feature: string, step: string, deleteBranch: boolean) => {
          removeCalls.push({ feature, step, deleteBranch });
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'rebase', feature: 'test-feature', cleanup: true },
      {} as never,
    );

    const data = parseToolResult(result);
    expect(data.message).toContain('rebase');
    const cleanup = data.cleanup as Record<string, unknown>;
    expect(cleanup.requested).toBe(true);
    expect(cleanup.removed).toBe(true);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].feature).toBe('test-feature');
    expect(removeCalls[0].step).toBe('01-task');
    expect(removeCalls[0].deleteBranch).toBe(false);
  });
});

describe('mergeTaskTool verification defaults', () => {
  const resolveFeature = () => 'test-feature';

  it('defaults verify to true in TDD verification model when verify not provided', async () => {
    const { mockExec, getCallCount } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'tdd', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    expect(getCallCount()).toBeGreaterThan(0);
    const data = parseToolResult(result);
    // The structured response should contain verification results
    expect(data.verification).toBeDefined();
    expect((data.verification as Record<string, unknown>).passed).toBe(true);
  });

  it('defaults verify to false in best-effort verification model when verify not provided', async () => {
    const { mockExec, getCallCount } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'best-effort', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    expect(getCallCount()).toBe(0);
    const data = parseToolResult(result);
    // Should not contain verification results
    expect(data.verification).toBeUndefined();
  });

  it('allows explicit verify=false to override TDD default', async () => {
    const { mockExec, getCallCount } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'tdd', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', verify: false },
      {} as never,
    );

    expect(getCallCount()).toBe(0);
    const data = parseToolResult(result);
    expect(data.verification).toBeUndefined();
  });

  it('allows explicit verify=true to override best-effort default', async () => {
    const { mockExec, getCallCount } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'best-effort', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', verify: true },
      {} as never,
    );

    expect(getCallCount()).toBeGreaterThan(0);
    const data = parseToolResult(result);
    expect(data.verification).toBeDefined();
    expect((data.verification as Record<string, unknown>).passed).toBe(true);
  });

  it('captures verification command output in response payload on success', async () => {
    const { mockExec } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'tdd', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    const data = parseToolResult(result);
    const verification = data.verification as Record<string, unknown>;
    expect(verification).toBeDefined();
    expect(verification.passed).toBe(true);
    // Output should be captured in the response
    expect(verification.output).toBeDefined();
    expect(typeof verification.output).toBe('string');
  });

  it('captures verification command output in response payload on failure', async () => {
    const { mockExec } = createMockExec({ failOnCall: 2 });

    const deps = createMergeDeps({ verificationModel: 'tdd', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    const data = parseToolResult(result);
    const verification = data.verification as Record<string, unknown>;
    expect(verification).toBeDefined();
    expect(verification.passed).toBe(false);
    expect(verification.output).toBeDefined();
    expect(typeof verification.output).toBe('string');
    expect((verification.output as string).length).toBeGreaterThan(0);
  });

  it('includes verification commands in response payload', async () => {
    const { mockExec } = createMockExec();

    const deps = createMergeDeps({ verificationModel: 'tdd', execAsync: mockExec });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature' },
      {} as never,
    );

    const data = parseToolResult(result);
    const verification = data.verification as Record<string, unknown>;
    expect(verification).toBeDefined();
    // Should include the commands that were run
    expect(verification.commands).toBeDefined();
    const cmds = verification.commands as Record<string, string>;
    expect(cmds.build).toBeDefined();
    expect(cmds.test).toBeDefined();
  });
});

describe('mergeTaskTool verification uses projectDir not process.cwd()', () => {
  const resolveFeature = () => 'test-feature';

  it('passes projectDir as cwd to verification commands instead of process.cwd()', async () => {
    const { mockExec, getCalls } = createMockExec();
    const projectDir = '/fake/project/root';

    const deps = createMergeDeps({
      verificationModel: 'tdd',
      execAsync: mockExec,
      projectDir,
    });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    await mergeTool.execute({ task: '01-task', strategy: 'merge', feature: 'test-feature' }, {} as never);

    // Verification should have been invoked (TDD model defaults verify=true)
    const calls = getCalls();
    expect(calls.length).toBeGreaterThan(0);

    // Every exec call should use the injected projectDir, NOT process.cwd()
    for (const call of calls) {
      expect(call.options.cwd).toBe(projectDir);
      expect(call.options.cwd).not.toBe(process.cwd());
    }
  });

  it('falls back to process.cwd() when projectDir is not provided', async () => {
    const { mockExec, getCalls } = createMockExec();

    // Omit projectDir — should fall back to process.cwd()
    const deps = createMergeDeps({
      verificationModel: 'tdd',
      execAsync: mockExec,
    });
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    await mergeTool.execute({ task: '01-task', strategy: 'merge', feature: 'test-feature' }, {} as never);

    const calls = getCalls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.options.cwd).toBe(process.cwd());
    }
  });
});

/**
 * Create mock deps for commitWorktreeTool that track taskService.transition() and update() calls.
 */
function createCommitDeps(overrides: Partial<WorktreeToolsDependencies> = {}) {
  const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
  const transitionCalls: Array<{
    feature: string;
    task: string;
    toStatus: string;
    extras?: Record<string, unknown>;
  }> = [];

  const deps: WorktreeToolsDependencies = {
    featureService: {
      get: () => ({ name: 'test-feature', status: 'executing' }),
    } as unknown as WorktreeToolsDependencies['featureService'],
    planService: {} as WorktreeToolsDependencies['planService'],
    taskService: {
      get: () => ({ folder: '01-task', name: 'Task', status: 'in_progress', origin: 'plan' as const }),
      getRawStatus: () => ({ baseCommit: 'base123' }),
      update: (feature: string, task: string, updates: Record<string, unknown>) => {
        updateCalls.push({ feature, task, updates });
        return { ...updates, origin: 'plan' };
      },
      transition: (feature: string, task: string, toStatus: string, extras?: Record<string, unknown>) => {
        transitionCalls.push({ feature, task, toStatus, extras });
        return { folder: task, name: 'Task', status: toStatus, origin: 'plan' };
      },
      writeReport: () => {},
      list: () => [],
      ...((overrides as Record<string, unknown>).taskServiceOverrides ?? {}),
    } as unknown as WorktreeToolsDependencies['taskService'],
    worktreeService: {
      commitChanges: async () => ({ committed: true, sha: 'abc123', message: 'ok' }),
      getDiff: async () => ({ hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 }),
      get: async () => ({ mode: 'worktree' as const, path: '/tmp/wt', branch: 'warcraft/test/01-task' }),
      ...((overrides as Record<string, unknown>).worktreeServiceOverrides ?? {}),
    } as unknown as WorktreeToolsDependencies['worktreeService'],
    contextService: { list: () => [] } as unknown as WorktreeToolsDependencies['contextService'],
    validateTaskStatus: ((s: string) => s) as unknown as WorktreeToolsDependencies['validateTaskStatus'],
    checkBlocked: () => ({ blocked: false }),
    checkDependencies: () => ({ allowed: true }),
    hasCompletionGateEvidence: () => true,
    completionGates: ['build', 'test', 'lint'] as const,
    verificationModel: 'best-effort',
    workflowGatesMode: 'warn',
    eventLogger: { emit: () => {} } as unknown as WorktreeToolsDependencies['eventLogger'],
    ...overrides,
  };

  return { deps, getUpdateCalls: () => updateCalls, getTransitionCalls: () => transitionCalls };
}

describe('direct workspace mode', () => {
  const resolveFeature = () => 'test-feature';

  it('returns a truthful no-op merge response for direct mode', async () => {
    let mergeCalled = false;
    const deps = createMergeDeps({
      verificationModel: 'best-effort',
      taskServiceOverrides: {
        getRawStatus: () => ({
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
      },
      worktreeServiceOverrides: {
        merge: async () => {
          mergeCalled = true;
          return { success: true, sha: 'abc123', filesChanged: ['a.ts'] };
        },
      },
    } as unknown as Partial<WorktreeToolsDependencies>);
    const tools = new WorktreeTools(deps);
    const mergeTool = tools.mergeTaskTool(resolveFeature);

    const result = await mergeTool.execute(
      { task: '01-task', strategy: 'merge', feature: 'test-feature', cleanup: true, verify: true },
      {} as never,
    );

    expect(mergeCalled).toBe(false);
    const data = parseToolResult(result);
    expect(data.workspaceMode).toBe('direct');
    expect(data.workspacePath).toBe('/repo/root');
    expect(data.cleanup).toEqual({ requested: true, removed: false, reason: 'direct-mode-no-worktree' });
    expect(data.verification).toEqual({ skipped: true, reason: 'direct-mode-no-merge' });
    expect(data.message).toContain('No git merge step exists');
  });

  it('completes direct-mode tasks without creating a git commit', async () => {
    let commitCalls = 0;
    let diffCalls = 0;
    let report = '';
    const { deps, getTransitionCalls } = createCommitDeps({
      taskServiceOverrides: {
        getRawStatus: () => ({
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
        writeReport: (_feature: string, _task: string, content: string) => {
          report = content;
        },
      },
      worktreeServiceOverrides: {
        commitChanges: async () => {
          commitCalls += 1;
          return { committed: true, sha: 'abc123', message: 'ok' };
        },
        getDiff: async () => {
          diffCalls += 1;
          return { hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 };
        },
      },
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    const result = await commitTool.execute(
      {
        task: '01-task',
        summary: 'Implemented the change directly in the project root.',
        status: 'completed',
      },
      {} as never,
    );

    expect(commitCalls).toBe(0);
    expect(diffCalls).toBe(0);
    expect(report).toContain('## Workspace');
    expect(report).toContain('- **Mode:** direct');
    expect(report).toContain('_Direct-mode execution; git diff is not available._');
    const transitions = getTransitionCalls();
    const finalTransition = transitions.find((t) => t.toStatus === 'done');
    expect(finalTransition).toBeDefined();

    const data = parseCommitResult(result);
    expect(data.workspaceMode).toBe('direct');
    expect(data.workspacePath).toBe('/repo/root');
    expect(data.verificationDeferred).toBe(true);
    expect(data.message).toContain('No git commit or merge step was created');
  });

  it('resets direct-mode tasks without pretending files were reverted', async () => {
    let removeCalls = 0;
    const { deps, getTransitionCalls } = createCommitDeps({
      taskServiceOverrides: {
        getRawStatus: () => ({
          workerSession: { workspaceMode: 'direct' as const, workspacePath: '/repo/root' },
        }),
      },
      worktreeServiceOverrides: {
        remove: async () => {
          removeCalls += 1;
        },
      },
    });
    const tools = new WorktreeTools(deps);
    const discardTool = tools.discardWorktreeTool(resolveFeature);

    const result = await discardTool.execute({ task: '01-task', feature: 'test-feature' }, {} as never);

    expect(removeCalls).toBe(0);
    expect(getTransitionCalls().map((call) => call.toStatus)).toEqual(['cancelled', 'pending']);
    const data = parseToolResult(result);
    expect(data.workspaceMode).toBe('direct');
    expect(data.workspacePath).toBe('/repo/root');
    expect(data.message).toContain('were not reverted');
  });
});

describe('createWorktreeTool lifecycle parity', () => {
  const resolveFeature = () => 'test-feature';

  it('promotes dispatch_prepared tasks to in_progress after successful worker handoff', async () => {
    const transitionCalls: Array<{ toStatus: string; extras?: Record<string, unknown> }> = [];
    const patchCalls: Array<Record<string, unknown>> = [];

    const deps = {
      featureService: {
        getSession: () => 'sess-1',
      },
      planService: {
        read: () => ({ content: '# Plan\n\n### 1. Task\n\nDo it.', status: 'approved', comments: [] }),
      },
      taskService: {
        get: () => ({ folder: '01-task', name: 'Task', status: 'pending', origin: 'plan' as const }),
        getRawStatus: (() => {
          let callCount = 0;
          return () => {
            callCount += 1;
            return {
              status: 'in_progress' as const,
              origin: 'plan' as const,
              preparedAt: '2026-01-01T00:00:00Z',
              workerSession: {
                sessionId: 'sess-1',
                attempt: callCount === 1 ? 1 : 2,
                workspaceMode: 'worktree' as const,
                workspacePath: '/tmp/wt',
                workspaceBranch: 'warcraft/test-feature/01-task',
              },
            };
          };
        })(),
        transition: (_feature: string, _task: string, toStatus: string, extras?: Record<string, unknown>) => {
          transitionCalls.push({ toStatus, extras });
          return { folder: '01-task', name: 'Task', status: toStatus, origin: 'plan' as const };
        },
        patchBackgroundFields: (_feature: string, _task: string, patch: Record<string, unknown>) => {
          patchCalls.push(patch);
        },
        writeSpec: () => 'spec-path',
        writeWorkerPrompt: () => {},
        buildSpecData: () => ({
          featureName: 'test-feature',
          task: { folder: '01-task', name: 'Task', order: 1 },
          dependsOn: [],
          allTasks: [{ folder: '01-task', name: 'Task', order: 1 }],
          planSection: '### 1. Task\n\nDo it.',
          contextFiles: [],
          completedTasks: [],
        }),
        list: () => [{ folder: '01-task', name: 'Task', status: 'pending', origin: 'plan' as const }],
      },
      worktreeService: {
        create: async () => ({
          mode: 'worktree' as const,
          path: '/tmp/wt',
          branch: 'warcraft/test-feature/01-task',
          commit: 'base123',
          feature: 'test-feature',
          step: '01-task',
        }),
        get: async () => ({ mode: 'worktree' as const, path: '/tmp/wt', branch: 'warcraft/test-feature/01-task' }),
        remove: async () => {},
      },
      contextService: { list: () => [] },
      validateTaskStatus: ((s: string) => s) as never,
      checkBlocked: () => ({ blocked: false }),
      checkDependencies: () => ({ allowed: true }),
      hasCompletionGateEvidence: () => true,
      completionGates: ['build', 'test', 'lint'] as const,
      verificationModel: 'best-effort' as const,
      workflowGatesMode: 'warn' as const,
      eventLogger: { emit: () => {}, getLatestTraceContext: () => undefined },
    } satisfies Partial<WorktreeToolsDependencies> as WorktreeToolsDependencies;

    const tools = new WorktreeTools(deps);
    const createTool = tools.createWorktreeTool(resolveFeature);

    const result = await createTool.execute({ task: '01-task', feature: 'test-feature' }, {
      sessionID: 'sess-1',
    } as never);

    const data = parseToolResult(result);
    expect(data.taskToolCall).toBeDefined();
    expect(transitionCalls.map((call) => call.toStatus)).toEqual(['dispatch_prepared', 'in_progress']);
    expect(transitionCalls[0]?.extras?.preparedAt).toBeDefined();
    expect(patchCalls[0]).toEqual({
      workerSession: {
        sessionId: 'sess-1',
        agent: 'mekkatorque',
        mode: 'delegate',
        attempt: 2,
        workspaceMode: 'worktree',
        workspacePath: '/tmp/wt',
        workspaceBranch: 'warcraft/test-feature/01-task',
      },
    });
    expect(patchCalls[1]).toEqual({
      idempotencyKey: 'warcraft-test-feature-01-task-2',
    });
  });

  it('reuses the persisted dispatch attempt in the idempotency key for resumed work', async () => {
    const patchCalls: Array<Record<string, unknown>> = [];

    const deps = {
      featureService: {
        getSession: () => 'sess-1',
      },
      planService: {
        read: () => ({ content: '# Plan\n\n### 1. Task\n\nDo it.', status: 'approved', comments: [] }),
      },
      taskService: {
        get: () => ({ folder: '01-task', name: 'Task', status: 'blocked', origin: 'plan' as const, summary: 'Wait' }),
        getRawStatus: (() => {
          let callCount = 0;
          return () => {
            callCount += 1;
            return {
              status: 'in_progress' as const,
              origin: 'plan' as const,
              preparedAt: '2026-01-01T00:00:00Z',
              workerSession: {
                sessionId: 'sess-1',
                attempt: callCount === 1 ? 2 : 3,
                workspaceMode: 'worktree' as const,
                workspacePath: '/tmp/wt',
                workspaceBranch: 'warcraft/test-feature/01-task',
              },
            };
          };
        })(),
        transition: () => ({ folder: '01-task', name: 'Task', status: 'in_progress', origin: 'plan' as const }),
        patchBackgroundFields: (_feature: string, _task: string, patch: Record<string, unknown>) => {
          patchCalls.push(patch);
        },
        writeSpec: () => 'spec-path',
        writeWorkerPrompt: () => {},
        buildSpecData: () => ({
          featureName: 'test-feature',
          task: { folder: '01-task', name: 'Task', order: 1 },
          dependsOn: [],
          allTasks: [{ folder: '01-task', name: 'Task', order: 1 }],
          planSection: '### 1. Task\n\nDo it.',
          contextFiles: [],
          completedTasks: [],
        }),
        list: () => [{ folder: '01-task', name: 'Task', status: 'blocked', origin: 'plan' as const }],
      },
      worktreeService: {
        create: async () => ({
          mode: 'worktree' as const,
          path: '/tmp/wt',
          branch: 'warcraft/test-feature/01-task',
          commit: 'base123',
          feature: 'test-feature',
          step: '01-task',
        }),
        get: async () => ({ mode: 'worktree' as const, path: '/tmp/wt', branch: 'warcraft/test-feature/01-task' }),
        remove: async () => {},
      },
      contextService: { list: () => [] },
      validateTaskStatus: ((s: string) => s) as never,
      checkBlocked: () => ({ blocked: false }),
      checkDependencies: () => ({ allowed: true }),
      hasCompletionGateEvidence: () => true,
      completionGates: ['build', 'test', 'lint'] as const,
      verificationModel: 'best-effort' as const,
      workflowGatesMode: 'warn' as const,
      eventLogger: { emit: () => {}, getLatestTraceContext: () => undefined },
    } satisfies Partial<WorktreeToolsDependencies> as WorktreeToolsDependencies;

    const tools = new WorktreeTools(deps);
    const createTool = tools.createWorktreeTool(resolveFeature);

    const result = await createTool.execute(
      { task: '01-task', feature: 'test-feature', continueFrom: 'blocked', decision: 'Proceed' },
      { sessionID: 'sess-1' } as never,
    );

    const data = parseToolResult(result);
    expect(data.taskToolCall).toBeDefined();
    expect(patchCalls[0]).toEqual({
      workerSession: {
        sessionId: 'sess-1',
        agent: 'mekkatorque',
        mode: 'delegate',
        attempt: 3,
        workspaceMode: 'worktree',
        workspacePath: '/tmp/wt',
        workspaceBranch: 'warcraft/test-feature/01-task',
      },
    });
    expect(patchCalls[1]).toEqual({
      idempotencyKey: 'warcraft-test-feature-01-task-3',
    });
  });
});

/** Parse tool result JSON string into data object */
function parseCommitResult(result: unknown): Record<string, unknown> {
  const json = JSON.parse(result as string);
  return json.data ?? json;
}

describe('commitWorktreeTool learnings', () => {
  const resolveFeature = () => 'test-feature';

  it('persists learnings in taskService.transition when status is completed', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Did things. build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: ['Use foo instead of bar', 'Config lives in /etc'],
      },
      {} as never,
    );

    const transitions = getTransitionCalls();
    // The final transition (status → done) should include learnings
    const finalTransition = transitions.find((t) => t.toStatus === 'done');
    expect(finalTransition).toBeDefined();
    expect(finalTransition!.extras?.learnings).toEqual(['Use foo instead of bar', 'Config lives in /etc']);
  });

  it('persists learnings in taskService.transition when status is blocked', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Blocked on X',
        status: 'blocked',
        blocker: { reason: 'Need clarification' },
        learnings: ['Discovered pattern Y'],
      },
      {} as never,
    );

    const blockedTransition = getTransitionCalls().find((t) => t.toStatus === 'blocked');
    expect(blockedTransition).toBeDefined();
    expect(blockedTransition!.extras?.learnings).toEqual(['Discovered pattern Y']);
  });

  it('omits learnings from taskService.transition when not provided', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Did things. build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      {} as never,
    );

    const transitions = getTransitionCalls();
    const finalTransition = transitions.find((t) => t.toStatus === 'done');
    expect(finalTransition).toBeDefined();
    expect(finalTransition!.extras?.learnings).toBeUndefined();
  });

  it('preserves existing completed behavior when learnings is omitted', async () => {
    const { deps } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    const result = await commitTool.execute(
      {
        task: '01-task',
        summary: 'Did things. build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      {} as never,
    );

    const data = parseCommitResult(result);
    expect(data.ok).toBe(true);
    expect(data.terminal).toBe(true);
    expect(data.status).toBe('completed');
  });
});

describe('commitWorktreeTool learnings edge cases', () => {
  const resolveFeature = () => 'test-feature';

  it('omits learnings from transition when empty array provided', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Did things. build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: [],
      },
      {} as never,
    );

    const transitions = getTransitionCalls();
    const finalTransition = transitions.find((t) => t.toStatus === 'done');
    expect(finalTransition).toBeDefined();
    // Empty array → no learnings key in transition extras
    expect(finalTransition!.extras?.learnings).toBeUndefined();
  });

  it('persists learnings in transition for partial status', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Partial progress made',
        status: 'partial',
        learnings: ['Should persist in status but not flow downstream'],
      },
      {} as never,
    );

    const transitions = getTransitionCalls();
    // partial status goes through the non-blocked path, so final transition is 'partial'
    const partialTransition = transitions.find((t) => t.toStatus === 'partial');
    expect(partialTransition).toBeDefined();
    // Learnings should be persisted even for partial
    expect(partialTransition!.extras?.learnings).toEqual(['Should persist in status but not flow downstream']);
  });

  it('persists learnings in transition for failed status', async () => {
    const { deps, getTransitionCalls } = createCommitDeps();
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(resolveFeature);

    await commitTool.execute(
      {
        task: '01-task',
        summary: 'Everything broke',
        status: 'failed',
        learnings: ['Found root cause: wrong config'],
      },
      {} as never,
    );

    const transitions = getTransitionCalls();
    const failedTransition = transitions.find((t) => t.toStatus === 'failed');
    expect(failedTransition).toBeDefined();
    // Learnings should still be persisted in transition
    expect(failedTransition!.extras?.learnings).toEqual(['Found root cause: wrong config']);
  });
});

describe('formatSpecContent', () => {
  it('formats SpecData into markdown with all sections', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: '### 1. Test Task\n\nDescription of the test task.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('# Task: 01-test-task');
    expect(result).toContain('## Feature: test-feature');
    expect(result).toContain('## Dependencies');
    expect(result).toContain('_None_');
    expect(result).toContain('## Plan Section');
    expect(result).toContain('Description of the test task');
  });

  it('formats dependencies with task names', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '02-dependent-task', name: 'Dependent Task', order: 2 },
      dependsOn: ['01-first-task'],
      allTasks: [
        { folder: '01-first-task', name: 'First Task', order: 1 },
        { folder: '02-dependent-task', name: 'Dependent Task', order: 2 },
      ],
      planSection: '### 2. Dependent Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Dependencies');
    expect(result).toContain('- **1. First Task** (01-first-task)');
    expect(result).not.toContain('_None_');
  });

  it('formats context files section when present', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: '### 1. Test Task\n\nDescription.',
      contextFiles: [
        { name: 'notes.md', content: '# Notes\nImportant notes.' },
        { name: 'config.json', content: '{"key": "value"}' },
      ],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Context');
    expect(result).toContain('## notes.md');
    expect(result).toContain('# Notes');
    expect(result).toContain('## config.json');
    expect(result).toContain('{"key": "value"}');
    expect(result).toContain('---'); // Separator between context files
  });

  it('formats completed tasks section when present', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '03-current-task', name: 'Current Task', order: 3 },
      dependsOn: ['01-first-task', '02-second-task'],
      allTasks: [
        { folder: '01-first-task', name: 'First Task', order: 1 },
        { folder: '02-second-task', name: 'Second Task', order: 2 },
        { folder: '03-current-task', name: 'Current Task', order: 3 },
      ],
      planSection: '### 3. Current Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [
        { name: '01-first-task', summary: 'First task completed' },
        { name: '02-second-task', summary: 'Second task done' },
      ],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Completed Tasks');
    expect(result).toContain('- 01-first-task: First task completed');
    expect(result).toContain('- 02-second-task: Second task done');
  });

  it('shows placeholder when plan section is null', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: null,
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Plan Section');
    expect(result).toContain('_No plan section available._');
  });

  it('infers greenfield task type from Create: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-new-feature', name: 'New Feature', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-new-feature', name: 'New Feature', order: 1 }],
      planSection: '### 1. New Feature\n\n- Create: `src/new.ts`\n\nAdd new feature.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('greenfield');
  });

  it('infers testing task type from Test: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-add-tests', name: 'Add Tests', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-add-tests', name: 'Add Tests', order: 1 }],
      planSection: '### 1. Add Tests\n\n- Test: `src/feature.test.ts`\n\nAdd coverage.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('testing');
  });

  it('infers modification task type from Modify: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-update-code', name: 'Update Code', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-update-code', name: 'Update Code', order: 1 }],
      planSection: '### 1. Update Code\n\n- Modify: `src/feature.ts`\n\nUpdate logic.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('modification');
  });

  it('infers testing task type from task name when no file types', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-validation', name: 'Test Validation', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-validation', name: 'Test Validation', order: 1 }],
      planSection: '### 1. Test Validation\n\nValidate inputs.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('testing');
  });

  it('omits task type section when no inference possible', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-generic-task', name: 'Generic Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-generic-task', name: 'Generic Task', order: 1 }],
      planSection: '### 1. Generic Task\n\nDo something.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).not.toContain('## Task Type');
  });

  it('preserves dependency resolution behavior for unknown dependencies', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '02-task', name: 'Task', order: 2 },
      dependsOn: ['01-unknown-task'],
      allTasks: [
        { folder: '02-task', name: 'Task', order: 2 },
        // 01-unknown-task is not in allTasks
      ],
      planSection: '### 2. Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Dependencies');
    expect(result).toContain('- 01-unknown-task'); // Without name resolution
    expect(result).not.toContain('**'); // No bold formatting since task not found
  });
});
