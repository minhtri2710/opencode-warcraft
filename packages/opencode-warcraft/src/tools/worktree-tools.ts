import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { FeatureService, PlanService, TaskService, TaskStatusType, WorktreeService } from 'warcraft-core';
import type { CompletionGate, StructuredVerification } from '../guards.js';
import { checkVerificationGates } from '../guards.js';
import type { BlockedResult } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { calculatePayloadMeta, calculatePromptMeta, checkWarnings } from '../utils/prompt-observability.js';
import { getVerificationCommandsForCwd } from '../utils/runtime-commands.js';
import { type DispatchOneTaskServices, dispatchOneTask } from './dispatch-task.js';
import { DEFAULT_BUDGET, prepareTaskDispatch } from './task-dispatch.js';
import { resolveFeatureInput, validateTaskInput } from './tool-input.js';

const defaultExecAsync = promisify(execCb);

export type ExecAsyncFn = (
  command: string,
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

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
  checkDependencies: (feature: string, taskFolder: string) => { allowed: boolean; error?: string };
  hasCompletionGateEvidence: (summary: string, gate: CompletionGate) => boolean;
  completionGates: readonly CompletionGate[];
  verificationModel: 'tdd' | 'best-effort';
  workflowGatesMode: 'enforce' | 'warn';
  /** Structured verification mode: 'compat' keeps regex fallback; 'enforce' requires structured payload. */
  structuredVerificationMode: 'compat' | 'enforce';
  eventLogger?: {
    emit: (event: { type: string; feature: string; task: string; details?: Record<string, unknown> }) => void;
  };
  /** When true, use unified dispatchOneTask path with per-task lock. */
  unifiedDispatchEnabled?: boolean;
  /** Directory for per-task dispatch locks (required when unifiedDispatchEnabled is true). */
  lockDir?: string;
  /** Injectable exec function for testing. Defaults to promisified child_process.exec. */
  execAsync?: ExecAsyncFn;
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
    const {
      checkBlocked,
      checkDependencies,
      taskService,
      planService,
      contextService,
      worktreeService,
      verificationModel,
      eventLogger,
      unifiedDispatchEnabled,
      lockDir,
    } = this.deps;
    return tool({
      description: 'Create worktree and begin work on task. Spawns Mekkatorque worker automatically.',
      args: {
        task: tool.schema.string().describe('Task folder name'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        continueFrom: tool.schema.enum(['blocked']).optional().describe('Resume a blocked task'),
        decision: tool.schema.string().optional().describe('Answer to blocker question when continuing'),
      },
      async execute({ task, feature: explicitFeature, continueFrom, decision }, _toolContext) {
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
        if (taskInfo.status === 'done') return toolError('Task already completed');
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

        // --- Unified dispatch path (gated by flag) ---
        if (unifiedDispatchEnabled) {
          const unifiedServices: DispatchOneTaskServices = {
            taskService,
            planService,
            contextService,
            worktreeService,
            checkBlocked,
            checkDependencies,
            verificationModel,
            lockDir,
          };
          const dispatchResult = await dispatchOneTask(
            { feature, task, continueFrom: continueFrom as 'blocked' | undefined, decision },
            unifiedServices,
          );
          if (!dispatchResult.success) {
            return toolError(dispatchResult.error || 'Dispatch failed');
          }

          const agent = dispatchResult.agent;
          const taskToolPrompt = dispatchResult.taskToolCall!.prompt;
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

          return toolSuccess({
            worktreePath: dispatchResult.worktreePath,
            branch: dispatchResult.branch,
            mode: 'delegate',
            agent,
            delegationRequired: true,
            taskPromptMode: 'opencode-inline',
            taskToolCall: dispatchResult.taskToolCall,
            instructions: taskToolInstructions,
          });
        }

        // --- Legacy dispatch path ---
        // Check if we're continuing from blocked - reuse existing worktree
        let worktree: Awaited<ReturnType<typeof worktreeService.create>>;
        if (continueFrom === 'blocked') {
          const existingWorktree = await worktreeService.get(feature, task);
          if (!existingWorktree) return toolError('No worktree found for blocked task');
          worktree = existingWorktree;
        } else {
          worktree = await worktreeService.create(feature, task);
        }

        const updateExtras: { baseCommit?: string } = {};
        if (continueFrom !== 'blocked') {
          updateExtras.baseCommit = worktree.commit;
        }
        const taskServiceWithTransition = taskService as TaskService & {
          transition: (feature: string, task: string, status: TaskStatusType, patch?: Record<string, unknown>) => void;
        };
        taskServiceWithTransition.transition(feature, task, 'in_progress', updateExtras);

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
                    previousSummary: taskInfo.summary || 'No previous summary',
                    decision: decision || 'No decision provided',
                  }
                : undefined,
          },
          { planService, taskService, contextService, verificationModel },
        );

        const {
          specContent,
          workerPrompt,
          persistedWorkerPrompt,
          contextFiles,
          previousTasks,
          truncationEvents,
          droppedTasksHint,
          taskBeadId,
          planContent,
        } = prep;

        if (!persistedWorkerPrompt || persistedWorkerPrompt.trim().length === 0) {
          return toolError(`Failed to load worker prompt from task bead '${taskBeadId}' for task '${task}'`);
        }

        const agent = 'mekkatorque';

        const rawStatus = taskService.getRawStatus(feature, task);
        const attempt = (rawStatus?.workerSession?.attempt || 0) + 1;
        const idempotencyKey = `warcraft-${feature}-${task}-${attempt}`;

        try {
          taskService.patchBackgroundFields(feature, task, { idempotencyKey });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(
            `[warcraft] Failed to persist idempotency key for task '${task}' in feature '${feature}': ${reason}`,
          );
        }

        // Emit dispatch event for operational observability
        eventLogger?.emit({ type: 'dispatch', feature, task, details: { attempt, agent } });

        const contextContent = contextFiles.map((f) => f.content).join('\n\n');
        const previousTasksContent = previousTasks.map((t) => `- **${t.name}**: ${t.summary}`).join('\n');
        const promptMeta = calculatePromptMeta({
          plan: planContent || '',
          context: contextContent,
          previousTasks: previousTasksContent,
          spec: specContent,
          workerPrompt,
        });

        const PREVIEW_MAX_LENGTH = 200;
        const workerPromptPreview =
          workerPrompt.length > PREVIEW_MAX_LENGTH ? `${workerPrompt.slice(0, PREVIEW_MAX_LENGTH)}...` : workerPrompt;

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
    const {
      taskService,
      worktreeService,
      featureService,
      validateTaskStatus,
      hasCompletionGateEvidence,
      completionGates,
      workflowGatesMode,
      verificationModel,
      structuredVerificationMode,
      eventLogger,
    } = this.deps;
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
            options: tool.schema.array(tool.schema.string()).optional().describe('Available options for the user'),
            recommendation: tool.schema.string().optional().describe('Your recommended choice'),
            context: tool.schema.string().optional().describe('Additional context for the decision'),
          })
          .optional()
          .describe('Blocker info when status is blocked'),
        verification: tool.schema
          .object({
            build: tool.schema
              .object({
                cmd: tool.schema.string().describe('Command that was run'),
                exitCode: tool.schema.number().describe('Process exit code (0 = success)'),
                output: tool.schema.string().optional().describe('Captured command output'),
              })
              .optional()
              .describe('Build verification result'),
            test: tool.schema
              .object({
                cmd: tool.schema.string().describe('Command that was run'),
                exitCode: tool.schema.number().describe('Process exit code (0 = success)'),
                output: tool.schema.string().optional().describe('Captured command output'),
              })
              .optional()
              .describe('Test verification result'),
            lint: tool.schema
              .object({
                cmd: tool.schema.string().describe('Command that was run'),
                exitCode: tool.schema.number().describe('Process exit code (0 = success)'),
                output: tool.schema.string().optional().describe('Captured command output'),
              })
              .optional()
              .describe('Lint verification result'),
          })
          .optional()
          .describe('Structured verification results (preferred over summary regex)'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
      },
      async execute({ task, summary, status = 'completed', blocker, verification, feature: explicitFeature }) {
        let missingGatesForWarn: string[] = [];
        let verificationDiagnostics: string | undefined;
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) return toolError(`Task "${task}" not found`);
        if (taskInfo.status !== 'in_progress' && taskInfo.status !== 'blocked')
          return toolError('Task not in progress');

        // GATE: Check for explicit build/test/lint pass evidence when completing
        if (status === 'completed') {
          // In best-effort mode, skip gate checks entirely — verification deferred to orchestrator
          if (verificationModel === 'best-effort') {
            // Continue to commit — gates are deferred
          } else {
            const gateResult = checkVerificationGates(
              verification as StructuredVerification | undefined,
              summary,
              completionGates,
              structuredVerificationMode,
              hasCompletionGateEvidence,
            );

            if (!gateResult.passed) {
              if (workflowGatesMode === 'enforce') {
                return toolSuccess({
                  ok: false,
                  terminal: false,
                  status: 'needs_verification',
                  nextAction:
                    'Run build, test, and lint gates. Include pass signals in summary (e.g. "build: exit 0"). Then re-run warcraft_worktree_commit.',
                  missingGates: gateResult.missing,
                });
              }
              // warn mode: proceed but note missing evidence
              missingGatesForWarn = [...gateResult.missing];
            }

            // Emit diagnostics when regex fallback was used in compat mode
            if (gateResult.usedRegexFallback && gateResult.passed) {
              verificationDiagnostics =
                'Verification passed via regex fallback. Prefer structured verification payload for reliability.';
            }
          }
        }

        if (status === 'blocked') {
          const taskServiceWithTransition = taskService as TaskService & {
            transition: (
              feature: string,
              task: string,
              status: TaskStatusType,
              patch?: Record<string, unknown>,
            ) => void;
          };
          taskServiceWithTransition.transition(feature, task, 'blocked', {
            summary,
            blocker,
          });

          // Emit blocked event for operational observability
          eventLogger?.emit({
            type: 'blocked',
            feature,
            task,
            details: { reason: blocker?.reason },
          });

          const worktree = await worktreeService.get(feature, task);
          return toolSuccess({
            ok: true,
            terminal: true,
            status: 'blocked',
            task,
            summary,
            blocker,
            worktreePath: worktree?.path,
            message:
              'Task blocked. Warcraft Master will ask user and resume with warcraft_worktree_create(continueFrom: "blocked", decision: answer)',
          });
        }

        const commitResult = await worktreeService.commitChanges(
          feature,
          task,
          `warcraft(${task}): ${summary.slice(0, 50)}`,
        );

        const diff = await worktreeService.getDiff(feature, task);
        const featureMeta = featureService.get(feature);
        const workflowPath = (featureMeta as { workflowPath?: string } | null)?.workflowPath || 'standard';

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
          reportLines.push('---', '', '## Changes', '', '_No file changes detected_', '');
        }

        taskService.writeReport(feature, task, reportLines.join('\n'));

        if (status === 'completed' && !commitResult.committed) {
          return toolError(
            `Cannot mark task "${task}" completed because no commit was created (${commitResult.message}). Task status unchanged.`,
          );
        }

        // Emit commit event for operational observability
        eventLogger?.emit({
          type: 'commit',
          feature,
          task,
          details: { status, sha: commitResult.sha },
        });

        const finalStatus = status === 'completed' ? 'done' : status;
        const taskServiceWithTransition = taskService as TaskService & {
          transition: (feature: string, task: string, status: TaskStatusType, patch?: Record<string, unknown>) => void;
        };
        taskServiceWithTransition.transition(feature, task, validateTaskStatus(finalStatus), {
          summary,
        });

        const worktree = await worktreeService.get(feature, task);
        const terminalResult: Record<string, unknown> = {
          ok: true,
          terminal: true,
          status: finalStatus === 'done' ? 'completed' : status,
          task,
          message: `Task "${task}" ${status}. Changes committed to branch ${worktree?.branch || 'unknown'}.\nUse warcraft_merge to integrate changes. Worktree preserved at ${worktree?.path || 'unknown'}.`,
        };

        if (status === 'completed' && verificationModel === 'best-effort') {
          terminalResult.verificationDeferred = true;
          terminalResult.deferredTo = 'orchestrator';
        }

        if (status === 'completed' && missingGatesForWarn.length > 0) {
          return toolSuccess({
            ...terminalResult,
            verificationNote: `Missing evidence for: ${missingGatesForWarn.join(', ')}. Verification recommended.`,
          });
        }

        if (verificationDiagnostics) {
          return toolSuccess({
            ...terminalResult,
            verificationDiagnostics,
          });
        }

        return toolSuccess(terminalResult);
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
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
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
   * Prune stale worktrees. Defaults to dry-run mode for safety.
   */
  pruneWorktreeTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    const { worktreeService } = this.deps;
    return tool({
      description:
        'Prune stale worktrees. Defaults to dry-run (preview only). Set dryRun=false and confirm=true to actually remove.',
      args: {
        dryRun: tool.schema
          .boolean()
          .optional()
          .default(true)
          .describe('Preview only (default: true). Set to false to actually remove.'),
        confirm: tool.schema
          .boolean()
          .optional()
          .default(false)
          .describe('Required when dryRun=false. Explicit confirmation to delete stale worktrees.'),
        feature: tool.schema.string().optional().describe('Filter by feature name'),
      },
      async execute({ dryRun = true, confirm = false, feature: explicitFeature }) {
        const feature = explicitFeature ? resolveFeatureInput(resolveFeature, explicitFeature).feature : undefined;

        const worktreeServiceWithPrune = worktreeService as WorktreeService & {
          prune: (opts: { dryRun: boolean; confirm: boolean; feature?: string }) => Promise<{
            wouldRemove: Array<{ feature: string; step: string; path: string; branch: string }>;
            requiresConfirm?: boolean;
            removed: string[];
          }>;
        };
        const result = await worktreeServiceWithPrune.prune({ dryRun, confirm, feature });

        if (dryRun) {
          if (result.wouldRemove.length === 0) {
            return toolSuccess({
              message: 'No stale worktrees found.',
              staleCount: 0,
            });
          }
          return toolSuccess({
            message: `Found ${result.wouldRemove.length} stale worktree(s). Re-run with dryRun=false and confirm=true to remove.`,
            staleCount: result.wouldRemove.length,
            staleWorktrees: result.wouldRemove.map(
              (wt: { feature: string; step: string; path: string; branch: string }) => ({
                feature: wt.feature,
                step: wt.step,
                path: wt.path,
                branch: wt.branch,
              }),
            ),
          });
        }

        if (result.requiresConfirm) {
          return toolError('Destructive operation requires confirm=true. Re-run with confirm=true to proceed.', [
            'Set confirm=true to delete stale worktrees.',
          ]);
        }

        return toolSuccess({
          message: `Pruned ${result.removed.length} stale worktree(s).`,
          removedCount: result.removed.length,
          removedPaths: result.removed,
        });
      },
    });
  }

  /**
   * Merge completed task branch into current branch (explicit integration)
   */
  mergeTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, worktreeService, eventLogger, verificationModel, execAsync: injectedExec } = this.deps;
    const execAsync = injectedExec ?? defaultExecAsync;
    return tool({
      description: 'Merge completed task branch into current branch (explicit integration)',
      args: {
        task: tool.schema.string().describe('Task folder name to merge'),
        strategy: tool.schema
          .enum(['merge', 'squash', 'rebase'])
          .optional()
          .describe('Merge strategy (default: merge)'),
        feature: tool.schema.string().optional().describe('Feature name (defaults to active)'),
        verify: tool.schema
          .boolean()
          .optional()
          .describe(
            'Run build+test after merge to verify integration. Defaults to true in TDD mode, false in best-effort.',
          ),
      },
      async execute({ task, strategy = 'merge', feature: explicitFeature, verify }) {
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
            return toolError(
              `Merge failed with conflicts in:\n${result.conflicts.map((f: string) => `- ${f}`).join('\n')}\n\nResolve conflicts manually or try a different strategy.`,
            );
          }
          return toolError(`Merge failed: ${result.error}`);
        }

        const mergeResult = {
          message: `Task "${task}" merged successfully using ${strategy} strategy.\nCommit: ${result.sha}\nFiles changed: ${result.filesChanged?.length || 0}`,
        };

        // Emit merge event for operational observability
        eventLogger?.emit({
          type: 'merge',
          feature,
          task,
          details: { strategy, sha: result.sha },
        });

        // Default verify based on verificationModel: true for TDD, false for best-effort
        const effectiveVerify = verify ?? verificationModel === 'tdd';

        if (effectiveVerify) {
          const execOpts = { cwd: process.cwd(), timeout: 300_000 };
          const cmds = getVerificationCommandsForCwd(execOpts.cwd);
          const outputs: string[] = [];
          try {
            const buildResult = await execAsync(cmds.build, execOpts);
            outputs.push(buildResult.stdout || '', buildResult.stderr || '');
            const testResult = await execAsync(cmds.test, execOpts);
            outputs.push(testResult.stdout || '', testResult.stderr || '');
            const output = outputs.filter(Boolean).join('\n').trim();
            return toolSuccess({
              ...mergeResult,
              verification: {
                passed: true,
                output: output || 'Verification passed',
                commands: { build: cmds.build, test: cmds.test },
              },
            });
          } catch (err: unknown) {
            const execErr = err as { stdout?: string; stderr?: string; message?: string };
            const errorOutput = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n');
            const allOutput = [...outputs, errorOutput].filter(Boolean).join('\n').trim();
            return toolSuccess({
              ...mergeResult,
              verification: {
                passed: false,
                output: allOutput || execErr.message || 'Verification failed',
                commands: { build: cmds.build, test: cmds.test },
              },
            });
          }
        }

        return toolSuccess(mergeResult);
      },
    });
  }
}
