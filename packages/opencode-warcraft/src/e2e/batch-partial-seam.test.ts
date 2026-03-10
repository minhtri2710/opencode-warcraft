import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import plugin from '../index';
import { ensureFeatureExists } from './helpers/feature-setup.js';
import { createTestOpencodeClient } from './helpers/opencode-client.js';
import {
  cleanupTempProjectRoot,
  createTempProjectRoot,
  getHostPreflightSkipReason,
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
const describeIfHostReady = PRECONDITION_SKIP_REASON ? describe.skip : describe;
const runIfHostReady = PRECONDITION_SKIP_REASON ? it.skip : it;

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

function assertSuccess(output: string, label: string): void {
  const parsed = JSON.parse(output);
  if (!parsed.success) {
    throw new Error(`${label} failed: ${parsed.error || JSON.stringify(parsed)}`);
  }
}

function makePlan(title: string, tasks: string): string {
  return `# ${title}

## Discovery

**Q: Is this a test?**
A: Yes, this is a seam test validating batch dispatch where some tasks succeed and others fail or are blocked.

## Overview

${title} — seam test.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

${tasks}`;
}

describeIfHostReady('e2e: batch partial seam — mixed success/failure in batch dispatch', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = '';
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot('warcraft-batch-partial-seam');
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

  runIfHostReady(
    'batch dispatch: runnable tasks succeed, blocked tasks are rejected, system stays consistent',
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
      const toolContext = createToolContext('sess_batch_partial_seam');
      const featureName = 'batch-partial-seam-feature';

      // Setup
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan(
        'Batch Partial Seam Feature',
        `### 1. Task Alpha

**Depends on**: none

- Create: src/alpha.ts

Alpha task — independent, should dispatch.

### 2. Task Beta

**Depends on**: none

- Create: src/beta.ts

Beta task — independent, should dispatch.

### 3. Task Gamma

**Depends on**: 1, 2

- Create: src/gamma.ts

Gamma task — depends on alpha and beta, should NOT dispatch yet.`,
      );

      assertSuccess(
        (await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: featureName }, toolContext)) as string,
        'plan_write',
      );
      assertSuccess(
        (await hooks.tool!.warcraft_plan_approve.execute({ feature: featureName }, toolContext)) as string,
        'approve',
      );
      assertSuccess(
        (await hooks.tool!.warcraft_tasks_sync.execute({ feature: featureName }, toolContext)) as string,
        'sync',
      );

      // Step 1: Preview shows correct classification
      const previewOutput = await hooks.tool!.warcraft_batch_execute.execute(
        { mode: 'preview', feature: featureName },
        toolContext,
      );
      const preview = parseToolResponse<{
        summary: { runnable: number; blocked: number };
        runnable: Array<{ folder: string }>;
        blocked?: Array<{ folder: string; waitingOn: string[] }>;
      }>(previewOutput as string);

      expect(preview.summary.runnable).toBe(2);
      expect(preview.summary.blocked).toBe(1);
      expect(preview.runnable.map((r) => r.folder)).toContain('01-task-alpha');
      expect(preview.runnable.map((r) => r.folder)).toContain('02-task-beta');
      expect(preview.blocked?.[0]?.folder).toBe('03-task-gamma');

      // Step 2: Execute runnable tasks
      const executeOutput = await hooks.tool!.warcraft_batch_execute.execute(
        {
          mode: 'execute',
          tasks: ['01-task-alpha', '02-task-beta'],
          feature: featureName,
        },
        toolContext,
      );
      const result = parseToolResponse<{
        dispatched: { total: number; succeeded: number; failed: number };
        taskToolCalls: Array<{ subagent_type: string; description: string }>;
      }>(executeOutput as string);

      expect(result.dispatched.succeeded).toBe(2);
      expect(result.dispatched.failed).toBe(0);
      expect(result.taskToolCalls).toHaveLength(2);

      // Step 3: Attempting to dispatch blocked task should fail
      const blockedExecute = (await hooks.tool!.warcraft_batch_execute.execute(
        {
          mode: 'execute',
          tasks: ['03-task-gamma'],
          feature: featureName,
        },
        toolContext,
      )) as string;
      const blockedResult = JSON.parse(blockedExecute);
      expect(blockedResult.success).toBe(false);
      expect(blockedResult.error).toContain('03-task-gamma');

      // Step 4: Complete alpha and beta, then gamma should become runnable
      // Must transition dispatch_prepared → in_progress → done
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-task-alpha',
            status: 'in_progress',
            summary: 'Alpha worker started',
          },
          toolContext,
        )) as string,
        'alpha to in_progress',
      );

      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-task-alpha',
            status: 'done',
            summary:
              'Alpha done.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
          },
          toolContext,
        )) as string,
        'alpha to done',
      );

      // Complete beta: dispatch_prepared → in_progress → done
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '02-task-beta',
            status: 'in_progress',
            summary: 'Beta worker started',
          },
          toolContext,
        )) as string,
        'beta to in_progress',
      );

      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '02-task-beta',
            status: 'done',
            summary:
              'Beta done.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
          },
          toolContext,
        )) as string,
        'beta to done',
      );

      // Step 5: Preview again — gamma should now be runnable
      const previewAfter = parseToolResponse<{
        summary: { runnable: number; blocked: number; done?: number };
        runnable: Array<{ folder: string }>;
      }>(
        (await hooks.tool!.warcraft_batch_execute.execute(
          { mode: 'preview', feature: featureName },
          toolContext,
        )) as string,
      );

      expect(previewAfter.summary.runnable).toBe(1);
      expect(previewAfter.runnable.map((r) => r.folder)).toContain('03-task-gamma');

      // Step 6: Dispatch gamma — should now succeed
      const gammaExecute = parseToolResponse<{
        dispatched: { total: number; succeeded: number; failed: number };
        taskToolCalls: Array<{ subagent_type: string }>;
      }>(
        (await hooks.tool!.warcraft_batch_execute.execute(
          {
            mode: 'execute',
            tasks: ['03-task-gamma'],
            feature: featureName,
          },
          toolContext,
        )) as string,
      );

      expect(gammaExecute.dispatched.succeeded).toBe(1);
      expect(gammaExecute.dispatched.failed).toBe(0);

      // Step 7: Verify system consistency
      const statusFinal = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);

      const alpha = statusFinal.tasks?.list?.find((t) => t.folder === '01-task-alpha');
      const beta = statusFinal.tasks?.list?.find((t) => t.folder === '02-task-beta');
      const gamma = statusFinal.tasks?.list?.find((t) => t.folder === '03-task-gamma');

      expect(alpha?.status).toBe('done');
      expect(beta?.status).toBe('done');
      // Gamma was just dispatched, should be dispatch_prepared or in_progress
      expect(['dispatch_prepared', 'in_progress']).toContain(gamma?.status);
    },
    30_000,
  );

  runIfHostReady(
    'batch execute with mix of valid and invalid tasks handles partial failure correctly',
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
      const toolContext = createToolContext('sess_batch_mixed');
      const featureName = 'batch-mixed-seam-feature';

      // Setup
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan(
        'Batch Mixed Seam Feature',
        `### 1. Solo Task

**Depends on**: none

- Create: src/solo.ts

Solo independent task.`,
      );

      assertSuccess(
        (await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: featureName }, toolContext)) as string,
        'plan_write',
      );
      assertSuccess(
        (await hooks.tool!.warcraft_plan_approve.execute({ feature: featureName }, toolContext)) as string,
        'approve',
      );
      assertSuccess(
        (await hooks.tool!.warcraft_tasks_sync.execute({ feature: featureName }, toolContext)) as string,
        'sync',
      );

      // Try to batch execute with a non-existent task alongside a valid one
      // The batch should reject the entire set when invalid tasks are included
      const mixedOutput = (await hooks.tool!.warcraft_batch_execute.execute(
        {
          mode: 'execute',
          tasks: ['01-solo-task', '99-nonexistent-task'],
          feature: featureName,
        },
        toolContext,
      )) as string;
      const mixedResult = JSON.parse(mixedOutput);

      // Should fail validation since 99-nonexistent-task doesn't exist
      expect(mixedResult.success).toBe(false);
      expect(mixedResult.error).toContain('99-nonexistent-task');

      // Verify system is still consistent — solo task should still be pending
      const statusAfter = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      const soloTask = statusAfter.tasks?.list?.find((t) => t.folder === '01-solo-task');
      expect(soloTask?.status).toBe('pending');
    },
    30_000,
  );
});
