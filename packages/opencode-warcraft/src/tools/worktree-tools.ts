import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import type {
  EventLogger,
  FeatureService,
  PlanService,
  TaskService,
  TaskStatusType,
  WorktreeService,
} from 'warcraft-core';
import { DispatchCoordinator, type DispatchCoordinatorDeps } from '../services/dispatch-coordinator.js';
import type { BlockedResult } from '../types.js';
import { toolError, toolSuccess } from '../types.js';
import { calculatePayloadMeta, calculatePromptMeta, checkWarnings } from '../utils/prompt-observability.js';
import { getVerificationCommandsForCwd } from '../utils/runtime-commands.js';
import { DEFAULT_BUDGET } from './task-dispatch.js';
import { resolveFeatureInput, validateTaskInput } from './tool-input.js';

type ExecAsyncFn = (
  command: string,
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecAsync = promisify(execCb) as ExecAsyncFn;

type CompletionGate = 'build' | 'test' | 'lint';

/**
 * Sanitise a `learnings` value so that malformed payloads
 * (non-array, non-string elements, empty / whitespace-only strings)
 * are silently discarded rather than persisted or causing a crash.
 */
function sanitizeLearnings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return valid.length > 0 ? valid : undefined;
}

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
  structuredVerificationMode?: 'compat' | 'enforce';
  /** Lazy getter for feature-level reopen rate from trust metrics (0.0–1.0). Called at dispatch time. */
  getFeatureReopenRate?: () => number;
  lockDir?: string;
  execAsync?: ExecAsyncFn;
  eventLogger: EventLogger;
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
      taskService,
      planService,
      contextService,
      worktreeService,
      checkBlocked,
      checkDependencies,
      verificationModel,
      getFeatureReopenRate,
      eventLogger,
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

        // Build coordinator deps from the tool dependencies
        const coordinatorDeps: DispatchCoordinatorDeps = {
          taskService,
          planService,
          contextService,
          worktreeService: {
            create: worktreeService.create.bind(worktreeService),
            get: worktreeService.get.bind(worktreeService),
            remove: worktreeService.remove.bind(worktreeService),
          },
          checkBlocked,
          checkDependencies,
          verificationModel,
          featureReopenRate: getFeatureReopenRate?.(),
          lockDir,
        };

        const coordinator = new DispatchCoordinator(coordinatorDeps);
        const dispatchResult = await coordinator.dispatch({
          feature,
          task,
          continueFrom,
          decision,
        });

        if (!dispatchResult.success) {
          return toolError(dispatchResult.error || 'Dispatch failed');
        }

        // --- UX layer: idempotency key, observability, response formatting ---

        const agent = dispatchResult.agent;
        const prep = dispatchResult.prep!;
        const {
          specContent,
          workerPrompt,
          persistedWorkerPrompt,
          contextFiles,
          previousTasks,
          truncationEvents,
          droppedTasksHint,
          planContent,
        } = prep;

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

        const taskToolPrompt = persistedWorkerPrompt!;

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
          worktreePath: dispatchResult.worktreePath,
          branch: dispatchResult.branch,
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

        // Emit dispatch event for trust metrics tracking
        eventLogger.emit({
          type: 'dispatch',
          feature,
          task,
          details: { agent, continueFrom: continueFrom || null },
        });

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
        feature: tool.schema.string().optional().describe('Feature name (defaults to detection or single feature)'),
        learnings: tool.schema
          .array(tool.schema.string())
          .optional()
          .describe('Learnings discovered during this task (persisted for future workers)'),
      },
      async execute({
        task,
        summary,
        status = 'completed',
        blocker,
        feature: explicitFeature,
        learnings: rawLearnings,
      }) {
        const learnings = sanitizeLearnings(rawLearnings);
        let missingGatesForWarn: string[] = [];
        validateTaskInput(task);
        const resolution = resolveFeatureInput(resolveFeature, explicitFeature);
        if (!resolution.ok) return toolError(resolution.error);
        const feature = resolution.feature;

        const taskInfo = taskService.get(feature, task);
        if (!taskInfo) {
          try {
            const syncedTasks = taskService.list(feature);
            if (syncedTasks.length === 0) {
              return toolError(
                `Task "${task}" not found. No synced tasks found for feature "${feature}". Run warcraft_tasks_sync first.`,
              );
            }
          } catch {
            // fall through to generic task-not-found error
          }
          return toolError(`Task "${task}" not found`);
        }
        if (taskInfo.status !== 'in_progress' && taskInfo.status !== 'blocked')
          return toolError('Task not in progress');

        // GATE: Check for explicit build/test/lint pass evidence when completing
        if (status === 'completed') {
          // In best-effort mode, skip gate checks entirely — verification deferred to orchestrator
          if (verificationModel === 'best-effort') {
            // Continue to commit — gates are deferred
          } else {
            const missingGates = completionGates.filter((gate) => !hasCompletionGateEvidence(summary, gate));

            if (missingGates.length > 0) {
              if (workflowGatesMode === 'enforce') {
                return toolSuccess({
                  ok: false,
                  terminal: false,
                  status: 'needs_verification',
                  nextAction:
                    'Run build, test, and lint gates. Include pass signals in summary (e.g. "build: exit 0"). Then re-run warcraft_worktree_commit.',
                  missingGates,
                });
              }
              // warn mode: proceed but note missing evidence
              missingGatesForWarn = [...missingGates];
            }
          }
        }

        if (status === 'blocked') {
          taskService.transition(feature, task, 'blocked', {
            summary,
            blocker,
            ...(learnings && learnings.length > 0 ? { learnings } : {}),
          });

          eventLogger.emit({
            type: 'blocked',
            feature,
            task,
            details: { reason: blocker?.reason, summary },
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

        const rawStatus = taskService.getRawStatus(feature, task);
        const baseCommit =
          typeof rawStatus?.baseCommit === 'string' && rawStatus.baseCommit.trim().length > 0
            ? rawStatus.baseCommit
            : null;
        if (!baseCommit) {
          return toolError(
            `Task "${task}" is missing baseCommit. Recreate the worktree with warcraft_worktree_create before completing.`,
          );
        }
        const diff = await worktreeService.getDiff(feature, task, baseCommit);
        if (diff.error) {
          return toolError(`Failed to generate diff for task "${task}": ${diff.error}`);
        }
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

        const finalStatus = status === 'completed' ? 'done' : status;
        taskService.transition(feature, task, validateTaskStatus(finalStatus), {
          summary,
          ...(learnings && learnings.length > 0 ? { learnings } : {}),
        });

        // Emit commit event for trust metrics tracking
        eventLogger.emit({
          type: 'commit',
          feature,
          task,
          details: { status, finalStatus, sha: commitResult.sha },
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
        // Two-step transition: current status → cancelled → pending
        // This follows the state machine where in_progress/blocked → cancelled is allowed,
        // and cancelled → pending is allowed for re-dispatch.
        taskService.transition(feature, task, 'cancelled');
        taskService.transition(feature, task, 'pending');

        return toolSuccess({ message: `Task "${task}" aborted. Status reset to pending.` });
      },
    });
  }

  /**
   * Prune stale worktrees with dry-run safety by default.
   */
  pruneWorktreeTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    const { worktreeService } = this.deps;
    return tool({
      description: 'Prune stale worktrees (safe by default via dryRun=true)',
      args: {
        feature: tool.schema.string().optional().describe('Feature name (defaults to active if available)'),
        dryRun: tool.schema.boolean().optional().default(true).describe('Preview removals without deleting'),
        confirm: tool.schema
          .boolean()
          .optional()
          .default(false)
          .describe('Required for destructive prune when dryRun=false'),
      },
      async execute({ feature: explicitFeature, dryRun = true, confirm = false }) {
        const featureResolution = explicitFeature ? resolveFeatureInput(resolveFeature, explicitFeature) : null;
        if (featureResolution && !featureResolution.ok) return toolError(featureResolution.error);

        const feature = featureResolution?.feature;
        const worktreeServiceWithPrune = worktreeService as WorktreeService & {
          prune: (opts: { dryRun: boolean; confirm?: boolean; feature?: string }) => Promise<{
            wouldRemove: Array<{ feature: string; step: string; path: string; branch: string }>;
            removed: string[];
            requiresConfirm?: boolean;
          }>;
        };

        const result = await worktreeServiceWithPrune.prune({ dryRun, confirm, feature });

        return toolSuccess({
          dryRun,
          requiresConfirm: result.requiresConfirm ?? false,
          staleWorktrees: result.wouldRemove,
          removed: result.removed,
        });
      },
    });
  }

  /**
   * Merge completed task branch into current branch (explicit integration)
   */
  mergeTaskTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { taskService, worktreeService, verificationModel, execAsync: injectedExecAsync } = this.deps;
    const execAsync = injectedExecAsync ?? defaultExecAsync;
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
          .default(false)
          .describe('Run build+test after merge to verify integration'),
        cleanup: tool.schema
          .boolean()
          .optional()
          .default(false)
          .describe('Remove worktree after successful merge (keeps branch)'),
      },
      async execute({ task, strategy = 'merge', feature: explicitFeature, verify, cleanup: cleanupRequested }) {
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

        const mergeResult: Record<string, unknown> = {
          message: `Task "${task}" merged successfully using ${strategy} strategy.\nCommit: ${result.sha}\nFiles changed: ${result.filesChanged?.length || 0}`,
        };

        // Perform opt-in worktree cleanup (non-fatal)
        const effectiveCleanup = cleanupRequested ?? false;
        if (effectiveCleanup) {
          try {
            await worktreeService.remove(feature, task, false);
            mergeResult.cleanup = { requested: true, removed: true };
          } catch (err: unknown) {
            const cleanupErr = err as { message?: string };
            mergeResult.cleanup = {
              requested: true,
              removed: false,
              error: cleanupErr.message || 'Worktree cleanup failed',
            };
          }
        } else {
          mergeResult.cleanup = { requested: false, removed: false, reason: 'not-requested' };
        }

        const effectiveVerify = verify ?? verificationModel === 'tdd';
        if (effectiveVerify) {
          const execOpts = { cwd: process.cwd(), timeout: 300_000 };
          const cmds = getVerificationCommandsForCwd(execOpts.cwd);
          try {
            const buildResult = await execAsync(cmds.build, execOpts);
            const testResult = await execAsync(cmds.test, execOpts);
            const output = [buildResult.stdout, buildResult.stderr, testResult.stdout, testResult.stderr]
              .filter(Boolean)
              .join('\n');
            return toolSuccess({
              ...mergeResult,
              verification: {
                passed: true,
                commands: { build: cmds.build, test: cmds.test },
                output,
              },
            });
          } catch (err: unknown) {
            const execErr = err as { stdout?: string; stderr?: string; message?: string };
            const output = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n');
            return toolSuccess({
              ...mergeResult,
              verification: {
                passed: false,
                commands: { build: cmds.build, test: cmds.test },
                output: output || execErr.message || 'Verification failed',
              },
            });
          }
        }

        return toolSuccess(mergeResult);
      },
    });
  }
}
