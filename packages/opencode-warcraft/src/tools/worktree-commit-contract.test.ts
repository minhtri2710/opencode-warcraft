import { describe, expect, it } from 'bun:test';
import { createNoopEventLogger } from 'warcraft-core';
import { WorktreeTools } from './worktree-tools.js';

type MockDeps = ConstructorParameters<typeof WorktreeTools>[0];

function createMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    featureService: { get: () => ({ name: 'test-feature' }) } as any,
    planService: {} as any,
    taskService: {
      get: (_f: string, _t: string) => ({ status: 'in_progress', folder: '01-test', name: '01-test' }),
      update: () => {},
      writeReport: () => {},
      getRawStatus: () => null,
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
    const raw = await commitTool.execute({ task: '01-test', summary: 'x', status: 'completed' }, MOCK_CONTEXT);
    const result = parseResult(raw);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
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
