import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type {
  FeatureService,
  PlanService,
  TaskService,
  WorktreeService,
  TaskStatusType,
} from 'warcraft-core';
import { validatePathSegment } from './index.js';
import type { ContextFile, CompletedTask } from '../utils/worker-prompt.js';
import {
  calculatePromptMeta,
  calculatePayloadMeta,
  checkWarnings,
} from '../utils/prompt-observability.js';
import {
  applyTaskBudget,
  applyContextBudget,
  DEFAULT_BUDGET,
  type TruncationEvent,
} from '../utils/prompt-budgeting.js';
import { buildWorkerPrompt } from '../utils/worker-prompt.js';
import { formatSpecContent } from '../services/spec-content-builder.js';

export interface WorktreeToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  contextService: {
    list: (feature: string) => Array<{ name: string; content: string }>;
  };
  validateTaskStatus: (status: string) => TaskStatusType;
  checkBlocked: (feature: string) => string | null;
  checkDependencies: (
    feature: string,
    taskFolder: string,
  ) => { allowed: boolean; error?: string };
  hasCompletionGateEvidence: (summary: string, gate: string) => boolean;
  completionGates: readonly string[];
}

/**
 * Worktree domain tools - Create worktrees, commit, discard, merge
 */
export class WorktreeTools {
  constructor(private readonly deps: WorktreeToolsDependencies) {}

