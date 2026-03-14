import type { Plugin } from '@opencode-ai/plugin';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from 'warcraft-core';
import { createWarcraftContainer } from './container.js';
import { buildCompactionPrompt } from './hooks/compaction-hook.js';
import { createHookCadenceTracker } from './hooks/hook-cadence.js';
import { applySandboxHook } from './hooks/sandbox-hook.js';
import { createVariantHook, isWarcraftAgent } from './hooks/variant-hook.js';
import { applyWarcraftConfig } from './plugin-config.js';
import { createOpencodeLogger } from './utils/opencode-logger.js';

// ============================================================================
// System prompt (static, agent-agnostic)
// ============================================================================

const WARCRAFT_SYSTEM_PROMPT = `
## Warcraft - Feature Development System

Default workflow is plan-first, but tiny low-risk tasks may use an instant workflow: self-contained manual task → execute immediately without a formal plan.

### Tools (20 total)

| Domain | Tools |
|--------|-------|
| Feature | warcraft_feature_create, warcraft_feature_complete |
| Plan | warcraft_plan_write, warcraft_plan_read, warcraft_plan_approve |
| Task | warcraft_tasks_sync, warcraft_task_create, warcraft_task_expand, warcraft_task_update |
| Worktree | warcraft_worktree_create, warcraft_worktree_commit, warcraft_worktree_discard, warcraft_worktree_prune |
| Merge | warcraft_merge |
| Batch | warcraft_batch_execute |
| Context | warcraft_context_write |
| AGENTS.md | warcraft_agents_md |
| Status | warcraft_status |
| Skill | warcraft_skill |
| Diagnostics | warcraft_doctor |

### Workflow

#### Standard / beads-aligned path
1. \`warcraft_feature_create(name)\` - Create feature
2. \`warcraft_plan_write(content)\` - Write plan.md
3. User adds comments in \`plan.md\` → \`warcraft_plan_read\` to see them
4. Revise plan → User approves
5. \`warcraft_tasks_sync()\` - Generate tasks from plan
6. \`warcraft_worktree_create(task)\` → issue returned \`task()\` call → \`warcraft_worktree_commit(task, summary)\`
7. \`warcraft_merge(task)\` - Integrate completed task work (when ready)

#### Instant workflow (tiny, low-risk, already well-scoped)
1. \`warcraft_feature_create(name)\`
2. \`warcraft_task_create({ name, description })\` - Create a self-contained manual task with Background/Impact/Safety/Verify/Rollback notes
3. \`warcraft_worktree_create(task)\` → issue returned \`task()\` call → \`warcraft_worktree_commit(task, summary)\`
4. \`warcraft_merge(task)\`

Use the instant workflow only when a formal plan would be overhead. The task description must be rich enough that future workers/reviewers do not need a missing plan file.

If instant/manual work grows beyond the tiny-task path, use \`warcraft_task_expand()\` or \`warcraft_plan_write({ useScaffold: true })\` to promote the pending manual tasks into a reviewed plan before dispatching more work.

**Important:** \`warcraft_worktree_commit\` finalizes work but does NOT merge.
Use \`warcraft_merge\` to explicitly integrate changes.

### Delegated Execution

\`warcraft_worktree_create\` prepares the workspace and returns the \`task()\` payload needed to launch the worker:

1. \`warcraft_worktree_create(task)\` → Creates/reuses the workspace and returns a Mekkatorque (Worker/Coder) \`task()\` call
2. Issue the returned \`task()\` call
3. Worker executes → calls \`warcraft_worktree_commit(status: "completed")\`
4. Worker blocked → calls \`warcraft_worktree_commit(status: "blocked", blocker: {...})\`

**Handling blocked workers:**
1. Check blockers with \`warcraft_status()\`
2. Read the blocker info (reason, options, recommendation, context)
3. Ask user via \`question()\` tool - NEVER plain text
4. Resume with \`warcraft_worktree_create(task, continueFrom: "blocked", decision: answer)\`
5. Issue the newly returned \`task()\` call to relaunch the worker in the same workspace

**CRITICAL**: When resuming, the returned \`task()\` call launches a NEW worker in the SAME workspace.
The previous worker's progress is preserved. Include the user's decision in the \`decision\` parameter.

**After the returned task() call returns:**
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
Direct manual tasks created with \`warcraft_task_create\` skip plan sync, so their description must carry the missing background/context.

### Execution Phase - Stay Aligned

During execution, call \`warcraft_status\` periodically to (not after context compaction, where state is already preserved):
- Check current progress and pending work
- See context files to read
- Get reminded of next actions
`;

const STATUS_HINT_TTL_MS = 30_000;

// ============================================================================
// Plugin Entry Point — Thin wiring layer
// ============================================================================

