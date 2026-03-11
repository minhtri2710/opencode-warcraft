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

function assertSuccessOutput(output: unknown, label: string): void {
  const parsed = JSON.parse(output as string);
  if (!parsed.success) {
    throw new Error(`${label} failed: ${parsed.error || JSON.stringify(parsed)}`);
  }
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
A: Yes, this is a seam test validating the blocked → user-decision → resume workflow.

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

describeIfHostReady('e2e:host: blocked/resume seam — blocked → decision → resume → completed', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = '';
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot('warcraft-blocked-resume-seam');
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
    'worker reports blocker, task transitions to blocked, resume with decision restarts work, final state is completed',
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
      const toolContext = createToolContext('sess_blocked_resume_seam');
      const featureName = 'blocked-resume-seam-feature';

      // Setup: create feature + plan + approve + sync
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan(
        'Blocked Resume Seam Feature',
        `### 1. Blockable Task

- Create: src/blockable.ts

Create a task that will be blocked by the worker needing clarification.`,
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

      // Step 1: Dispatch — start the task
      const dispatchResult = parseToolResponse<{
        taskToolCall?: { subagent_type: string };
        workspacePath?: string;
      }>(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '01-blockable-task' },
          toolContext,
        )) as string,
      );
      expect(dispatchResult.taskToolCall?.subagent_type).toBe('mekkatorque');
      const initialWorkspacePath = dispatchResult.workspacePath;
      expect(initialWorkspacePath).toBeTruthy();

      // Step 2: Worker reports blocker
      const blockResult = await hooks.tool!.warcraft_worktree_commit.execute(
        {
          feature: featureName,
          task: '01-blockable-task',
          status: 'blocked',
          summary: 'Need clarification on API design approach',
          blocker: { reason: 'Need user clarification on API design approach' },
        },
        toolContext,
      );
      assertSuccessOutput(blockResult, 'commit blocked');

      const blockedPayload = parseToolResponse<{
        workspaceMode?: string;
        workspacePath?: string;
      }>(blockResult as string);
      expect(blockedPayload.workspaceMode).toBe('worktree');
      expect(blockedPayload.workspacePath).toBe(initialWorkspacePath);

      // Step 3: Verify task is in blocked state
      const statusBlocked = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string; workspace?: { path?: string | null } | null }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      const taskBlocked = statusBlocked.tasks?.list?.find((t) => t.folder === '01-blockable-task');
      expect(taskBlocked?.status).toBe('blocked');
      expect(taskBlocked?.workspace?.path).toBe(initialWorkspacePath);

      // Step 4: Resume with decision using blocked-only resume semantics
      const resumeRaw = (await hooks.tool!.warcraft_worktree_create.execute(
        {
          feature: featureName,
          task: '01-blockable-task',
          continueFrom: 'blocked',
          decision: 'Use REST API approach',
        },
        toolContext,
      )) as string;
      const resumeParsed = JSON.parse(resumeRaw);
      expect(resumeParsed.success).toBe(true);
      const resumeResult = parseToolResponse<{
        taskToolCall?: { subagent_type: string };
        workspacePath?: string;
      }>(resumeRaw);
      expect(resumeResult.taskToolCall?.subagent_type).toBe('mekkatorque');
      expect(resumeResult.workspacePath).toBe(initialWorkspacePath);

      // Non-blocked tasks must fail blocked-resume requests
      const nonBlockedResume = JSON.parse(
        (await hooks.tool!.warcraft_worktree_create.execute(
          { feature: featureName, task: '01-blockable-task', continueFrom: 'blocked', decision: 'retry' },
          toolContext,
        )) as string,
      );
      expect(nonBlockedResume.success).toBe(false);
      expect(nonBlockedResume.error).toContain('not in blocked state');

      // Step 5: Resume returns task to active execution while preserving workspace continuity metadata.
      const statusResumed = parseToolResponse<{
        tasks?: {
          list?: Array<{ folder: string; status: string; workspace?: { path?: string | null } | null }>;
        };
      }>((await hooks.tool!.warcraft_status.execute({ feature: featureName }, toolContext)) as string);
      const taskResumed = statusResumed.tasks?.list?.find((t) => t.folder === '01-blockable-task');
      expect(taskResumed?.status).toBe('in_progress');
      expect(taskResumed?.workspace?.path).toBe(initialWorkspacePath);

      // Step 6: Complete after successful resume
      const doneResult = await hooks.tool!.warcraft_task_update.execute(
        {
          feature: featureName,
          task: '01-blockable-task',
          status: 'done',
          summary:
            'Completed after resume.\n\n- build: bun run build (exit 0)\n- test: bun run test (exit 0)\n- lint: bun run lint (exit 0)',
        },
        toolContext,
      );
      assertSuccess(doneResult as string, 'update to done');

      const doneParsed = JSON.parse(doneResult as string);
      expect(doneParsed.success).toBe(true);
      expect(JSON.stringify(doneParsed)).toContain('done');
    },
    30_000,
  );

  runIfHostReady(
    'blocked state prevents dispatch of non-blocked tasks (blocked is a dead-end until resume)',
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
      const toolContext = createToolContext('sess_blocked_dead_end');
      const featureName = 'blocked-dead-end-feature';

      // Setup
      assertSuccess(
        (await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext)) as string,
        'create',
      );
      await ensureFeatureExists(hooks, featureName, toolContext);
      process.env.WARCRAFT_FEATURE = featureName;

      const plan = makePlan(
        'Blocked Dead End Feature',
        `### 1. First Task

- Create: src/first.ts

First task.

### 2. Second Task

**Depends on**: 1

- Create: src/second.ts

Second task depends on first.`,
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

      // Dispatch first task
      await hooks.tool!.warcraft_worktree_create.execute({ feature: featureName, task: '01-first-task' }, toolContext);

      // Transition to in_progress then blocked
      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          { feature: featureName, task: '01-first-task', status: 'in_progress', summary: 'Working' },
          toolContext,
        )) as string,
        'to in_progress',
      );

      assertSuccess(
        (await hooks.tool!.warcraft_task_update.execute(
          { feature: featureName, task: '01-first-task', status: 'blocked', summary: 'Blocked on API choice' },
          toolContext,
        )) as string,
        'to blocked',
      );

      // Trying to dispatch the second task should fail (task 1 not done)
      const secondResult = (await hooks.tool!.warcraft_worktree_create.execute(
        { feature: featureName, task: '02-second-task' },
        toolContext,
      )) as string;
      const secondParsed = JSON.parse(secondResult);
      expect(secondParsed.success).toBe(false);
      expect(secondParsed.error).toContain('dependencies not done');
    },
    30_000,
  );
});
