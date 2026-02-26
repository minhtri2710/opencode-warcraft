import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import type { PluginInput } from "@opencode-ai/plugin";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "../index";
import { BUILTIN_SKILLS } from "../skills/registry.generated.js";
import {
  cleanupTempProjectRoot,
  createTempProjectRoot,
  getHostPreflightSkipReason,
  setupGitProject,
} from "./helpers/test-env.js";

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" }) as unknown as PluginInput["client"];

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

const EXPECTED_TOOLS = [
  "warcraft_feature_create",
  "warcraft_feature_complete",
  "warcraft_plan_write",
  "warcraft_plan_read",
  "warcraft_plan_approve",
  "warcraft_tasks_sync",
  "warcraft_task_create",
  "warcraft_task_update",
  "warcraft_worktree_create",
  "warcraft_worktree_commit",
  "warcraft_worktree_discard",
  "warcraft_merge",
  "warcraft_batch_execute",
  "warcraft_context_write",
  "warcraft_agents_md",
  "warcraft_status",
  "warcraft_skill",
] as const;

const PRECONDITION_SKIP_REASON = getHostPreflightSkipReason({
  requireGit: true,
  requireBr: true,
});
const describeIfHostReady = PRECONDITION_SKIP_REASON ? describe.skip : describe;
const runIfHostReady = PRECONDITION_SKIP_REASON ? it.skip : it;

function createStubShell(): PluginInput["$"] {
  let shell: PluginInput["$"];

  const fn = ((..._args: unknown[]) => {
    throw new Error("shell not available in this test");
  }) as unknown as PluginInput["$"];

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
    messageID: "msg_test",
    agent: "test",
    abort: new AbortController().signal,
  };
}

function createProject(worktree: string): PluginInput["project"] {
  return {
    id: "test",
    worktree,
    time: { created: Date.now() },
  };
}

/**
 * Parse a tool response string, unwrapping the `data` property from `toolSuccess`.
 * For `toolError` responses (success: false), returns the raw parsed object.
 */
function parseToolResponse<T>(output: string): T {
  const parsed = JSON.parse(output);
  return (parsed.data ?? parsed) as T;
}

