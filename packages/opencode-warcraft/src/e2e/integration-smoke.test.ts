import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import * as fs from 'fs';
import * as path from 'path';
import plugin from '../index.js';
import { ensureFeatureExists } from './helpers/feature-setup.js';
import { createTestOpencodeClient } from './helpers/opencode-client.js';
import {
  cleanupTempProjectRoot,
  createTempProjectRoot,
  getHostPreflightSkipReason,
  isRequestedE2eLane,
  setupGitProject,
} from './helpers/test-env.js';

const { client: OPENCODE_CLIENT } = createTestOpencodeClient();

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

const PRECONDITION_SKIP_REASON = getHostPreflightSkipReason({
  requireGit: true,
  requireBr: true,
});
const SHOULD_RUN_HOST_LANE = isRequestedE2eLane('host') && !PRECONDITION_SKIP_REASON;
const describeIfHostReady = SHOULD_RUN_HOST_LANE ? describe : describe.skip;
const runIfHostReady = SHOULD_RUN_HOST_LANE ? it : it.skip;

function createStubShell(): PluginInput['$'] {
  let shell: PluginInput['$'];

  const fn = ((..._args: unknown[]) => {
    throw new Error('shell not available in this test');
  }) as unknown as PluginInput['$'];

  shell = Object.assign(fn, {
    braces(pattern: string) {
      return [pattern];
    },
    escape(input: string) {
      return input;
    },
    env() {
      return shell;
    },
    cwd() {
      return shell;
    },
    nothrow() {
      return shell;
    },
    throws() {
      return shell;
    },
  });

  return shell;
}

function createToolContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: 'msg_test',
    agent: 'test',
    abort: new AbortController().signal,
  };
}

function createProject(worktree: string): PluginInput['project'] {
  return {
    id: 'test',
    worktree,
    time: { created: Date.now() },
  };
}

function parseToolResponse<T>(output: string): T {
  const parsed = JSON.parse(output);
  return (parsed.data ?? parsed) as T;
}

