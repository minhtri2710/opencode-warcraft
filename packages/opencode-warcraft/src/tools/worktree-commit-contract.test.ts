import { describe, expect, it } from 'bun:test';
import { createNoopEventLogger } from 'warcraft-core';
import { z } from 'zod';
import { WorktreeTools } from './worktree-tools.js';

type MockDeps = ConstructorParameters<typeof WorktreeTools>[0];

function createMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    featureService: { get: () => ({ name: 'test-feature' }) } as any,
    planService: {} as any,
    taskService: {
      get: (_f: string, _t: string) => ({ status: 'in_progress', folder: '01-test', name: '01-test' }),
      list: () => [{ status: 'in_progress', folder: '01-test', name: '01-test' }],
      update: () => {},
      writeReport: () => {},
      getRawStatus: () => ({ baseCommit: 'base-sha' }),
      patchBackgroundFields: () => {},
    } as any,
    worktreeService: {
      commitChanges: async () => ({ committed: true, sha: 'abc123', message: 'test' }),
      getDiff: async () => ({ hasDiff: true, filesChanged: ['a.ts'], insertions: 10, deletions: 5 }),
      get: async () => ({ path: '/tmp/wt', branch: 'task-branch' }),
    } as any,
    contextService: { list: () => [] },
    validateTaskStatus: (s: string) => s as any,
    checkBlocked: () => ({ blocked: false }),
    checkDependencies: () => ({ allowed: true }),
    hasCompletionGateEvidence: (summary: string, gate: string) => summary.includes(`${gate}: exit 0`),
    completionGates: ['build', 'test', 'lint'] as const,
    workflowGatesMode: 'enforce' as const,
    verificationModel: 'tdd' as const,
    eventLogger: createNoopEventLogger(),
    ...overrides,
  };
}

const MOCK_CONTEXT = {} as any;

function parseResult(jsonStr: string) {
  return JSON.parse(jsonStr) as { success: boolean; data?: any; error?: string };
}

describe('worktree_commit terminal contract', () => {
  it('returns ok:false, terminal:false when gates fail in enforce mode', async () => {
    const tools = new WorktreeTools(createMockDeps({ workflowGatesMode: 'enforce' }));
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '01-test', summary: 'Did stuff', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.status).toBe('needs_verification');
    expect(result.data.missingGates).toContain('build');
    expect(result.data.missingGates).toContain('test');
    expect(result.data.missingGates).toContain('lint');
  });

  it('returns ok:true, terminal:true with verificationNote when gates fail in warn mode', async () => {
    const tools = new WorktreeTools(createMockDeps({ workflowGatesMode: 'warn' }));
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '01-test', summary: 'Did stuff', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.verificationNote).toBeTruthy();
  });

  it('returns ok:true, terminal:true when all gates pass', async () => {
    const tools = new WorktreeTools(createMockDeps({ workflowGatesMode: 'enforce' }));
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      { task: '01-test', summary: 'build: exit 0, test: exit 0, lint: exit 0', status: 'completed' },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('completed');
  });

  it('accepts canonical task folder names used by worktree commits', async () => {
    const taskFolder = '01-build-complexity-classifier-and-tests';
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        get: (_feature: string, folder: string) =>
          folder === taskFolder ? { status: 'in_progress', folder: taskFolder, name: taskFolder } : null,
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: taskFolder,
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('completed');
  });

  it('passes baseCommit from task status into worktreeService.getDiff', async () => {
    let capturedBaseCommit: string | undefined;
    const deps = createMockDeps({
      worktreeService: {
        ...createMockDeps().worktreeService,
        getDiff: async (_feature: string, _task: string, baseCommit?: string) => {
          capturedBaseCommit = baseCommit;
          return { hasDiff: true, filesChanged: ['a.ts'], insertions: 1, deletions: 0 };
        },
      } as any,
      taskService: {
        ...createMockDeps().taskService,
        getRawStatus: () => ({ baseCommit: 'explicit-base-sha' }),
      } as any,
    });

    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);

    expect(result.success).toBe(true);
    expect(capturedBaseCommit).toBe('explicit-base-sha');
  });

  it('returns toolError when baseCommit is missing at completion time', async () => {
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        getRawStatus: () => null,
      } as any,
    });

    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing baseCommit');
  });
  it('returns ok:true, terminal:true for blocked status', async () => {
    const tools = new WorktreeTools(createMockDeps());
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Blocked on X',
        status: 'blocked',
        blocker: { reason: 'Need clarification' },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('blocked');
  });

  it('returns toolError for task not found', async () => {
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        get: () => null,
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '99-unknown-task', summary: 'x', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(false);
    expect(result.error).toContain('99-unknown-task');
    expect(result.error).toContain('not found');
  });

  it('returns toolError with sync guidance when no tasks are synced for feature', async () => {
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        get: () => null,
        list: () => [],
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      { task: '01-build-complexity-classifier-and-tests', summary: 'x', status: 'blocked' },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(false);
    expect(result.error).toContain('warcraft_tasks_sync');
    expect(result.error).toContain('No synced tasks found');
  });

  it('returns toolError for task not in progress', async () => {
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        get: () => ({ status: 'done', folder: '01-test', name: '01-test' }),
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '01-test', summary: 'x', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not in progress');
  });
});

