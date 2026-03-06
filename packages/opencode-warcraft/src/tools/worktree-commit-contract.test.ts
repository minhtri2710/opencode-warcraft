import { describe, expect, it } from 'bun:test';
import { WorktreeTools } from './worktree-tools.js';

type MockDeps = ConstructorParameters<typeof WorktreeTools>[0];

function createMockDeps(overrides: Partial<MockDeps> = {}): MockDeps {
  return {
    featureService: { get: () => ({ name: 'test-feature' }) } as any,
    planService: {} as any,
    taskService: {
      get: (_f: string, _t: string) => ({ status: 'in_progress', folder: '01-test', name: '01-test' }),
      update: () => {},
      transition: () => {},
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
    structuredVerificationMode: 'compat' as const,
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

// ============================================================================
// Structured Verification Payload Tests
// ============================================================================

describe('worktree_commit structured verification payload', () => {
  it('accepts full structured verification and passes all gates', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'compat',
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Implemented X.',
        status: 'completed',
        verification: {
          build: { cmd: 'bun run build', exitCode: 0 },
          test: { cmd: 'bun test', exitCode: 0 },
          lint: { cmd: 'bun run lint', exitCode: 0 },
        },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('completed');
  });

  it('rejects when structured verification shows non-zero exit code in enforce mode', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'compat',
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Implemented X.',
        status: 'completed',
        verification: {
          build: { cmd: 'bun run build', exitCode: 0 },
          test: { cmd: 'bun test', exitCode: 1, output: 'FAIL: 2 tests failed' },
          lint: { cmd: 'bun run lint', exitCode: 0 },
        },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.status).toBe('needs_verification');
    expect(result.data.missingGates).toContain('test');
    expect(result.data.missingGates).not.toContain('build');
    expect(result.data.missingGates).not.toContain('lint');
  });

  it('falls back to regex when structured verification is partial (compat mode)', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'compat',
        // hasCompletionGateEvidence will match 'lint: exit 0' from summary
        hasCompletionGateEvidence: (summary: string, gate: string) => summary.includes(`${gate}: exit 0`),
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Implemented X. lint: exit 0',
        status: 'completed',
        verification: {
          build: { cmd: 'bun run build', exitCode: 0 },
          test: { cmd: 'bun test', exitCode: 0 },
          // lint omitted — should fall back to regex on summary
        },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    expect(result.data.status).toBe('completed');
  });

  it('blocks completed status when enforce mode requires structured payload and none provided', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'enforce',
        // regex fallback would normally pass, but enforce mode should require structured data
        hasCompletionGateEvidence: (_summary: string, _gate: string) => true,
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        // No verification payload provided
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.status).toBe('needs_verification');
    expect(result.data.missingGates).toEqual(['build', 'test', 'lint']);
  });

  it('emits diagnostics in compat mode when structured payload is missing', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'warn',
        structuredVerificationMode: 'compat',
        hasCompletionGateEvidence: (summary: string, gate: string) => summary.includes(`${gate}: exit 0`),
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        // No structured verification — using regex fallback in compat mode
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(true);
    expect(result.data.terminal).toBe(true);
    // Should include a diagnostic hint about using structured verification
    expect(result.data.verificationDiagnostics).toBeDefined();
    expect(result.data.verificationDiagnostics).toContain('regex');
  });

  it('contradictory summary and structured verification — structured wins', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'compat',
        // regex says build passed from summary
        hasCompletionGateEvidence: (summary: string, gate: string) => summary.includes(`${gate}: exit 0`),
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        // Summary claims build passed, but structured verification says it failed
        summary: 'build: exit 0, test: exit 0, lint: exit 0',
        status: 'completed',
        verification: {
          build: { cmd: 'bun run build', exitCode: 1, output: 'Compile error' },
          test: { cmd: 'bun test', exitCode: 0 },
          lint: { cmd: 'bun run lint', exitCode: 0 },
        },
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    // Structured verification takes precedence — build failed
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.missingGates).toContain('build');
  });

  it('no verification and no summary evidence in compat mode — falls back to regex behavior', async () => {
    const tools = new WorktreeTools(
      createMockDeps({
        workflowGatesMode: 'enforce',
        structuredVerificationMode: 'compat',
        hasCompletionGateEvidence: (_summary: string, _gate: string) => false,
      }),
    );
    const commitTool = tools.commitWorktreeTool(() => 'test-feature');
    const raw = await commitTool.execute(
      {
        task: '01-test',
        summary: 'Did stuff without verification evidence',
        status: 'completed',
      },
      MOCK_CONTEXT,
    );
    const result = parseResult(raw);
    expect(result.success).toBe(true);
    expect(result.data.ok).toBe(false);
    expect(result.data.terminal).toBe(false);
    expect(result.data.missingGates).toEqual(['build', 'test', 'lint']);
  });
});