  /**
   * Create worktree and begin work on task. Spawns Mekkatorque worker automatically.
   */
  createWorktreeTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { checkBlocked, checkDependencies, taskService, planService, contextService, worktreeService } = this.deps;
    return tool({
      description:
        'Create worktree and begin work on task. Spawns Mekkatorque worker automatically.',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
        continueFrom: tool.schema
          .enum(['blocked'])
          .optional()
          .describe('Resume a blocked task'),
        decision: tool.schema
          .string()
          .optional()
          .describe('Answer to blocker question when continuing'),
      },
      async execute(
        { task, feature: explicitFeature, continueFrom, decision },
        toolContext,
      ) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        validatePathSegment(task, 'task');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return JSON.stringify({ error: 'No feature specified. Create a feature or provide feature param.' });

        const blockedMessage = checkBlocked(feature);
        if (blockedMessage) {
          // If blockedMessage is already a JSON string, return it as-is
          try {
            JSON.parse(blockedMessage);
            return blockedMessage;
          } catch {
            return JSON.stringify({ error: blockedMessage });
          }
        }

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return JSON.stringify({ error: `Task "${task}" not found` });

        // Allow continuing blocked tasks, but not completed ones
        if (taskInfo.status === 'done')
          return JSON.stringify({ error: 'Task already completed' });
        if (continueFrom === 'blocked' && taskInfo.status !== 'blocked') {
          return JSON.stringify({ error: 'Task is not in blocked state. Use without continueFrom.' });
        }

        if (continueFrom !== 'blocked') {
          const depCheck = checkDependencies(feature, task);
          if (!depCheck.allowed) {
            return JSON.stringify({
              success: false,
              error: depCheck.error,
              hints: [
                'Complete the required dependencies before starting this task.',
                'Use warcraft_status to see current task states.',
              ],
            });
          }
        }

        // Check if we're continuing from blocked - reuse existing worktree
        let worktree: Awaited<ReturnType<typeof worktreeService.create>>;
        if (continueFrom === 'blocked') {
          worktree = await worktreeService.get(feature, task);
          if (!worktree) return JSON.stringify({ error: 'No worktree found for blocked task' });
        } else {
          worktree = await worktreeService.create(feature, task);
        }

        const updatePayload: Record<string, unknown> = { status: 'in_progress' };
        if (continueFrom !== 'blocked') {
          updatePayload.baseCommit = worktree.commit;
        }
        taskService.update(feature, task, updatePayload);

        // Generate spec.md with context for task
        const planResult = planService.read(feature);
        const allTasks = taskService.list(feature);

        const rawContextFiles = contextService.list(feature).map((f: { name: string; content: string }) => ({
          name: f.name,
          content: f.content,
        }));

        const rawPreviousTasks = allTasks
          .filter((t: { status: string; summary?: string }) => t.status === 'done' && t.summary)
          .map((t: { folder: string; summary?: string }) => ({ name: t.folder, summary: t.summary! }));

        const taskBudgetResult = applyTaskBudget(rawPreviousTasks, {
          ...DEFAULT_BUDGET,
          feature,
        });

        const contextBudgetResult = applyContextBudget(rawContextFiles, {
          ...DEFAULT_BUDGET,
          feature,
        });

        const contextFiles: ContextFile[] = contextBudgetResult.files.map(
          (f: { name: string; content: string }) => ({
            name: f.name,
            content: f.content,
          }),
        );
        const previousTasks: CompletedTask[] = taskBudgetResult.tasks.map(
          (t: { name: string; summary: string }) => ({
            name: t.name,
            summary: t.summary,
          }),
        );

        const truncationEvents: TruncationEvent[] = [
          ...taskBudgetResult.truncationEvents,
          ...contextBudgetResult.truncationEvents,
        ];

        const droppedTasksHint = taskBudgetResult.droppedTasksHint;

        const taskOrder = parseInt(
          taskInfo.folder.match(/^(\d+)/)?.[1] || '0',
          10,
        );
        const status = taskService.getRawStatus(feature, task);
        const dependsOn = status?.dependsOn ?? [];
        
        // Build structured spec data in core, then format in plugin layer
        const specData = taskService.buildSpecData({
          featureName: feature,
          task: {
            folder: task,
            name: taskInfo.planTitle ?? taskInfo.name,
            order: taskOrder,
          },
          dependsOn,
          allTasks: allTasks.map((t: { folder: string; name: string }) => ({
            folder: t.folder,
            name: t.name,
            order: parseInt(t.folder.match(/^(\d+)/)?.[1] || '0', 10),
          })),
          planContent: planResult?.content ?? null,
          contextFiles,
          completedTasks: previousTasks,
        });
        const specContent = formatSpecContent(specData);

        const taskBeadId = taskService.writeSpec(feature, task, specContent);

        const workerPrompt = buildWorkerPrompt({
          feature,
          task,
          taskOrder: parseInt(
            taskInfo.folder.match(/^(\d+)/)?.[1] || '0',
            10,
          ),
          worktreePath: worktree.path,
          branch: worktree.branch,
          plan: planResult?.content || 'No plan available',
          contextFiles,
          spec: specContent,
          previousTasks,
          continueFrom:
            continueFrom === 'blocked'
              ? {
                  status: 'blocked',
                  previousSummary:
                    taskInfo.summary || 'No previous summary',
                  decision: decision || 'No decision provided',
                }
              : undefined,
        });

        const agent = 'mekkatorque';

        const rawStatus = taskService.getRawStatus(feature, task);
        const attempt = (rawStatus?.workerSession?.attempt || 0) + 1;
        const idempotencyKey = `warcraft-${feature}-${task}-${attempt}`;

        taskService.patchBackgroundFields(feature, task, { idempotencyKey });

        const contextContent = contextFiles
          .map((f) => f.content)
          .join('\n\n');
        const previousTasksContent = previousTasks
          .map((t) => `- **${t.name}**: ${t.summary}`)
          .join('\n');
        const promptMeta = calculatePromptMeta({
          plan: planResult?.content || '',
          context: contextContent,
          previousTasks: previousTasksContent,
          spec: specContent,
          workerPrompt,
        });

        taskService.writeWorkerPrompt(feature, task, workerPrompt);

        const persistedWorkerPrompt = taskService.readTaskBeadArtifact(
          feature,
          task,
          'worker_prompt',
        );
        if (!persistedWorkerPrompt || persistedWorkerPrompt.trim().length === 0) {
          return JSON.stringify({
            error: `Failed to load worker prompt from task bead '${taskBeadId}' for task '${task}'`,
            taskBeadId,
            task,
          });
        }

        const PREVIEW_MAX_LENGTH = 200;
        const workerPromptPreview =
          workerPrompt.length > PREVIEW_MAX_LENGTH
            ? workerPrompt.slice(0, PREVIEW_MAX_LENGTH) + '...'
            : workerPrompt;

        const taskToolPrompt = persistedWorkerPrompt;

        const taskToolInstructions = `## Delegation Required

Use OpenCode's built-in \`task\` tool to spawn a Mekkatorque (Worker/Coder) worker.

\`\`\`
task({
  subagent_type: "${agent}",
  description: "Warcraft: ${task}",
  prompt: "${taskToolPrompt}"
})
\`\`\`

The worker prompt is passed inline in \`taskToolCall.prompt\`.

`;

        const responseBase = {
          worktreePath: worktree.path,
          branch: worktree.branch,
          mode: 'delegate',
          agent,
          delegationRequired: true,
          workerPromptPreview,
          taskPromptMode: 'opencode-inline',
          taskToolCall: {
            subagent_type: agent,
            description: `Warcraft: ${task}`,
            prompt: taskToolPrompt,
          },
          instructions: taskToolInstructions,
          taskSpec: specContent,
        };

        const jsonPayload = JSON.stringify(responseBase, null, 2);
        const payloadMeta = calculatePayloadMeta({
          jsonPayload,
          promptInlined: true,
          promptReferencedByFile: false,
        });

        const sizeWarnings = checkWarnings(promptMeta, payloadMeta);

        const budgetWarnings = truncationEvents.map((event) => ({
          type: event.type as string,
          severity: 'info' as const,
          message: event.message,
          affected: event.affected,
          count: event.count,
        }));

        const allWarnings = [...sizeWarnings, ...budgetWarnings];

        return JSON.stringify(
          {
            ...responseBase,
            promptMeta,
            payloadMeta,
            budgetApplied: {
              maxTasks: DEFAULT_BUDGET.maxTasks,
              maxSummaryChars: DEFAULT_BUDGET.maxSummaryChars,
              maxContextChars: DEFAULT_BUDGET.maxContextChars,
              maxTotalContextChars: DEFAULT_BUDGET.maxTotalContextChars,
              tasksIncluded: previousTasks.length,
              tasksDropped: rawPreviousTasks.length - previousTasks.length,
              droppedTasksHint,
            },
            warnings: allWarnings.length > 0 ? allWarnings : undefined,
          },
          null,
          2,
        );
      },
    });
  }

  /**
   * Complete task: commit changes to branch, write report. Supports blocked/failed/partial status for worker communication.
   */
  commitWorktreeTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, worktreeService, featureService, validateTaskStatus, hasCompletionGateEvidence, completionGates } = this.deps;
    return tool({
      description:
        'Complete task: commit changes to branch, write report. Supports blocked/failed/partial status for worker communication.',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        summary: tool.schema.string().describe('Summary of what was done'),
        status: tool.schema
          .enum(['completed', 'blocked', 'failed', 'partial'])
          .optional()
          .default('completed')
          .describe('Task completion status'),
        blocker: tool.schema
          .object({
            reason: tool.schema.string().describe('Why the task is blocked'),
            options: tool.schema
              .array(tool.schema.string())
              .optional()
              .describe('Available options for the user'),
            recommendation: tool.schema
              .string()
              .optional()
              .describe('Your recommended choice'),
            context: tool.schema
              .string()
              .optional()
              .describe('Additional context for the decision'),
          })
          .optional()
          .describe('Blocker info when status is blocked'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({
        task,
        summary,
        status = 'completed',
        blocker,
        feature: explicitFeature,
      }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        validatePathSegment(task, 'task');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return `Error: Task "${task}" not found`;
        if (
          taskInfo.status !== 'in_progress' &&
          taskInfo.status !== 'blocked'
        )
          return 'Error: Task not in progress';

        // GATE: Check for explicit build/test/lint pass evidence when completing
        if (status === 'completed') {
          const missingGates = completionGates.filter(
            (gate: string) => !hasCompletionGateEvidence(summary, gate),
          );

          if (missingGates.length > 0) {
            return `BLOCKED: Missing explicit verification evidence for ${missingGates.join(', ')}.

Before claiming completion, you must:
1. Run build, test, and lint gates
2. Include one pass signal per gate in summary (for example: "build: exit 0")
3. Ensure each gate appears on its own line for machine parsing

Example summary:
- build: bun run build (exit 0)
- test: bun run test (exit 0)
- lint: bun run lint (exit 0)

Re-run with updated summary showing verification results.`;
          }
        }

        if (status === 'blocked') {
          taskService.update(feature, task, {
            status: 'blocked',
            summary,
            blocker,
          });

          const worktree = await worktreeService.get(feature, task);
          return JSON.stringify(
            {
              status: 'blocked',
              task,
              summary,
              blocker,
              worktreePath: worktree?.path,
              message:
                'Task blocked. Warcraft Master will ask user and resume with warcraft_worktree_create(continueFrom: "blocked", decision: answer)',
            },
            null,
            2,
          );
        }

        const commitResult = await worktreeService.commitChanges(
          feature,
          task,
          `warcraft(${task}): ${summary.slice(0, 50)}`,
        );

        const diff = await worktreeService.getDiff(feature, task);
        const featureMeta = featureService.get(feature);
        const workflowPath =
          (featureMeta as { workflowPath?: string } | null)?.workflowPath ||
          'standard';

        const statusLabel = status === 'completed' ? 'success' : status;
        const reportLines: string[] = [
          `# Task Report: ${task}`,
          '',
          `**Feature:** ${feature}`,
          `**Workflow Path:** ${workflowPath}`,
          `**Completed:** ${new Date().toISOString()}`,
          `**Status:** ${statusLabel}`,
          `**Commit:** ${commitResult.sha || 'none'}`,
          '',
          '---',
          '',
          '## Summary',
          '',
          summary,
          '',
        ];

        if (diff?.hasDiff) {
          reportLines.push(
            '---',
            '',
            '## Changes',
            '',
            `- **Files changed:** ${diff.filesChanged.length}`,
            `- **Insertions:** +${diff.insertions}`,
            `- **Deletions:** -${diff.deletions}`,
            '',
          );

          if (diff.filesChanged.length > 0) {
            reportLines.push('### Files Modified', '');
            for (const file of diff.filesChanged as string[]) {
              reportLines.push(`- \`${file}\``);
            }
            reportLines.push('');
          }
        } else {
          reportLines.push(
            '---',
            '',
            '## Changes',
            '',
            '_No file changes detected_',
            '',
          );
        }

        taskService.writeReport(feature, task, reportLines.join('\n'));

        if (status === 'completed' && !commitResult.committed) {
          return `Error: Cannot mark task "${task}" completed because no commit was created (${commitResult.message}). Task status unchanged.`;
        }

        const finalStatus = status === 'completed' ? 'done' : status;
        taskService.update(feature, task, {
          status: validateTaskStatus(finalStatus),
          summary,
        });

        const worktree = await worktreeService.get(feature, task);
        return `Task "${task}" ${status}. Changes committed to branch ${worktree?.branch || 'unknown'}.\nUse warcraft_merge to integrate changes. Worktree preserved at ${worktree?.path || 'unknown'}.`;
      },
    });
  }

  /**
   * Abort task: discard changes, reset status
   */
  discardWorktreeTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, worktreeService } = this.deps;
    return tool({
      description: 'Abort task: discard changes, reset status',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ task, feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        validatePathSegment(task, 'task');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';

        await worktreeService.remove(feature, task);
        taskService.update(feature, task, { status: 'pending' });

        return `Task "${task}" aborted. Status reset to pending.`;
      },
    });
  }

  /**
   * Merge completed task branch into current branch (explicit integration)
   */
  mergeTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, worktreeService } = this.deps;
    return tool({
      description:
        'Merge completed task branch into current branch (explicit integration)',
      args: {
        task: tool.schema.string().describe('Task folder name to merge'),
        strategy: tool.schema
          .enum(['merge', 'squash', 'rebase'])
          .optional()
          .describe('Merge strategy (default: merge)'),
        feature: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to active)'),
      },
      async execute({ task, strategy = 'merge', feature: explicitFeature }) {
        if (explicitFeature) validatePathSegment(explicitFeature, 'feature');
        validatePathSegment(task, 'task');
        const feature = resolveFeature(explicitFeature);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide feature param.';

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return `Error: Task "${task}" not found`;
        if (taskInfo.status !== 'done')
          return 'Error: Task must be completed before merging. Use warcraft_worktree_commit first.';

        const result = await worktreeService.merge(feature, task, strategy);

        if (!result.success) {
          if (result.conflicts && result.conflicts.length > 0) {
            return `Merge failed with conflicts in:\n${result.conflicts.map((f: string) => `- ${f}`).join('\n')}\n\nResolve conflicts manually or try a different strategy.`;
          }
          return `Merge failed: ${result.error}`;
        }

        return `Task "${task}" merged successfully using ${strategy} strategy.\nCommit: ${result.sha}\nFiles changed: ${result.filesChanged?.length || 0}`;
      },
    });
  }
}