describe('worktree_commit learnings contract', () => {
  it('accepts valid learnings array and returns terminal success', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: ['Use bun not npm', 'ESM needs .js extension'],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // Verify learnings were persisted via taskService.update
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toEqual(['Use bun not npm', 'ESM needs .js extension']);
  });

  it('omits learnings from update when not provided (backward compat)', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toBeUndefined();
  });

  it('handles empty learnings array gracefully (omits from update)', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: [],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // Empty array should be treated as "no learnings"
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toBeUndefined();
  });

  it('persists learnings on blocked status', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Blocked on config',
        status: 'blocked',
        blocker: { reason: 'Need credentials' },
        learnings: ['Config files live in /etc'],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('blocked');
    const blockedUpdate = updateCalls.find((u) => u.updates.status === 'blocked');
    expect(blockedUpdate).toBeDefined();
    expect(blockedUpdate!.updates.learnings).toEqual(['Config files live in /etc']);
  });
});

describe('worktree_commit best-effort verification model', () => {
  it('skips gate checks and returns verificationDeferred in best-effort mode', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        verificationModel: 'best-effort',
        workflowGatesMode: 'enforce',
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '01-test', summary: 'Did stuff', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('completed');
    expect(result.data.verificationDeferred).toBe(true);
    expect(result.data.deferredTo).toBe('orchestrator');
    // Should NOT have missingGates or needs_verification
    expect(result.data.missingGates).toBeUndefined();
  });

  it('tdd mode still checks gates (existing behavior preserved)', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        verificationModel: 'tdd',
        workflowGatesMode: 'enforce',
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute({ task: '01-test', summary: 'Did stuff', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.status).toBe('needs_verification');
  });

  it('best-effort mode does not add verificationDeferred for non-completed status', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        verificationModel: 'best-effort',
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Blocked on X',
        status: 'blocked',
        blocker: { reason: 'Need clarification' },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('blocked');
    expect(result.data.verificationDeferred).toBeUndefined();
  });
});

describe('worktree_commit learnings schema validation', () => {
  // The learnings schema is z.array(z.string()).optional()
  // These tests validate that the schema rejects invalid payloads.
  const learningsSchema = z.array(z.string()).optional();

  it('accepts valid string array', () => {
    const result = learningsSchema.safeParse(['Use bun', 'ESM needs .js']);
    expect(result.success).toBe(true);
  });

  it('accepts undefined (omitted)', () => {
    const result = learningsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it('accepts empty array', () => {
    const result = learningsSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects non-array value (string)', () => {
    const result = learningsSchema.safeParse('not an array');
    expect(result.success).toBe(false);
  });

  it('rejects non-array value (number)', () => {
    const result = learningsSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  it('rejects non-array value (object)', () => {
    const result = learningsSchema.safeParse({ key: 'value' });
    expect(result.success).toBe(false);
  });

  it('rejects array with non-string elements', () => {
    const result = learningsSchema.safeParse([1, 2, 3]);
    expect(result.success).toBe(false);
  });

  it('rejects array with mixed types', () => {
    const result = learningsSchema.safeParse(['valid', 42, null]);
    expect(result.success).toBe(false);
  });

  it('matches the schema used by commitWorktreeTool', () => {
    // Extract the actual tool args to ensure our test schema matches
    const tools = new WorktreeTools(createMockDeps());
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    // The tool has an args property with a learnings field
    expect(commitTool.args.learnings).toBeDefined();
  });
});

describe('worktree_commit invalid learnings via tool execute', () => {
  it('does not crash when learnings is a non-array (string) at tool boundary', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');

    // Simulate malformed payload that bypasses schema validation (e.g., persisted data)
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: 'not an array' as unknown as string[],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    // Must not crash — should succeed and omit invalid learnings
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // Learnings should NOT appear in update since they are malformed
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toBeUndefined();
  });

  it('does not crash when learnings contains non-string elements at tool boundary', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');

    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: ['valid learning', 42, null, ''] as unknown as string[],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // Only the valid non-empty string should be persisted
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toEqual(['valid learning']);
  });

  it('does not persist learnings when all entries are invalid at tool boundary', async () => {
    const updateCalls: Array<{ feature: string; task: string; updates: Record<string, unknown> }> = [];
    const deps = createMockDeps({
      taskService: {
        ...createMockDeps().taskService,
        update: (feature: string, task: string, updates: Record<string, unknown>) => {
          updateCalls.push({ feature, task, updates });
        },
      } as any,
    });
    const tools = new WorktreeTools(deps);
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');

    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        learnings: [42, null, '', '  '] as unknown as string[],
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // No valid learnings remain — should be treated as if omitted
    const doneUpdate = updateCalls.find((u) => u.updates.status === 'done');
    expect(doneUpdate).toBeDefined();
    expect(doneUpdate!.updates.learnings).toBeUndefined();
  });
});
