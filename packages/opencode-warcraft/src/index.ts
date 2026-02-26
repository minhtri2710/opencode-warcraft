import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { type Plugin } from "@opencode-ai/plugin";
import { getFilteredSkills } from "./skills/builtin.js";
import { loadFileSkill } from "./skills/file-loader.js";
import { BUILTIN_SKILLS } from "./skills/registry.generated.js";
// Warcraft agents (lean, focused)
import { KHADGAR_PROMPT } from "./agents/khadgar.js";
import { MIMIRON_PROMPT } from "./agents/mimiron.js";
import { SAURFANG_PROMPT } from "./agents/saurfang.js";
import { BRANN_PROMPT } from "./agents/brann.js";
import { MEKKATORQUE_PROMPT } from "./agents/mekkatorque.js";
import { ALGALON_PROMPT } from "./agents/algalon.js";
import { createBuiltinMcps } from "./mcp/index.js";
import { BvTriageService } from 'warcraft-core';

// ============================================================================
// Skill Tool - Uses generated registry (no file-based discovery)
// ============================================================================

function shellQuoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

function structuredToCommandString(command: string, args: string[]): string {
  return [command, ...args.map(shellQuoteArg)].join(" ");
}

/**
 * Build auto-loaded skill templates for an agent.
 * Returns a string containing all skill templates to append to the agent's prompt.
 *
 * Resolution order for each skill ID:
 * 1. Builtin skill (wins if exists)
 * 2. File-based skill (project OpenCode -> global OpenCode -> project Claude -> global Claude)
 * 3. Warn and skip if not found
 */
async function buildAutoLoadedSkillsContent(
  agentName:
    | "khadgar"
    | "mimiron"
    | "saurfang"
    | "brann"
    | "mekkatorque"
    | "algalon",
  configService: ConfigService,
  projectRoot: string,
): Promise<string> {
  const agentConfig = configService.getAgentConfig(agentName);
  const autoLoadSkills = agentConfig.autoLoadSkills ?? [];

  if (autoLoadSkills.length === 0) {
    return "";
  }

  // Use process.env.HOME for testability, fallback to os.homedir()
  const homeDir = process.env.HOME || os.homedir();
  const skillTemplates: string[] = [];

  for (const skillId of autoLoadSkills) {
    // 1. Try builtin skill first (builtin wins)
    const builtinSkill = BUILTIN_SKILLS.find((entry) => entry.name === skillId);
    if (builtinSkill) {
      skillTemplates.push(builtinSkill.template);
      continue;
    }

    // 2. Fallback to file-based skill
    const fileResult = await loadFileSkill(skillId, projectRoot, homeDir);
    if (fileResult.found && fileResult.skill) {
      skillTemplates.push(fileResult.skill.template);
      continue;
    }

    // 3. Not found - warn and skip
    console.warn(
      `[warcraft] Unknown skill id "${skillId}" for agent "${agentName}"`,
    );
  }

  if (skillTemplates.length === 0) {
    return "";
  }

  return "\n\n" + skillTemplates.join("\n\n");
}

// ============================================================================
import {
  WorktreeService,
  FeatureService,
  PlanService,
  TaskService,
  ContextService,
  ConfigService,
  AgentsMdService,
  DockerSandboxService,
  BeadsRepository,
  createStores,
  buildEffectiveDependencies,
  detectContext,
  getWarcraftPath,
  getFeaturePath,
  type TaskStatusType,
} from "warcraft-core";
import {
  createVariantHook,
} from "./hooks/variant-hook.js";
import type { BlockedResult, ToolContext } from "./types.js";
import {
  FeatureTools,
  PlanTools,
  TaskTools,
  WorktreeTools,
  BatchTools,
  ContextTools,
  SkillTools,
} from "./tools/index.js";

