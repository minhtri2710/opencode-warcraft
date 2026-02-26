import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type { BlockedResult } from '../types.js';
import { toolError, toolSuccess } from '../types.js';

import type {
  FeatureService,
  PlanService,
  TaskService,
  WorktreeService,
  TaskStatusType,
} from 'warcraft-core';
import { resolveFeatureInput, validateTaskInput } from './tool-input.js';
import { prepareTaskDispatch, DEFAULT_BUDGET } from './task-dispatch.js';
import {
  calculatePromptMeta,
  calculatePayloadMeta,
  checkWarnings,
} from '../utils/prompt-observability.js';

type CompletionGate = 'build' | 'test' | 'lint';

export interface WorktreeToolsDependencies {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  contextService: {
    list: (feature: string) => Array<{ name: string; content: string }>;
  };
  validateTaskStatus: (status: string) => TaskStatusType;
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (
    feature: string,
    taskFolder: string,
  ) => { allowed: boolean; error?: string };
  hasCompletionGateEvidence: (summary: string, gate: CompletionGate) => boolean;
  completionGates: readonly CompletionGate[];
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
        _toolContext,
      ) {
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const blockedResult = checkBlocked(feature);
        if (blockedResult.blocked) {
          return toolError(blockedResult.message || 'Feature is blocked');
        }

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return toolError(`Task "${task}" not found`);

        // Allow continuing blocked tasks, but not completed ones
        if (taskInfo.status === 'done')
          return toolError('Task already completed');
        if (continueFrom === 'blocked' && taskInfo.status !== 'blocked') {
          return toolError('Task is not in blocked state. Use without continueFrom.');
        }

        if (continueFrom !== 'blocked') {
          const depCheck = checkDependencies(feature, task);
          if (!depCheck.allowed) {
            return toolError(depCheck.error || 'Dependencies not met', [
              'Complete the required dependencies before starting this task.',
              'Use warcraft_status to see current task states.',
            ]);
          }
        }

        // Check if we're continuing from blocked - reuse existing worktree
        let worktree: Awaited<ReturnType<typeof worktreeService.create>>;
        if (continueFrom === 'blocked') {
          const existingWorktree = await worktreeService.get(feature, task);
          if (!existingWorktree) return toolError('No worktree found for blocked task');
          worktree = existingWorktree;
        } else {
          worktree = await worktreeService.create(feature, task);
        }

        const updatePayload: Record<string, unknown> = { status: 'in_progress' };
        if (continueFrom !== 'blocked') {
          updatePayload.baseCommit = worktree.commit;
        }
        taskService.update(feature, task, updatePayload);

        // Generate spec.md with context for task
        const prep = prepareTaskDispatch(
          {
            feature,
            task,
            taskInfo,
            worktree,
            continueFrom:
              continueFrom === 'blocked'
                ? {
                    status: 'blocked',
                    previousSummary:
                      taskInfo.summary || 'No previous summary',
                    decision: decision || 'No decision provided',
                  }
                : undefined,
          },
          { planService, taskService, contextService },
        );

        const { specContent, workerPrompt, persistedWorkerPrompt, contextFiles, previousTasks, truncationEvents, droppedTasksHint, taskBeadId, planContent } = prep;

        if (!persistedWorkerPrompt || persistedWorkerPrompt.trim().length === 0) {
          return toolError(`Failed to load worker prompt from task bead '${taskBeadId}' for task '${task}'`);
        }

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
          plan: planContent || '',
          context: contextContent,
          previousTasks: previousTasksContent,
          spec: specContent,
          workerPrompt,
        });

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

        return toolSuccess({
            ...responseBase,
            promptMeta,
            payloadMeta,
            budgetApplied: {
              maxTasks: DEFAULT_BUDGET.maxTasks,
              maxSummaryChars: DEFAULT_BUDGET.maxSummaryChars,
              maxContextChars: DEFAULT_BUDGET.maxContextChars,
              maxTotalContextChars: DEFAULT_BUDGET.maxTotalContextChars,
              tasksIncluded: previousTasks.length,
              tasksDropped: truncationEvents
                .filter((e) => e.type === 'tasks_dropped')
                .reduce((sum, e) => sum + (e.count ?? 0), 0),
              droppedTasksHint,
            },
            warnings: allWarnings.length > 0 ? allWarnings : undefined,
        });
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
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return toolError(`Task "${task}" not found`);
        if (
          taskInfo.status !== 'in_progress' &&
          taskInfo.status !== 'blocked'
        )
          return toolError('Task not in progress');

        // GATE: Check for explicit build/test/lint pass evidence when completing
        if (status === 'completed') {
          const missingGates = completionGates.filter(
            (gate) => !hasCompletionGateEvidence(summary, gate),
          );

          if (missingGates.length > 0) {
            return toolError(`Missing explicit verification evidence for ${missingGates.join(', ')}. Before claiming completion, run build, test, and lint gates. Include one pass signal per gate in summary (e.g. "build: exit 0"). Re-run with updated summary showing verification results.`);
        }
        }

        if (status === 'blocked') {
          taskService.update(feature, task, {
            status: 'blocked',
            summary,
            blocker,
          });

          const worktree = await worktreeService.get(feature, task);
          return toolSuccess({
              status: 'blocked',
              task,
              summary,
              blocker,
              worktreePath: worktree?.path,
              message: 'Task blocked. Warcraft Master will ask user and resume with warcraft_worktree_create(continueFrom: "blocked", decision: answer)',
          });
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
          return toolError(`Cannot mark task "${task}" completed because no commit was created (${commitResult.message}). Task status unchanged.`);
        }

        const finalStatus = status === 'completed' ? 'done' : status;
        taskService.update(feature, task, {
          status: validateTaskStatus(finalStatus),
          summary,
        });

        const worktree = await worktreeService.get(feature, task);
        return toolSuccess({ message: `Task "${task}" ${status}. Changes committed to branch ${worktree?.branch || 'unknown'}.\nUse warcraft_merge to integrate changes. Worktree preserved at ${worktree?.path || 'unknown'}.` });
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
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        await worktreeService.remove(feature, task);
        taskService.update(feature, task, { status: 'pending' });

        return toolSuccess({ message: `Task "${task}" aborted. Status reset to pending.` });
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
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return toolError(`Task "${task}" not found`);
        if (taskInfo.status !== 'done')
          return toolError('Task must be completed before merging. Use warcraft_worktree_commit first.');

        const result = await worktreeService.merge(feature, task, strategy);

        if (!result.success) {
          if (result.conflicts && result.conflicts.length > 0) {
            return toolError(`Merge failed with conflicts in:\n${result.conflicts.map((f: string) => `- ${f}`).join('\n')}\n\nResolve conflicts manually or try a different strategy.`);
          }
          return toolError(`Merge failed: ${result.error}`);
        }

        return toolSuccess({ message: `Task "${task}" merged successfully using ${strategy} strategy.\nCommit: ${result.sha}\nFiles changed: ${result.filesChanged?.length || 0}` });
      },
    });
  }
}
