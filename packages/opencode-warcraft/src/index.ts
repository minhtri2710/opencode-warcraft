import type { Plugin } from '@opencode-ai/plugin';
import * as path from 'path';
import { ConfigService, DockerSandboxService, getWarcraftPath } from 'warcraft-core';
import { createWarcraftContainer } from './container.js';
import { isPathInside } from './guards.js';
import { createVariantHook, isWarcraftAgent } from './hooks/variant-hook.js';
import { applyWarcraftConfig } from './plugin-config.js';

// ============================================================================
// Shell quoting helpers (used by sandbox hook)
// ============================================================================

function shellQuoteArg(arg: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

function structuredToCommandString(command: string, args: string[]): string {
  return [command, ...args.map(shellQuoteArg)].join(' ');
}

// ============================================================================
// System prompt (static, agent-agnostic)
// ============================================================================

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

// ============================================================================
// Plugin Entry Point — Thin wiring layer
// ============================================================================

const plugin: Plugin = async (ctx) => {
  const { directory } = ctx;

  const configService = new ConfigService();
  const container = createWarcraftContainer(directory, configService);

  return {
    'experimental.chat.system.transform': async (
      _input: { agent?: string } | unknown,
      output: { system: string[] },
    ) => {
      // Skip warcraft prompt for non-warcraft agents (e.g. built-in build/plan)
      const inputAgent = (_input as { agent?: string })?.agent;
      if (inputAgent && !isWarcraftAgent(inputAgent)) return;

      output.system.push(WARCRAFT_SYSTEM_PROMPT);

      const activeFeature = container.resolveFeature();
      if (activeFeature) {
        const info = container.featureService.getInfo(activeFeature);
        if (info) {
          let statusHint = `\n### Current Warcraft Status\n`;
          statusHint += `**Active Feature**: ${info.name} (${info.status})\n`;
          statusHint += `**Progress**: ${info.tasks.filter((t) => t.status === 'done').length}/${info.tasks.length} tasks\n`;

          if (info.commentCount > 0) {
            statusHint += `**Comments**: ${info.commentCount} unresolved - address with warcraft_plan_read\n`;
          }

          output.system.push(statusHint);
        }
      }
    },

    // Apply per-agent variant to messages (covers built-in task() tool)
    'chat.message': createVariantHook(configService),

    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash') return;

      const sandboxConfig = configService.getSandboxConfig();
      if (sandboxConfig.mode === 'none') return;

      const command = output.args?.command?.trim();
      if (!command) return;

      const workdir = output.args?.workdir;
      if (!workdir) return;

      const warcraftWorktreeBase = path.join(getWarcraftPath(directory, configService.getBeadsMode()), '.worktrees');
      if (!isPathInside(workdir, warcraftWorktreeBase)) return;

      const wrapped = DockerSandboxService.wrapCommand(workdir, command, sandboxConfig);
      output.args.command =
        typeof wrapped === 'string' ? wrapped : structuredToCommandString(wrapped.command, wrapped.args);
      output.args.workdir = undefined;
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
      warcraft_task_update: container.taskTools.updateTaskTool(container.resolveFeature),
      warcraft_worktree_create: container.worktreeTools.createWorktreeTool(container.resolveFeature),
      warcraft_worktree_commit: container.worktreeTools.commitWorktreeTool(container.resolveFeature),
      warcraft_worktree_discard: container.worktreeTools.discardWorktreeTool(container.resolveFeature),
      warcraft_merge: container.worktreeTools.mergeTaskTool(container.resolveFeature),
      warcraft_batch_execute: container.batchTools.batchExecuteTool(container.resolveFeature),
      warcraft_context_write: container.contextTools.writeContextTool(container.resolveFeature),
      warcraft_status: container.contextTools.getStatusTool(container.resolveFeature),
      warcraft_agents_md: container.contextTools.agentsMdTool(),
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
      applyWarcraftConfig(opencodeConfig, configService, directory, container.builtinMcps),
  };
};

export default plugin;