const WARCRAFT_SYSTEM_PROMPT = `
## Warcraft - Feature Development System

Plan-first development: Write plan → User reviews → Approve → Execute tasks

### Tools (17 total)

| Domain | Tools |
|--------|-------|
| Feature | warcraft_feature_create, warcraft_feature_complete |
| Plan | warcraft_plan_write, warcraft_plan_read, warcraft_plan_approve |
| Task | warcraft_tasks_sync, warcraft_task_create, warcraft_task_update |
| Worktree | warcraft_worktree_create, warcraft_worktree_commit, warcraft_worktree_discard |
| Merge | warcraft_merge |
| Batch | warcraft_batch_execute |
| Context | warcraft_context_write |
| AGENTS.md | warcraft_agents_md |
| Status | warcraft_status |
| Skill | warcraft_skill |

### Workflow

1. \`warcraft_feature_create(name)\` - Create feature
2. \`warcraft_plan_write(content)\` - Write plan.md
3. User adds comments in \`plan.md\` → \`warcraft_plan_read\` to see them
4. Revise plan → User approves
5. \`warcraft_tasks_sync()\` - Generate tasks from plan
6. \`warcraft_worktree_create(task)\` → work in worktree → \`warcraft_worktree_commit(task, summary)\`
7. \`warcraft_merge(task)\` - Merge task branch into main (when ready)

**Important:** \`warcraft_worktree_commit\` commits changes to task branch but does NOT merge.
Use \`warcraft_merge\` to explicitly integrate changes. Worktrees persist until manually removed.

### Delegated Execution

\`warcraft_worktree_create\` creates worktree and spawns worker automatically:

1. \`warcraft_worktree_create(task)\` → Creates worktree + spawns Mekkatorque (Worker/Coder) worker
2. Worker executes → calls \`warcraft_worktree_commit(status: "completed")\`
3. Worker blocked → calls \`warcraft_worktree_commit(status: "blocked", blocker: {...})\`

**Handling blocked workers:**
1. Check blockers with \`warcraft_status()\`
2. Read the blocker info (reason, options, recommendation, context)
3. Ask user via \`question()\` tool - NEVER plain text
4. Resume with \`warcraft_worktree_create(task, continueFrom: "blocked", decision: answer)\`

**CRITICAL**: When resuming, a NEW worker spawns in the SAME worktree.
The previous worker's progress is preserved. Include the user's decision in the \`decision\` parameter.

**After task() Returns:**
- task() is BLOCKING — when it returns, the worker is DONE
- Call \`warcraft_status()\` immediately to check the new task state and find next runnable tasks
- No notifications or polling needed — the result is already available

### Parallel Batch Execution

Use \`warcraft_batch_execute\` to dispatch multiple independent tasks in parallel:

1. \`warcraft_batch_execute({ mode: "preview" })\` — See which tasks are runnable
2. Present runnable tasks to user, ask for confirmation
3. \`warcraft_batch_execute({ mode: "execute", tasks: [...] })\` — Dispatch selected tasks
4. Issue all returned \`task()\` calls in the SAME assistant message for true parallelism
5. After all workers return, call \`warcraft_status()\` and repeat for the next batch

**For research**, use MCP tools or parallel exploration:
- \`grep_app_searchGitHub\` - Find code in OSS
- \`context7_query-docs\` - Library documentation
- \`websearch_web_search_exa\` - Web search via Exa
- \`warcraft_skill("ast-grep")\` - AST-based search workflow and rule authoring
- For exploratory fan-out, load \`warcraft_skill("parallel-exploration")\` and use multiple \`task()\` calls in the same message

### Planning Phase - Context Management REQUIRED

As you research and plan, CONTINUOUSLY save findings using \`warcraft_context_write\`:
- Research findings (API patterns, library docs, codebase structure)
- User preferences ("we use Zustand, not Redux")
- Rejected alternatives ("tried X, too complex")
- Architecture decisions ("auth lives in /lib/auth")

**Update existing context files** when new info emerges - dont create duplicates.

\`warcraft_tasks_sync\` parses \`### N. Task Name\` headers.

### Execution Phase - Stay Aligned

During execution, call \`warcraft_status\` periodically to:
- Check current progress and pending work
- See context files to read
- Get reminded of next actions
`;


