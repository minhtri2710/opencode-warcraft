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

describe('mergeTaskTool verification defaults', () => {
  const resolveFeature = () => 'test-feature';

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
