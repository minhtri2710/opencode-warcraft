import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import { createOpencodeClient } from '@opencode-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import plugin from '../index';
import { ensureFeatureExists } from './helpers/feature-setup.js';
import {
  cleanupTempProjectRoot,
  createTempProjectRoot,
  getHostPreflightSkipReason,
  setupGitProject,
} from './helpers/test-env.js';

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: 'http://localhost:1' }) as unknown as PluginInput['client'];

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
A: Yes, this is a comprehensive lifecycle integration test that validates the full Warcraft workflow. It covers feature creation, plan writing and approval, task synchronization, worktree creation, and task state transitions including dependency resolution.

## Overview

${title} — integration test.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

${tasks}`;
}

describeIfHostReady('e2e: lifecycle integration tests', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = '';
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot('warcraft-lifecycle-test');
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
    'full lifecycle: create -> plan -> approve -> sync -> worktree -> complete -> dependency unlock',
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
      const toolContext = createToolContext('sess_lifecycle');
      const featureName = 'lifecycle-feature';

      // Step 1: Create feature
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'feature_create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      // Step 2: Write plan with dependency chain
      const plan = makePlan('Lifecycle Feature', `### 1. First Task

- Create: src/first.ts

Create the first implementation file.

### 2. Second Task

**Depends on**: 1

- Modify: src/first.ts

Modify the first implementation file.`);

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

      // Step 5: Verify initial task state — task 1 runnable, task 2 blocked
      const status1 = parseToolResponse<{
        tasks?: {
          total: number;
          list?: Array<{ folder: string; status: string }>;
          runnable?: string[];
          blockedBy?: Record<string, string[]>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      expect(status1.tasks?.total).toBe(2);
      expect(status1.tasks?.runnable).toContain('01-first-task');
      expect(status1.tasks?.blockedBy?.['02-second-task']).toBeDefined();

      // Step 6: Start task 1 (creates worktree)
      const wt1Output = parseToolResponse<{
        taskToolCall?: { subagent_type: string };
      }>(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '01-first-task' },
          toolContext,
        )) as string,
      );
      expect(wt1Output.taskToolCall?.subagent_type).toBe('mekkatorque');

      // Step 7: Complete task 1 (following existing test pattern with progress file + task_update)
      const progressPath = path.join(
        testRoot,
        '.beads/artifacts/.worktrees/lifecycle-feature/01-first-task/progress.txt',
      );
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      fs.writeFileSync(progressPath, 'task 1 done\n', 'utf-8');
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-first-task',
            status: 'done',
            summary:
              'First task completed.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
          },
          toolContext,
        )) as string,
        'task_update to done',
      );

      // Step 8: Verify task 2 is now accessible (dependency resolved)
      // Following the existing integration-smoke test pattern: verify by worktree_create for dependent task
      const wt2Output = parseToolResponse<{
        taskToolCall?: { subagent_type: string };
        taskSpec?: string;
        error?: string;
      }>(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '02-second-task' },
          toolContext,
        )) as string,
      );
      // If dependency wasn't resolved, this would fail with "dependencies not done"
      expect(wt2Output.error).toBeUndefined();
      expect(wt2Output.taskToolCall?.subagent_type).toBe('mekkatorque');
      expect(wt2Output.taskSpec).toContain('Dependencies');
    },
    30_000,
  );

  runIfHostReady(
    'blocked-worker resume: task goes in_progress -> blocked -> in_progress -> done',
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
      const toolContext = createToolContext('sess_blocked_resume');
      const featureName = 'blocked-resume-feature';

      // Setup
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan('Blocked Resume Feature', `### 1. Blocking Task

- Create: src/blocking.ts

Create a task that will be blocked by the worker needing clarification on the API design approach.`);

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

      // Start task
      await hooks.tool!.warcraft_worktree_create.execute(
        { feature: featureName, task: '01-blocking-task' },
        toolContext,
      );

      // Worker reports blocked
      const blockResult = await hooks.tool!.warcraft_task_update.execute(
        {
          feature: featureName,
          task: '01-blocking-task',
          status: 'blocked',
          summary: 'Need clarification on API design',
        },
        toolContext,
      );
      assertSuccess(blockResult as string, 'update to blocked');

      // Resume: back to in_progress
      const resumeResult = await hooks.tool!.warcraft_task_update.execute(
        {
          feature: featureName,
          task: '01-blocking-task',
          status: 'in_progress',
          summary: 'Resuming with decision: use REST API',
        },
        toolContext,
      );
      assertSuccess(resumeResult as string, 'update to in_progress');

      // Verify the task update succeeded — the status response confirms transition
      const resumeParsed = JSON.parse(resumeResult as string);
      expect(resumeParsed.data?.message).toContain('status=in_progress');

      // Complete after resume
      const doneResult = await hooks.tool!.warcraft_task_update.execute(
        {
          feature: featureName,
          task: '01-blocking-task',
          status: 'done',
          summary:
            'Completed after resume.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
        },
        toolContext,
      );
      assertSuccess(doneResult as string, 'update to done');

      const doneParsed = JSON.parse(doneResult as string);
      expect(doneParsed.data?.message).toContain('status=done');
    },
    30_000,
  );

  runIfHostReady(
    'failed-verification recovery: done -> in_progress -> done (with proper evidence)',
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
      const toolContext = createToolContext('sess_failed_verif');
      const featureName = 'failed-verif-feature';

      // Setup
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan('Failed Verification Feature', `### 1. Verification Task

- Create: src/verify.ts

Create a task that will fail verification initially and then be retried with proper evidence. Tests the re-open workflow.`);

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

      // Start task
      await hooks.tool!.warcraft_worktree_create.execute(
        { feature: featureName, task: '01-verification-task' },
        toolContext,
      );

      // First attempt: mark done WITHOUT verification evidence
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-verification-task',
            status: 'done',
            summary: 'Implemented feature but did not run verification commands',
          },
          toolContext,
        )) as string,
        'first done attempt (no evidence)',
      );

      // Orchestrator catches and re-opens
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          {
            feature: featureName,
            task: '01-verification-task',
            status: 'in_progress',
            summary: 'Re-opened: missing verification evidence',
          },
          toolContext,
        )) as string,
        're-open to in_progress',
      );

      // Second attempt: mark done WITH proper evidence
      const secondDoneResult = await hooks.tool!.warcraft_task_update.execute(
        {
          feature: featureName,
          task: '01-verification-task',
          status: 'done',
          summary:
            'Implemented feature with full verification.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
        },
        toolContext,
      );
      assertSuccess(secondDoneResult as string, 'second done attempt with evidence');

      const doneParsed = JSON.parse(secondDoneResult as string);
      expect(doneParsed.data?.message).toContain('status=done');
    },
    30_000,
  );

  runIfHostReady(
    'beads mode on: feature artifacts stored under .beads/artifacts',
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
      const toolContext = createToolContext('sess_beads_on');
      const featureName = 'beads-on-feature';

      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      // Verify bead artifacts directory was created
      const artifactsPath = path.join(testRoot, '.beads', 'artifacts', featureName);
      expect(fs.existsSync(artifactsPath)).toBe(true);

      const plan = makePlan('Beads On Feature', `### 1. Bead Task
Do bead work`);

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

      // Verify tasks are returned from bead store
      const status = parseToolResponse<{
        tasks?: { total: number; runnable?: string[] };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      expect(status.tasks?.total).toBeGreaterThan(0);
      expect(status.tasks?.runnable).toContain('01-bead-task');
    },
    15_000,
  );
});