const plugin: Plugin = async (ctx) => {
  const { directory, worktree } = ctx;
  const resolvedWorktree = typeof worktree === 'string' && worktree.length > 0 ? worktree : directory;

  const logger = createOpencodeLogger(ctx.client);
  const configService = new ConfigService(logger);
  const configPath = configService.getPath();
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const opencodeConfigCandidatePaths = Array.from(
    new Set([
      path.join(homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(directory, 'opencode.json'),
      path.join(resolvedWorktree, 'opencode.json'),
    ]),
  );
  logger.info('Warcraft plugin initializing config wiring', {
    projectDirectory: directory,
    worktreeDirectory: resolvedWorktree,
    warcraftConfigPath: configPath,
    opencodeConfigCandidatePaths,
    warcraftConfigExists: configService.exists(),
  });

  const container = createWarcraftContainer(directory, configService);
  const hookCadence = createHookCadenceTracker();
  let cachedStatusHint: { hint: string; featureName: string; expiresAt: number } | null = null;

  return {
    'experimental.chat.system.transform': async (
      _input: { agent?: string } | unknown,
      output: { system: string[] },
    ) => {
      // Skip warcraft prompt for non-warcraft agents (e.g. built-in build/plan)
      const inputAgent = (_input as { agent?: string })?.agent;
      if (inputAgent && !isWarcraftAgent(inputAgent)) return;

      // Static system prompt: gated by cadence
      if (hookCadence.shouldExecuteHook('experimental.chat.system.transform', container.configService)) {
        output.system.push(WARCRAFT_SYSTEM_PROMPT);
      }

      // Dynamic status hint: cached with TTL to avoid redundant lookups
      const now = Date.now();
      const activeFeature = container.resolveFeature();
      if (cachedStatusHint && now < cachedStatusHint.expiresAt && activeFeature === cachedStatusHint.featureName) {
        output.system.push(cachedStatusHint.hint);
      } else if (activeFeature) {
        const info = container.featureService.getInfo(activeFeature);
        if (info) {
          let statusHint = `\n### Current Warcraft Status\n`;
          statusHint += `**Active Feature**: ${info.name} (${info.status})\n`;
          statusHint += `**Progress**: ${info.tasks.filter((t) => t.status === 'done').length}/${info.tasks.length} tasks\n`;
          cachedStatusHint = { hint: statusHint, featureName: activeFeature, expiresAt: now + STATUS_HINT_TTL_MS };
          output.system.push(statusHint);
        }
      } else {
        cachedStatusHint = null;
      }
    },

    // Apply per-agent variant to messages (covers built-in task() tool)
    'chat.message': createVariantHook(configService),

    'tool.execute.before': async (input, output) => {
      applySandboxHook(input, output, configService.getSandboxConfig(), directory, configService.getBeadsMode());
    },

    'experimental.session.compacting': async (
      _input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      output.context.push(buildCompactionPrompt());
    },

    mcp: container.builtinMcps,

    tool: {
      warcraft_skill: container.skillTools.createSkillTool(),
      warcraft_feature_create: container.featureTools.createFeatureTool(),
      warcraft_feature_complete: container.featureTools.completeFeatureTool(container.resolveFeature),
      warcraft_plan_write: container.planTools.writePlanTool(container.resolveFeature),
      warcraft_plan_read: container.planTools.readPlanTool(container.resolveFeature),
      warcraft_plan_approve: container.planTools.approvePlanTool(container.resolveFeature),
      warcraft_tasks_sync: container.taskTools.syncTasksTool(container.resolveFeature),
      warcraft_task_create: container.taskTools.createTaskTool(container.resolveFeature),
      warcraft_task_expand: container.taskTools.expandTaskTool(container.resolveFeature),
      warcraft_task_update: container.taskTools.updateTaskTool(container.resolveFeature),
      warcraft_worktree_create: container.worktreeTools.createWorktreeTool(container.resolveFeature),
      warcraft_worktree_commit: container.worktreeTools.commitWorktreeTool(container.resolveFeature),
      warcraft_worktree_discard: container.worktreeTools.discardWorktreeTool(container.resolveFeature),
      warcraft_merge: container.worktreeTools.mergeTaskTool(container.resolveFeature),
      warcraft_worktree_prune: container.worktreeTools.pruneWorktreeTool(container.resolveFeature),
      warcraft_batch_execute: container.batchTools.batchExecuteTool(container.resolveFeature),
      warcraft_context_write: container.contextTools.writeContextTool(container.resolveFeature),
      warcraft_status: container.contextTools.getStatusTool(container.resolveFeature),
      warcraft_agents_md: container.contextTools.agentsMdTool(),
      warcraft_doctor: container.doctorTools.doctorTool(),
    },

    command: {
      warcraft: {
        description: 'Create a new feature: /warcraft <feature-name>',
        async run(args: string) {
          const name = args.trim();
          if (!name) return 'Usage: /warcraft <feature-name>';
          return `Create feature "${name}" using warcraft_feature_create tool.`;
        },
      },
    },

    config: (opencodeConfig: Record<string, unknown>) =>
      applyWarcraftConfig(opencodeConfig, configService, directory, container.builtinMcps, logger),
  };
};

export default plugin;