const plugin: Plugin = async (ctx) => {
  const { directory } = ctx;

  const configService = new ConfigService(); // User config at ~/.config/opencode/opencode_warcraft.json
  const beadsMode = configService.getBeadsMode();
  const repository = new BeadsRepository(directory, {}, beadsMode);
  const stores = createStores(directory, beadsMode, repository);
  const planService = new PlanService(directory, stores.planStore, beadsMode);
  const taskService = new TaskService(directory, stores.taskStore, beadsMode);
  const featureService = new FeatureService(directory, stores.featureStore, planService, beadsMode, taskService);
  const contextService = new ContextService(directory, configService);
  const agentsMdService = new AgentsMdService(directory, contextService);
  const disabledMcps = configService.getDisabledMcps();
  const disabledSkills = configService.getDisabledSkills();
  const builtinMcps = createBuiltinMcps(disabledMcps);

  // Get filtered skills (globally disabled skills removed)
  // Per-agent skill filtering could be added here based on agent context
  const filteredSkills = getFilteredSkills(disabledSkills);
  const worktreeService = new WorktreeService({
    baseDir: directory,
    warcraftDir: getWarcraftPath(directory, configService.getBeadsMode()),
  });
  const resolveFeature = (explicit?: string): string | null => {
    const listFeaturesSafe = (): string[] => {
      try {
        return featureService.list();
      } catch {
        return [];
      }
    };

    const resolveByIdentity = (identity: string): string | null => {
      // Return identity if it exists OR if we are explicitly asking for it,
      // because during create it might not exist yet but we want to pass it through.
      return identity;
    };

    if (explicit) {
      return resolveByIdentity(explicit);
    }

    const context = detectContext(directory);
    if (context.feature) {
      return resolveByIdentity(context.feature);
    }

    const features = listFeaturesSafe();
    if (features.length === 1) return features[0];

    return null;
  };

  const captureSession = (feature: string, toolContext: unknown) => {
    const ctx = toolContext as ToolContext;
    if (ctx?.sessionID) {
      try {
        const currentSession = featureService.getSession(feature);
        if (currentSession !== ctx.sessionID) {
          featureService.setSession(feature, ctx.sessionID);
        }
      } catch (error) {
        // Ignore if feature not found yet
      }
    }
  };

  const updateFeatureMetadata = (
    feature: string,
    patch: {
      workflowPath?: 'standard' | 'lightweight';
      reviewChecklistVersion?: 'v1';
      reviewChecklistCompletedAt?: string;
    },
  ): void => {
    try {
      const exists = featureService.get(feature);
      if (exists) {
        featureService.patchMetadata(feature, patch);
      }
    } catch (error) {
      // Ignore
    }
  };

  /**
   * Check if a feature is blocked by the Beekeeper.
   * Returns the block message if blocked, null otherwise.
   *
   * File protocol: .beads/artifacts/<name>/BLOCKED
   * - If file exists, feature is blocked
   * - File contents = reason for blocking
   */
  const checkBlocked = (feature: string): BlockedResult => {
    const blockedPath = path.join(
      getFeaturePath(directory, feature, configService.getBeadsMode()),
      'BLOCKED',
    );
    try {
      const reason = fs.readFileSync(blockedPath, "utf-8").trim();
      const message = `⛔ BLOCKED by Commander

${reason || "(No reason provided)"}

The human has blocked this feature. Wait for them to unblock it.
To unblock: Remove ${blockedPath}`;
      return { blocked: true, reason, message, blockedPath };
    } catch {
      return { blocked: false };
    }
  };

  // Initialize BV Triage Service with explicit state ownership
  const bvTriageService = new BvTriageService(
    directory,
    configService.getBeadsMode() !== 'off',
  );
  const parallelExecution = (configService.get() as {
    parallelExecution?: { strategy?: 'unbounded' | 'bounded'; maxConcurrency?: number };
  }).parallelExecution;

  const checkDependencies = (
    feature: string,
    taskFolder: string,
  ): { allowed: boolean; error?: string } => {
    const taskStatus = taskService.getRawStatus(feature, taskFolder);
    if (!taskStatus) {
      return { allowed: true };
    }

    const tasks = taskService.list(feature).map((task) => {
      const status = taskService.getRawStatus(feature, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: status?.dependsOn,
      };
    });

    const effectiveDeps = buildEffectiveDependencies(tasks);
    const deps = effectiveDeps.get(taskFolder) ?? [];

    if (deps.length === 0) {
      return { allowed: true };
    }

    const unmetDeps: Array<{ folder: string; status: string }> = [];

    for (const depFolder of deps) {
      const depStatus = taskService.getRawStatus(feature, depFolder);

      if (!depStatus || depStatus.status !== "done") {
        unmetDeps.push({
          folder: depFolder,
          status: depStatus?.status ?? "unknown",
        });
      }
    }

    if (unmetDeps.length > 0) {
      const depList = unmetDeps
        .map((d) => `"${d.folder}" (${d.status})`)
        .join(", ");
      const triage = taskStatus.beadId
        ? bvTriageService.getBlockerTriage(taskStatus.beadId)
        : null;
      const bvHealth = bvTriageService.getHealth();
      const triageHint = triage
        ? ` Beads triage (bv): ${triage.summary}`
        : bvHealth.lastError
          ? ` Beads triage (bv unavailable): ${bvHealth.lastError}`
          : "";

      return {
        allowed: false,
        error:
          `Dependency constraint: Task "${taskFolder}" cannot start - dependencies not done: ${depList}. ` +
          `Only tasks with status 'done' satisfy dependencies.${triageHint}`,
      };
    }

    return { allowed: true };
  };

  const VALID_TASK_STATUSES = new Set<string>([
    'pending', 'in_progress', 'done', 'cancelled', 'blocked', 'failed', 'partial',
  ]);

  const validateTaskStatus = (status: string): TaskStatusType => {
    if (!VALID_TASK_STATUSES.has(status)) {
      throw new Error(`Invalid task status: "${status}". Valid values: ${Array.from(VALID_TASK_STATUSES).join(', ')}`);
    }
    return status as TaskStatusType;
  };

  const COMPLETION_GATES = ['build', 'test', 'lint'] as const;
  const WORKFLOW_GATES_MODE =
    (process.env.WARCRAFT_WORKFLOW_GATES_MODE || 'warn').toLowerCase() ===
      'enforce'
      ? 'enforce'
      : 'warn';
  const COMPLETION_PASS_SIGNAL =
    /\b(exit(?:\s+code)?\s*0|pass(?:ed|es)?|success(?:ful|fully)?|succeed(?:ed|s)?|ok)\b/i;

  const hasCompletionGateEvidence = (
    summary: string,
    gate: (typeof COMPLETION_GATES)[number],
  ): boolean => {
    const lines = summary
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.some(
      (line) => line.toLowerCase().includes(gate) && COMPLETION_PASS_SIGNAL.test(line),
    );
  };

  const isPathInside = (candidatePath: string, parentPath: string): boolean => {
    const absoluteCandidate = path.resolve(candidatePath);
    const absoluteParent = path.resolve(parentPath);
    const relative = path.relative(absoluteParent, absoluteCandidate);

    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };

  // Instantiate domain tool modules with explicit dependencies
  const featureTools = new FeatureTools({ featureService });
  const planTools = new PlanTools({
    featureService,
    planService,
    captureSession,
    updateFeatureMetadata,
    workflowGatesMode: WORKFLOW_GATES_MODE,
  });
  const taskTools = new TaskTools({
    featureService,
    planService,
    taskService,
    workflowGatesMode: WORKFLOW_GATES_MODE,
    validateTaskStatus,
  });
  const worktreeTools = new WorktreeTools({
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    validateTaskStatus,
    checkBlocked,
    checkDependencies,
    hasCompletionGateEvidence,
    completionGates: COMPLETION_GATES,
  });
  const batchTools = new BatchTools({
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    checkBlocked,
    checkDependencies,
    parallelExecution,
  });
  const contextTools = new ContextTools({
    featureService,
    planService,
    taskService,
    contextService,
    agentsMdService,
    worktreeService,
    checkBlocked,
    bvTriageService,
  });
  const skillTools = new SkillTools({ filteredSkills });

  return {
    "experimental.chat.system.transform": async (
      _input: { agent?: string } | unknown,
      output: { system: string[] },
    ) => {
      output.system.push(WARCRAFT_SYSTEM_PROMPT);

      // NOTE: autoLoadSkills injection is now done in the config hook (prompt field)
      // to ensure skills are present from the first message. The system.transform hook
      // may not receive the agent name at runtime, so we removed current auto-load here.

      const activeFeature = resolveFeature();
      if (activeFeature) {
        const info = featureService.getInfo(activeFeature);
        if (info) {
          let statusHint = `\n### Current Warcraft Status\n`;
          statusHint += `**Active Feature**: ${info.name} (${info.status})\n`;
          statusHint += `**Progress**: ${info.tasks.filter((t) => t.status === "done").length}/${info.tasks.length} tasks\n`;

          if (info.commentCount > 0) {
            statusHint += `**Comments**: ${info.commentCount} unresolved - address with warcraft_plan_read\n`;
          }

          output.system.push(statusHint);
        }
      }
    },

    // Apply per-agent variant to messages (covers built-in task() tool)
    "chat.message": createVariantHook(configService),

    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return;

      const sandboxConfig = configService.getSandboxConfig();
      if (sandboxConfig.mode === "none") return;

      const command = output.args?.command?.trim();
      if (!command) return;

      // Escape hatch: HOST: prefix (case-insensitive)
      if (/^HOST:\s*/i.test(command)) {
        const strippedCommand = command.replace(/^HOST:\s*/i, "");
        console.warn(
          `[warcraft:sandbox] HOST bypass: ${strippedCommand.slice(0, 80)}${strippedCommand.length > 80 ? "..." : ""}`,
        );
        output.args.command = strippedCommand;
        return;
      }

      // Only wrap commands with explicit workdir inside warcraft worktrees
      const workdir = output.args?.workdir;
      if (!workdir) return;

      const warcraftWorktreeBase = path.join(
        getWarcraftPath(directory, configService.getBeadsMode()),
        '.worktrees',
      );
      if (!isPathInside(workdir, warcraftWorktreeBase)) return;

      // Wrap command using static method (with persistent config)
      const wrapped = DockerSandboxService.wrapCommand(
        workdir,
        command,
        sandboxConfig,
      );
      output.args.command = typeof wrapped === "string"
        ? wrapped
        : structuredToCommandString(wrapped.command, wrapped.args);
      output.args.workdir = undefined; // docker command runs on host
    },

    mcp: builtinMcps,

    // ============================================================================
    // Tool Definitions
    // Domain-specific tools are now in src/tools/{feature,plan,task,worktree,context,skill}-tools.ts
    // ============================================================================
    tool: {
      warcraft_skill: skillTools.createSkillTool(),

      warcraft_feature_create: featureTools.createFeatureTool(),

      warcraft_feature_complete: featureTools.completeFeatureTool(resolveFeature),

      warcraft_plan_write: planTools.writePlanTool(resolveFeature),

      warcraft_plan_read: planTools.readPlanTool(resolveFeature),

      warcraft_plan_approve: planTools.approvePlanTool(resolveFeature),

      warcraft_tasks_sync: taskTools.syncTasksTool(resolveFeature),

      warcraft_task_create: taskTools.createTaskTool(resolveFeature),

      warcraft_task_update: taskTools.updateTaskTool(resolveFeature),

      warcraft_worktree_create: worktreeTools.createWorktreeTool(resolveFeature),

      warcraft_worktree_commit: worktreeTools.commitWorktreeTool(resolveFeature),

      warcraft_worktree_discard: worktreeTools.discardWorktreeTool(resolveFeature),

      warcraft_merge: worktreeTools.mergeTaskTool(resolveFeature),

      warcraft_batch_execute: batchTools.batchExecuteTool(resolveFeature),

      warcraft_context_write: contextTools.writeContextTool(resolveFeature),

      warcraft_status: contextTools.getStatusTool(resolveFeature),

      warcraft_agents_md: contextTools.agentsMdTool(),
    },

    command: {
      warcraft: {
        description: "Create a new feature: /warcraft <feature-name>",
        async run(args: string) {
          const name = args.trim();
          if (!name) return "Usage: /warcraft <feature-name>";
          return `Create feature "${name}" using warcraft_feature_create tool.`;
        },
      },
    },

    // Config hook - merge agents into opencodeConfig.agent
    config: async (opencodeConfig: Record<string, unknown>) => {
      // Auto-generate config file with defaults if it doesn't exist
      configService.init();

      // Build auto-loaded skill content for each agent
      type AgentName = 'khadgar' | 'mimiron' | 'saurfang' | 'brann' | 'mekkatorque' | 'algalon';
      interface AgentSpec {
        name: AgentName;
        prompt: string;
        description: string;
        temperature: number;
        mode?: 'subagent';
        permission: Record<string, string>;
      }

      async function buildAgentConfig(spec: AgentSpec) {
        const userConfig = configService.getAgentConfig(spec.name);
        const autoLoadedSkills = await buildAutoLoadedSkillsContent(spec.name, configService, directory);
        return {
          model: userConfig.model,
          variant: userConfig.variant,
          temperature: userConfig.temperature ?? spec.temperature,
          ...(spec.mode ? { mode: spec.mode } : {}),
          description: spec.description,
          prompt: spec.prompt + autoLoadedSkills,
          permission: spec.permission,
        };
      }

      const [
        khadgarConfig,
        mimironConfig,
        saurfangConfig,
        brannConfig,
        mekkatorqueConfig,
        algalonConfig,
      ] = await Promise.all([
        buildAgentConfig({
          name: 'khadgar',
          prompt: KHADGAR_PROMPT,
          description: 'Khadgar (Hybrid) - Plans + orchestrates. Detects phase, loads skills on-demand.',
          temperature: 0.5,
          permission: { question: 'allow', skill: 'allow', todowrite: 'allow', todoread: 'allow' },
        }),
        buildAgentConfig({
          name: 'mimiron',
          prompt: MIMIRON_PROMPT,
          description: 'Mimiron (Planner) - Plans features, interviews, writes plans. NEVER executes.',
          temperature: 0.7,
          permission: { edit: 'deny', task: 'allow', question: 'allow', skill: 'allow', todowrite: 'allow', todoread: 'allow', webfetch: 'allow' },
        }),
        buildAgentConfig({
          name: 'saurfang',
          prompt: SAURFANG_PROMPT,
          description: 'Saurfang (Orchestrator) - Orchestrates execution. Delegates, spawns workers, verifies, merges.',
          temperature: 0.5,
          permission: { question: 'allow', skill: 'allow', todowrite: 'allow', todoread: 'allow' },
        }),
        buildAgentConfig({
          name: 'brann',
          prompt: BRANN_PROMPT,
          description: 'Brann (Explorer/Researcher/Retrieval) - Researches codebase + external docs/data.',
          temperature: 0.5,
          mode: 'subagent',
          permission: { edit: 'deny', task: 'deny', delegate: 'deny', skill: 'allow', webfetch: 'allow' },
        }),
        buildAgentConfig({
          name: 'mekkatorque',
          prompt: MEKKATORQUE_PROMPT,
          description: 'Mekkatorque (Worker/Coder) - Executes tasks directly in isolated worktrees. Never delegates.',
          temperature: 0.3,
          mode: 'subagent',
          permission: { task: 'deny', delegate: 'deny', skill: 'allow' },
        }),
        buildAgentConfig({
          name: 'algalon',
          prompt: ALGALON_PROMPT,
          description: 'Algalon (Consultant/Reviewer/Debugger) - Reviews plan documentation quality. OKAY/REJECT verdict.',
          temperature: 0.3,
          mode: 'subagent',
          permission: { edit: 'deny', task: 'deny', delegate: 'deny', skill: 'allow' },
        }),
      ]);

      // Build agents map based on agentMode
      const warcraftConfigData = configService.get();
      const agentMode = warcraftConfigData.agentMode ?? "unified";

      const allAgents: Record<string, unknown> = {};

      if (agentMode === "unified") {
        allAgents["khadgar"] = khadgarConfig;
        allAgents["brann"] = brannConfig;
        allAgents["mekkatorque"] = mekkatorqueConfig;
        allAgents["algalon"] = algalonConfig;
      } else {
        allAgents["mimiron"] = mimironConfig;
        allAgents["saurfang"] = saurfangConfig;
        allAgents["brann"] = brannConfig;
        allAgents["mekkatorque"] = mekkatorqueConfig;
        allAgents["algalon"] = algalonConfig;
      }

      // Merge agents into opencodeConfig.agent (config hook is sufficient for agent discovery)
      const configAgent = opencodeConfig.agent as
        | Record<string, unknown>
        | undefined;
      if (!configAgent) {
        opencodeConfig.agent = allAgents;
      } else {
        Object.assign(configAgent, allAgents);
      }

      // Set default agent based on mode
      (opencodeConfig as Record<string, unknown>).default_agent =
        agentMode === "unified" ? "khadgar" : "mimiron";

      // Merge built-in MCP servers (OMO-style remote endpoints)
      const configMcp = opencodeConfig.mcp as
        | Record<string, unknown>
        | undefined;
      if (!configMcp) {
        opencodeConfig.mcp = builtinMcps;
      } else {
        Object.assign(configMcp, builtinMcps);
      }
    },
  };
};

export default plugin;