describeIfHostReady('e2e:host: post-refactor behavior stability', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = '';
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot('warcraft-integration-refactor-test');
    process.env.HOME = testRoot;

    setupGitProject(testRoot);
  });

  afterEach(() => {
    cleanupTempProjectRoot(testRoot);
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  runIfHostReady('warcraft_status returns BV triage info when available', async () => {
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL('http://localhost:1'),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext('sess_bv_triage');

    await hooks.tool!.warcraft_feature_create.execute({ name: 'bv-triage-feature' }, toolContext);

    const plan = `# BV Triage Feature

## Discovery

**Q: Is this a test?**
A: Yes, testing BV triage integration after refactor. This is a comprehensive test to ensure that the BV triage service integration works correctly after the recent refactoring changes.

## Overview

Test BV triage service integration.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task
Do it
`;
    await ensureFeatureExists(hooks, 'bv-triage-feature', toolContext);
    process.env.WARCRAFT_FEATURE = 'bv-triage-feature';
    await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: 'bv-triage-feature' }, toolContext);
    await hooks.tool!.warcraft_plan_approve.execute({ feature: 'bv-triage-feature' }, toolContext);
    await hooks.tool!.warcraft_tasks_sync.execute({ feature: 'bv-triage-feature' }, toolContext);

    const statusRaw = await hooks.tool!.warcraft_status.execute({ feature: 'bv-triage-feature' }, toolContext);
    const warcraftStatus = JSON.parse(statusRaw as string) as {
      tasks?: {
        list?: Array<{
          folder: string;
        }>;
        triage?: Record<
          string,
          {
            summary: string;
            source: string;
          }
        >;
        triageGlobal?: {
          summary?: string;
        } | null;
        triageHealth?: {
          enabled?: boolean;
          available?: boolean;
        };
      };
      health?: {
        reopenRate?: number;
      };
    };

    expect(Array.isArray(warcraftStatus.tasks?.list)).toBe(true);
    expect(warcraftStatus.tasks?.triage).toBeDefined();
    expect(warcraftStatus.tasks?.triageHealth).toBeDefined();
    expect(
      warcraftStatus.tasks?.triageGlobal === null || typeof warcraftStatus.tasks?.triageGlobal?.summary === 'string',
    ).toBe(true);
    expect(typeof warcraftStatus.health?.reopenRate).toBe('number');
  });

  runIfHostReady('warcraft_worktree_create returns task spec with proper structure', async () => {
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL('http://localhost:1'),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext('sess_spec_structure');

    await hooks.tool!.warcraft_feature_create.execute({ name: 'spec-structure-feature' }, toolContext);

    const plan = `# Spec Structure Feature

## Discovery

**Q: Is this a test?**
A: Yes, testing spec data contract after refactor. This comprehensive test ensures that the core service returns proper SpecData and the plugin layer formats it correctly for worker consumption.

## Overview

Test that core returns SpecData and plugin formats it correctly.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. Create Implementation

- Create: src/implementation.ts

Create the main implementation file.

### 2. Test Implementation

- Test: src/implementation.test.ts

Test the implementation thoroughly.
`;
    await ensureFeatureExists(hooks, 'spec-structure-feature', toolContext);
    process.env.WARCRAFT_FEATURE = 'spec-structure-feature';
    await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: 'spec-structure-feature' }, toolContext);
    await hooks.tool!.warcraft_plan_approve.execute({ feature: 'spec-structure-feature' }, toolContext);
    await hooks.tool!.warcraft_tasks_sync.execute({ feature: 'spec-structure-feature' }, toolContext);

    const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
      { feature: 'spec-structure-feature', task: '01-create-implementation' } as any,
      toolContext,
    );

    const execStart = parseToolResponse<{
      instructions?: string;
      taskSpec?: string;
      error?: string;
    }>(execStartOutput as string);

    // Verify no error was returned
    expect(execStart.error).toBeUndefined();
    expect(execStart.taskSpec).toBeDefined();
    expect(execStart.taskSpec).toContain('# Task: 01-create-implementation');
    expect(execStart.taskSpec).toContain('## Feature: spec-structure-feature');
    expect(execStart.taskSpec).toContain('## Dependencies');
    expect(execStart.taskSpec).toContain('## Plan Section');

    // Verify task type inference works (greenfield for "Create")
    expect(execStart.taskSpec).toContain('## Task Type');
    expect(execStart.taskSpec).toContain('greenfield');
  });

  runIfHostReady(
    'spec formatting handles dependencies correctly',
    async () => {
      const ctx: PluginInput = {
        directory: testRoot,
        worktree: testRoot,
        serverUrl: new URL('http://localhost:1'),
        project: createProject(testRoot),
        client: OPENCODE_CLIENT,
        $: createStubShell(),
      };

      const hooks = await plugin(ctx);
      const toolContext = createToolContext('sess_deps_formatting');

      await hooks.tool!.warcraft_feature_create.execute({ name: 'deps-formatting-feature' }, toolContext);

      const plan = `# Dependencies Formatting Feature

## Discovery

**Q: Is this a test?**
A: Yes, testing dependency formatting in spec. This comprehensive test ensures that dependencies are properly parsed from the plan and formatted correctly in the SpecData contract for worker consumption.

## Overview

Test dependency formatting through SpecData contract.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task

- Create: src/base.ts

Create base implementation.

### 2. Second Task

**Depends on**: 1

- Modify: src/base.ts

Modify the implementation.
`;
      await ensureFeatureExists(hooks, 'deps-formatting-feature', toolContext);
      process.env.WARCRAFT_FEATURE = 'deps-formatting-feature';
      await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: 'deps-formatting-feature' }, toolContext);
      await hooks.tool!.warcraft_plan_approve.execute({ feature: 'deps-formatting-feature' }, toolContext);
      await hooks.tool!.warcraft_tasks_sync.execute({ feature: 'deps-formatting-feature' }, toolContext);

      // Complete task 1 first since task 2 depends on it
      await hooks.tool!.warcraft_worktree_create.execute(
        { feature: 'deps-formatting-feature', task: '01-first-task' },
        toolContext,
      );
      const progressPath = path.join(
        testRoot,
        '.beads/artifacts/.worktrees/deps-formatting-feature/01-first-task/progress.txt',
      );
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      fs.writeFileSync(progressPath, 'complete task 1\n', 'utf-8');
      await hooks.tool!.warcraft_task_update.execute(
        {
          feature: 'deps-formatting-feature',
          task: '01-first-task',
          status: 'done',
          summary:
            'First task completed successfully.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
        },
        toolContext,
      );

      const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
        { feature: 'deps-formatting-feature', task: '02-second-task' },
        toolContext,
      );

      const execStart = parseToolResponse<{
        taskSpec?: string;
        error?: string;
      }>(execStartOutput as string);

      // Verify no error was returned
      expect(execStart.error).toBeUndefined();
      expect(execStart.taskSpec).toBeDefined();
      expect(execStart.taskSpec).toContain('## Dependencies');
      expect(execStart.taskSpec).toContain('**1. first-task**');
      expect(execStart.taskSpec).toContain('01-first-task');

      // Task 2 depends on task 1, so should show modification type
      expect(execStart.taskSpec).toContain('## Task Type');
      expect(execStart.taskSpec).toContain('modification');
    },
    15_000,
  );

  runIfHostReady(
    'completed tasks are included in spec context',
    async () => {
      const ctx: PluginInput = {
        directory: testRoot,
        worktree: testRoot,
        serverUrl: new URL('http://localhost:1'),
        project: createProject(testRoot),
        client: OPENCODE_CLIENT,
        $: createStubShell(),
      };

      const hooks = await plugin(ctx);
      const toolContext = createToolContext('sess_completed_context');

      await hooks.tool!.warcraft_feature_create.execute({ name: 'completed-context-feature' }, toolContext);

      const plan = `# Completed Context Feature

## Discovery

**Q: Is this a test?**
A: Yes, testing completed tasks in spec context. This comprehensive test ensures that when tasks are marked as completed, their summaries are properly included in the spec context for subsequent dependent tasks.

## Overview

Test that completed tasks appear in spec context.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. Setup Task

- Create: src/setup.ts

Setup the project.

### 2. Build Task

**Depends on**: 1

- Modify: src/setup.ts

Build on top of setup.
`;
      await ensureFeatureExists(hooks, 'completed-context-feature', toolContext);
      process.env.WARCRAFT_FEATURE = 'completed-context-feature';
      await hooks.tool!.warcraft_plan_write.execute(
        { content: plan, feature: 'completed-context-feature' },
        toolContext,
      );
      await hooks.tool!.warcraft_plan_approve.execute({ feature: 'completed-context-feature' }, toolContext);
      await hooks.tool!.warcraft_tasks_sync.execute({ feature: 'completed-context-feature' }, toolContext);

      // Mark first task as done
      await hooks.tool!.warcraft_worktree_create.execute(
        { feature: 'completed-context-feature', task: '01-setup-task' },
        toolContext,
      );
      const progressPath = path.join(
        testRoot,
        '.beads/artifacts/.worktrees/completed-context-feature/01-setup-task/progress.txt',
      );
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      fs.writeFileSync(progressPath, 'complete setup\n', 'utf-8');

      await hooks.tool!.warcraft_task_update.execute(
        {
          feature: 'completed-context-feature',
          task: '01-setup-task',
          status: 'done',
          summary:
            'Setup completed successfully with all dependencies installed.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
        },
        toolContext,
      );

      const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
        { feature: 'completed-context-feature', task: '02-build-task' },
        toolContext,
      );

      const execStart = parseToolResponse<{
        taskSpec?: string;
        error?: string;
      }>(execStartOutput as string);

      // Verify no error was returned
      expect(execStart.error).toBeUndefined();

      // Verify completed tasks section exists with the summary
      expect(execStart.taskSpec).toBeDefined();
      expect(execStart.taskSpec).toContain('## Completed Tasks');
      expect(execStart.taskSpec).toContain('01-setup-task');
      expect(execStart.taskSpec).toContain('Setup completed successfully');
    },
    15_000,
  );
});
