import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import plugin from '../index';
import { ensureFeatureExists } from './helpers/feature-setup.js';
import { createTestOpencodeClient } from './helpers/opencode-client.js';
import {
  cleanupTempProjectRoot,
  createTempProjectRoot,
  getHostPreflightSkipReason,
  isRequestedE2eLane,
  setupGitProject,
  waitForCondition,
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
A: Yes, this is a seam test validating the dispatch → worker-start → commit → merge flow end-to-end with stubbed services.

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

describeIfHostReady('e2e:host: dispatch seam — dispatch_prepared → in_progress → completed → merge', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = '';
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot('warcraft-dispatch-seam');
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
    'dispatch transitions to dispatch_prepared, worker-start transitions to in_progress, commit to completed, merge succeeds',
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
      const toolContext = createToolContext('sess_dispatch_seam');
      const featureName = 'dispatch-seam-feature';

      // Step 1: Create feature
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'feature_create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      // Step 2: Write plan with a single task
      const plan = makePlan(
        'Dispatch Seam Feature',
        `### 1. Dispatch Task

- Create: src/dispatch.ts

Create a file to validate the dispatch flow.`,
      );

      assertSuccess(
        (await hooks.tool!.warcraft_plan_write.execute({ content: plan, feature: featureName }, toolContext)) as string,
        'plan_write',
      );

      // Step 3: Approve plan
      assertSuccess(
        (await hooks.tool!.warcraft_plan_approve.execute({ feature: featureName }, toolContext)) as string,
        'plan_approve',
      );

      // Step 4: Sync tasks
      assertSuccess(
        (await hooks.tool!.warcraft_tasks_sync.execute({ feature: featureName }, toolContext)) as string,
        'tasks_sync',
      );

      // Step 5: Verify task is runnable before dispatch
      const statusBefore = parseToolResponse<{
        tasks?: {
          total: number;
          runnable?: string[];
          list?: Array<{ folder: string; status: string }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      expect(statusBefore.tasks?.runnable).toContain('01-dispatch-task');

      // Step 6: Dispatch task — this should transition to dispatch_prepared
      const dispatchOutput = parseToolResponse<{
        taskToolCall?: { subagent_type: string };
        workspaceMode?: string;
        branch?: string;
      }>(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '01-dispatch-task' },
          toolContext,
        )) as string,
      );

      expect(dispatchOutput.taskToolCall?.subagent_type).toBe('mekkatorque');
      expect(dispatchOutput.workspaceMode).toBe('worktree');
      expect(dispatchOutput.branch).toBeDefined();

      // Step 7: Verify task is now dispatch_prepared (or in_progress)
      const statusAfterDispatch = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      const taskAfterDispatch = statusAfterDispatch.tasks?.list?.find((t) => t.folder === '01-dispatch-task');
      expect(taskAfterDispatch).toBeDefined();
      // Task should be in dispatch_prepared state after worktree_create
      expect(['dispatch_prepared', 'in_progress']).toContain(taskAfterDispatch?.status);

      // Step 8: Simulate worker start — transition to in_progress
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-dispatch-task',
            status: 'in_progress',
            summary: 'Worker started execution',
          },
          toolContext,
        )) as string,
        'transition to in_progress',
      );

      // Verify in_progress state. Beads-backed status updates can lag briefly after task_update.
      const statusInProgress = await waitForCondition(
        async () =>
          parseToolResponse<{
            tasks?: {
              list?: Array<{ folder: string; status: string }>;
            };
          }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string),
        (status) =>
          status.tasks?.list?.some((t) => t.folder === '01-dispatch-task' && t.status === 'in_progress') === true,
        10_000,
      );
      const taskInProgress = statusInProgress.tasks?.list?.find((t) => t.folder === '01-dispatch-task');
      expect(taskInProgress?.status).toBe('in_progress');

      // Step 9: Complete the task via task_update (simulating commit)
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-dispatch-task',
            status: 'done',
            summary:
              'Task completed successfully.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
          },
          toolContext,
        )) as string,
        'transition to done',
      );

      // Verify done state
      const statusDone = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      const taskDone = statusDone.tasks?.list?.find((t) => t.folder === '01-dispatch-task');
      expect(taskDone?.status).toBe('done');

      // Step 10: Merge the completed task
      const mergeOutput = (await hooks.tool!.warcraft_merge.execute(
        { feature: featureName, task: '01-dispatch-task', verify: false },
        toolContext,
      )) as string;
      const mergeParsed = JSON.parse(mergeOutput);
      expect(mergeParsed.success).toBe(true);
      // Merge message should confirm success (worktree or direct mode)
      expect(mergeParsed.data?.message).toBeDefined();
    },
    30_000,
  );

  runIfHostReady(
    'dispatch_prepared blocks duplicate dispatch of same task',
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
      const toolContext = createToolContext('sess_double_dispatch');
      const featureName = 'double-dispatch-feature';

      // Setup feature + plan + sync
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan(
        'Double Dispatch Feature',
        `### 1. Single Task

- Create: src/single.ts

A task that should only be dispatched once.`,
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

      // First dispatch succeeds
      const first = parseToolResponse<{ taskToolCall?: { subagent_type: string } }>(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '01-single-task' },
          toolContext,
        )) as string,
      );
      expect(first.taskToolCall?.subagent_type).toBe('mekkatorque');

      // Second dispatch should fail — task is already dispatch_prepared
      const secondRaw = (await hooks.tool!.warcraft_worktree_create.execute(
        { feature: featureName, task: '01-single-task' },
        toolContext,
      )) as string;
      const second = JSON.parse(secondRaw);
      expect(second.success).toBe(false);
      // Error should mention already dispatching or in progress
      expect(second.error).toBeDefined();
    },
    30_000,
  );
});