describeIfHostReady("e2e: opencode-warcraft plugin (in-process)", () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testRoot = "";
    originalHome = process.env.HOME;
    testRoot = createTempProjectRoot("warcraft-e2e-plugin-project");
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

  runIfHostReady("registers expected tools and basic workflow works", async () => {
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);

    expect(hooks.tool).toBeDefined();

    for (const toolName of EXPECTED_TOOLS) {
      expect(hooks.tool?.[toolName]).toBeDefined();
      expect(typeof hooks.tool?.[toolName].execute).toBe("function");
    }

    const sessionID = "sess_plugin_smoke";
    const toolContext = createToolContext(sessionID);

    const createOutput = await hooks.tool!.warcraft_feature_create.execute(
      { name: "smoke-feature" },
      toolContext
    );
    const createParsed = JSON.parse(createOutput as string);
    expect(createParsed.success).toBe(true);
    expect(createParsed.data?.message).toContain('Feature "smoke-feature" created');

    const plan = `# Smoke Feature

## Discovery

**Q: Is this a test?**
A: Yes, this is an integration test to validate the basic workflow of feature creation, plan writing, task sync, and worktree operations work correctly end-to-end in the plugin.

## Overview

Test

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task
Do it
`;
    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "smoke-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    // Re-create it if it doesn't exist, we don't care
    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "smoke-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    process.env.WARCRAFT_FEATURE = "smoke-feature";
    const planOutput = await hooks.tool!.warcraft_plan_write.execute(
      { content: plan, feature: "smoke-feature" },
      toolContext
    );
    const planParsed = JSON.parse(planOutput as string);
    expect(planParsed.success).toBe(true);
    expect(planParsed.data?.message).toContain("Plan written");

    const approveOutput = await hooks.tool!.warcraft_plan_approve.execute({ feature: "smoke-feature" }, toolContext);
    const approveParsed = JSON.parse(approveOutput as string);
    expect(approveParsed.success).toBe(true);
    expect(approveParsed.data?.message).toContain("Plan approved");

    const syncOutput = await hooks.tool!.warcraft_tasks_sync.execute({ feature: "smoke-feature" }, toolContext);
    const syncParsed = JSON.parse(syncOutput as string);
    expect(syncParsed.success).toBe(true);
    expect(syncParsed.data?.message).toContain("Tasks synced");

    // In beads-on mode, task state lives in bead artifacts (no local docs/ cache).
    // Verify task was created by checking the status tool output below.

    // Session is tracked on the feature metadata
    const featureJsonPath = path.join(
      testRoot,
      ".beads",
      "artifacts",
      "smoke-feature",
      "feature.json"
    );

    const featureJson = JSON.parse(fs.readFileSync(featureJsonPath, "utf-8")) as {
      sessionId?: string;
    };

    expect(featureJson.sessionId).toBe(sessionID);

    const statusRaw = await hooks.tool!.warcraft_status.execute(
      { feature: "smoke-feature" },
      toolContext
    );
    const warcraftStatus = parseToolResponse<{
      tasks?: {
        list?: Array<{
          folder: string;
          dependsOn?: string[] | null;
          worktree?: { branch: string; hasChanges: boolean | null } | null;
        }>;
        runnable?: string[];
        blockedBy?: Record<string, string[]>;
        analytics?: {
          provider?: string;
          generatedAt?: string;
          blockedTaskInsights?: Record<string, unknown>;
        };
      };
    }>(statusRaw as string);

    expect(warcraftStatus.tasks?.list?.[0]?.folder).toBe("01-first-task");
    expect(warcraftStatus.tasks?.list?.[0]?.dependsOn).toEqual([]);
    expect(warcraftStatus.tasks?.list?.[0]?.worktree).toBeNull();
    expect(warcraftStatus.tasks?.runnable).toContain("01-first-task");
    expect(warcraftStatus.tasks?.blockedBy).toEqual({});
    expect(['bv', 'unavailable', 'disabled']).toContain(
      warcraftStatus.tasks?.analytics?.provider,
    );
    expect(typeof warcraftStatus.tasks?.analytics?.generatedAt).toBe('string');

    const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
      { feature: "smoke-feature", task: "01-first-task" },
      toolContext
    );
    const execStart = parseToolResponse<{
      instructions?: string;
      backgroundTaskCall?: Record<string, unknown>;
    }>(execStartOutput as string);
    expect(execStart.backgroundTaskCall).toBeUndefined();

    const statusOutput = await hooks.tool!.warcraft_status.execute(
      { feature: "smoke-feature" },
      toolContext
    );
    const status = parseToolResponse<{
      tasks?: {
        list?: Array<{ folder: string }>;
      };
    }>(statusOutput as string);
    expect(status.tasks?.list?.[0]?.folder).toBe("01-first-task");
  });

  runIfHostReady("returns task tool call using inline prompt", async () => {

    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext("sess_task_mode");

    await hooks.tool!.warcraft_feature_create.execute(
      { name: "task-mode-feature" },
      toolContext
    );

    const plan = `# Task Mode Feature

## Discovery

**Q: Is this a test?**
A: Yes, this is an integration test to validate task mode with inline prompts. Testing that worker prompt content is persisted in the main task bead and reused.

## Overview

Test

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task
Do it
`;
    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "task-mode-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    await hooks.tool!.warcraft_plan_write.execute(
      { content: plan, feature: "task-mode-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_plan_approve.execute(
      { feature: "task-mode-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_tasks_sync.execute(
      { feature: "task-mode-feature" },
      toolContext
    );

    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "task-mode-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    process.env.WARCRAFT_FEATURE = "task-mode-feature";
    const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
      { feature: "task-mode-feature", task: "01-first-task" },
      toolContext
    );
    const execStart = parseToolResponse<{
      instructions?: string;
      taskPromptMode?: string;
      taskToolCall?: {
        subagent_type?: string;
        description?: string;
        prompt?: string;
      };
    }>(execStartOutput as string);
    // DEBUG: Log the actual output to diagnose the issue
    console.log('[DEBUG] execStartOutput:', execStartOutput);
    console.log('[DEBUG] execStart:', JSON.stringify(execStart, null, 2));
    
    expect(execStart.taskToolCall).toBeDefined();
    expect(execStart.taskToolCall).toBeDefined();
    expect(execStart.taskToolCall?.subagent_type).toBeDefined();
    expect(execStart.taskToolCall?.description).toBe("Warcraft: 01-first-task");
    expect(execStart.taskToolCall?.prompt).toBeDefined();
    expect(execStart.taskToolCall?.prompt).not.toContain("@.beads/artifacts/");
    expect(execStart.taskPromptMode).toBe("opencode-inline");
    expect(execStart.instructions).toContain("task({");
    expect(execStart.instructions).toContain("The worker prompt is passed inline");
  });

  runIfHostReady("system prompt hook injects Warcraft instructions", async () => {
    const configPath = path.join(process.env.HOME || "", ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          "khadgar": {
            autoLoadSkills: ["brainstorming"],
          },
        },
      }),
    );
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);

    await hooks.tool!.warcraft_feature_create.execute({ name: "active" }, createToolContext("sess"));

    // system.transform should still inject WARCRAFT_SYSTEM_PROMPT and status hint
    const output = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.({ agent: "khadgar" }, output);
    output.system.push("## Base Agent Prompt");

    const joined = output.system.join("\n");
    expect(joined).toContain("## Warcraft - Feature Development System");
    expect(joined).toContain("warcraft_feature_create");
    
    // Auto-loaded skills are now injected via config hook (prompt field), NOT system.transform
    // Verify by checking the agent's prompt field in config
    const opencodeConfig: Record<string, unknown> = { agent: {} };
    await hooks.config!(opencodeConfig);
    
    const agentConfig = (opencodeConfig.agent as Record<string, { prompt?: string }>)["khadgar"];
    expect(agentConfig).toBeDefined();
    expect(agentConfig.prompt).toBeDefined();
    
    const brainstormingSkill = BUILTIN_SKILLS.find((skill) => skill.name === "brainstorming");
    expect(brainstormingSkill).toBeDefined();
    expect(agentConfig.prompt).toContain(brainstormingSkill!.template);
    
    // Status hint injection is conditional on active feature resolution; avoid
    // asserting it in this smoke test.
  });

  runIfHostReady("blocks warcraft_worktree_create when dependencies are not done", async () => {
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext("sess_dependency_block");

    await hooks.tool!.warcraft_feature_create.execute(
      { name: "dep-block-feature" },
      toolContext
    );

    const plan = `# Dep Block Feature

## Discovery

**Q: Is this a test?**
A: Yes, this integration test validates dependency blocking. Testing that task 2 cannot start until task 1 completes, ensuring proper dependency enforcement.

## Overview

Test

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task
Do it

### 2. Second Task

**Depends on**: 1

Do it later
`;

    await hooks.tool!.warcraft_plan_write.execute(
      { content: plan, feature: "dep-block-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_plan_approve.execute(
      { feature: "dep-block-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_tasks_sync.execute(
      { feature: "dep-block-feature" },
      toolContext
    );

    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "dep-block-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    process.env.WARCRAFT_FEATURE = "dep-block-feature";
    const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
      { feature: "dep-block-feature", task: "02-second-task" },
      toolContext
    );

    const execStart = JSON.parse(execStartOutput as string) as {
      success?: boolean;
      error?: string;
    };

    expect(execStart.success).toBe(false);
    expect(execStart.error).toContain("dependencies not done");
  });

  runIfHostReady("auto-loads parallel exploration for planner agents by default", async () => {
    // Test unified mode agents
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);

    const onboardingSnippet = "# Onboarding Preferences";
    const parallelExplorationSkill = BUILTIN_SKILLS.find(
      (skill) => skill.name === "parallel-exploration",
    );
    expect(parallelExplorationSkill).toBeDefined();

    // Skills are now injected via config hook's prompt field, NOT system.transform
    // Default mode is 'unified' which includes khadgar, brann, mekkatorque, algalon
    const opencodeConfig: Record<string, unknown> = { agent: {} };
    await hooks.config!(opencodeConfig);
    const agents = opencodeConfig.agent as Record<string, { prompt?: string }>;

    // khadgar should have parallel-exploration in prompt (unified mode)
    expect(agents["khadgar"]?.prompt).toBeDefined();
    expect(agents["khadgar"]?.prompt).toContain(
      parallelExplorationSkill!.template,
    );
    expect(agents["khadgar"]?.prompt).not.toContain(onboardingSnippet);

    // brann should NOT have parallel-exploration in prompt (unified mode)
    // (removed to prevent recursive delegation - brann cannot spawn brann)
    expect(agents["brann"]?.prompt).toBeDefined();
    expect(agents["brann"]?.prompt).not.toContain(
      parallelExplorationSkill!.template,
    );
    expect(agents["brann"]?.prompt).not.toContain(onboardingSnippet);

    // mekkatorque should NOT have parallel-exploration in prompt
    expect(agents["mekkatorque"]?.prompt).toBeDefined();
    expect(agents["mekkatorque"]?.prompt).not.toContain(
      parallelExplorationSkill!.template,
    );
    expect(agents["mekkatorque"]?.prompt).not.toContain(onboardingSnippet);
  });

  runIfHostReady("includes task prompt mode", async () => {

    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext("sess_task_prompt_mode");

    await hooks.tool!.warcraft_feature_create.execute(
      { name: "prompt-mode-feature" },
      toolContext
    );

    const plan = `# Prompt Mode Feature

## Discovery

**Q: Is this a test?**
A: Yes, this integration test validates task prompt mode functionality. Ensures worker prompts are delivered inline and persisted in the main task bead.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. First Task
Do it
`;
    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "prompt-mode-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    process.env.WARCRAFT_FEATURE = "prompt-mode-feature";
    await hooks.tool!.warcraft_plan_write.execute(
      { content: plan, feature: "prompt-mode-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_plan_approve.execute(
      { feature: "prompt-mode-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_tasks_sync.execute(
      { feature: "prompt-mode-feature" },
      toolContext
    );

    // removed redundant creation
    process.env.WARCRAFT_FEATURE = "prompt-mode-feature";
    const execStartOutput = await hooks.tool!.warcraft_worktree_create.execute(
      { feature: "prompt-mode-feature", task: "01-first-task" },
      toolContext
    );

    const execStart = parseToolResponse<{
      taskPromptMode?: string;
    }>(execStartOutput as string);

    expect(execStart.taskPromptMode).toBe("opencode-inline");
  });

  runIfHostReady("warcraft_batch_execute preview and execute parallel tasks", async () => {
    const ctx: PluginInput = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
      $: createStubShell(),
    };

    const hooks = await plugin(ctx);
    const toolContext = createToolContext("sess_batch_execute");

    await hooks.tool!.warcraft_feature_create.execute(
      { name: "batch-feature" },
      toolContext
    );

    const plan = `# Batch Feature

## Discovery

**Q: Is this a test?**
A: Yes, this test validates batch parallel execution by creating independent tasks that should run together and one dependent task that must stay blocked until both prerequisites are done. It confirms preview classification and execute-mode runnable validation.

## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Tasks

### 1. Task Alpha
**Depends on**: none
Do alpha work

### 2. Task Beta
**Depends on**: none
Do beta work

### 3. Task Gamma
**Depends on**: 1, 2
Do gamma work (depends on alpha and beta)
`;

    await hooks.tool!.warcraft_plan_write.execute(
      { content: plan, feature: "batch-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_plan_approve.execute(
      { feature: "batch-feature" },
      toolContext
    );
    await hooks.tool!.warcraft_tasks_sync.execute(
      { feature: "batch-feature" },
      toolContext
    );

    // Preview mode should show tasks 1 and 2 as runnable, 3 as blocked
    try {
      await hooks.tool!.warcraft_feature_create.execute({ name: "batch-feature" }, toolContext);
    } catch (e) {
      // Ignore if exists
    }
    process.env.WARCRAFT_FEATURE = "batch-feature";
    const previewOutput = await hooks.tool!.warcraft_batch_execute.execute(
      { mode: "preview", feature: "batch-feature" },
      toolContext
    );
    const preview = parseToolResponse<{
      feature: string;
      parallelPolicy?: { strategy: string; maxConcurrency: number };
      summary: { runnable: number; blocked: number };
      runnable: Array<{ folder: string }>;
      blocked?: Array<{ folder: string; waitingOn: string[] }>;
    }>(previewOutput as string);

    expect(preview.feature).toBe("batch-feature");
    expect(preview.summary.runnable).toBe(2);
    expect(preview.summary.blocked).toBe(1);
    expect(preview.parallelPolicy).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
    expect(preview.runnable.map((r) => r.folder)).toContain("01-task-alpha");
    expect(preview.runnable.map((r) => r.folder)).toContain("02-task-beta");
    expect(preview.blocked?.[0]?.folder).toBe("03-task-gamma");

    // Execute mode should dispatch tasks 1 and 2 in parallel
    const executeOutput = await hooks.tool!.warcraft_batch_execute.execute(
      {
        mode: "execute",
        tasks: ["01-task-alpha", "02-task-beta"],
        feature: "batch-feature",
      },
      toolContext
    );
    const result = parseToolResponse<{
      parallelPolicy?: { strategy: string; maxConcurrency: number };
      dispatched: { total: number; succeeded: number; failed: number };
      taskToolCalls: Array<{ subagent_type: string; description: string; prompt: string }>;
      instructions: string;
    }>(executeOutput as string);

    expect(result.dispatched.succeeded).toBe(2);
    expect(result.dispatched.succeeded).toBe(2);
    expect(result.dispatched.failed).toBe(0);
    expect(result.parallelPolicy).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
    expect(result.taskToolCalls).toHaveLength(2);
    expect(result.taskToolCalls[0].subagent_type).toBe("mekkatorque");
    expect(result.taskToolCalls[1].subagent_type).toBe("mekkatorque");
    expect(result.instructions).toContain("Parallel Dispatch Required");

    // Blocked task should fail validation
    const blockedOutput = await hooks.tool!.warcraft_batch_execute.execute(
      {
        mode: "execute",
        tasks: ["03-task-gamma"],
        feature: "batch-feature",
      },
      toolContext
    );
    const blockedResult = JSON.parse(blockedOutput as string) as {
      success: boolean;
      error?: string;
    };

    expect(blockedResult.success).toBe(false);
    expect(blockedResult.error).toContain('03-task-gamma (dependencies not met)');
  });

});
