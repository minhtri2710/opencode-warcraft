/**
 * Response formatting utilities for worktree tools.
 *
 * Separates "how to present results" from "what to do" (orchestration).
 * All functions are pure — they take data in and return formatted objects.
 */

import type { PromptWarning } from '../utils/prompt-observability.js';

// ============================================================================
// Types
// ============================================================================

export interface TruncationEventLike {
  type: string;
  message: string;
  affected?: string[];
  count?: number;
}

export interface BudgetWarning {
  type: string;
  severity: 'info';
  message: string;
  affected?: string[];
  count?: number;
}

export interface BudgetConfig {
  maxTasks: number;
  maxSummaryChars: number;
  maxContextChars: number;
  maxTotalContextChars: number;
}

export interface BudgetApplied extends BudgetConfig {
  tasksIncluded: number;
  tasksDropped: number;
  droppedTasksHint?: string;
}

export interface DiffInfo {
  hasDiff: boolean;
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

interface BlockerInfo {
  reason: string;
  options?: string[];
  recommendation?: string;
  context?: string;
}

// ============================================================================
// Create Worktree Response Helpers
// ============================================================================

const PREVIEW_MAX_LENGTH = 200;

/**
 * Truncate worker prompt to a preview-safe length.
 */
export function formatWorkerPromptPreview(workerPrompt: string, maxLength: number = PREVIEW_MAX_LENGTH): string {
  if (workerPrompt.length <= maxLength) return workerPrompt;
  return `${workerPrompt.slice(0, maxLength)}...`;
}

/**
 * Build the delegation instructions that tell the orchestrator how to spawn a task.
 */
export function formatDelegationInstructions(input: { agent: string; task: string; taskToolPrompt: string }): string {
  const { agent, task, taskToolPrompt } = input;
  return `## Delegation Required

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
}

/**
 * Construct the base response object for worktree create.
 */
export function formatCreateResponseBase(input: {
  workspaceMode: string;
  workspacePath: string;
  branch: string;
  agent: string;
  workerPromptPreview: string;
  taskToolPrompt: string;
  task: string;
  specContent: string;
  delegationInstructions: string;
}): {
  workspaceMode: string;
  workspacePath: string;
  branch: string;
  mode: string;
  agent: string;
  delegationRequired: boolean;
  workerPromptPreview: string;
  taskPromptMode: string;
  taskToolCall: { subagent_type: string; description: string; prompt: string };
  instructions: string;
  taskSpec: string;
} {
  const {
    workspaceMode,
    workspacePath,
    branch,
    agent,
    workerPromptPreview,
    taskToolPrompt,
    task,
    specContent,
    delegationInstructions,
  } = input;
  return {
    workspaceMode,
    workspacePath,
    branch,
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
    instructions: delegationInstructions,
    taskSpec: specContent,
  };
}

/**
 * Convert truncation events into budget warnings.
 */
export function buildBudgetWarnings(events: TruncationEventLike[]): BudgetWarning[] {
  return events.map((event) => ({
    type: event.type,
    severity: 'info' as const,
    message: event.message,
    affected: event.affected,
    count: event.count,
  }));
}

/**
 * Merge size warnings and budget warnings, returning undefined if empty.
 */
export function mergeCreateWarnings(
  sizeWarnings: PromptWarning[],
  budgetWarnings: BudgetWarning[],
): Array<PromptWarning | BudgetWarning> | undefined {
  const all = [...sizeWarnings, ...budgetWarnings];
  return all.length > 0 ? all : undefined;
}

/**
 * Calculate the budget-applied metadata for the create response.
 */
export function buildBudgetApplied(input: {
  previousTasksCount: number;
  truncationEvents: TruncationEventLike[];
  droppedTasksHint?: string;
  budget: BudgetConfig;
}): BudgetApplied {
  const { previousTasksCount, truncationEvents, droppedTasksHint, budget } = input;
  const tasksDropped = truncationEvents
    .filter((e) => e.type === 'tasks_dropped')
    .reduce((sum, e) => sum + (e.count ?? 0), 0);

  return {
    maxTasks: budget.maxTasks,
    maxSummaryChars: budget.maxSummaryChars,
    maxContextChars: budget.maxContextChars,
    maxTotalContextChars: budget.maxTotalContextChars,
    tasksIncluded: previousTasksCount,
    tasksDropped,
    droppedTasksHint,
  };
}

// ============================================================================
// Commit Worktree Response Helpers
// ============================================================================

/**
 * Build the markdown task report written to disk after commit.
 */
export function buildCommitReport(input: {
  task: string;
  feature: string;
  workflowPath: string;
  status: string;
  commitSha: string;
  summary: string;
  workspaceMode: 'worktree' | 'direct';
  workspacePath?: string;
  diff: DiffInfo;
}): string {
  const { task, feature, workflowPath, status, commitSha, summary, workspaceMode, workspacePath, diff } = input;

  const statusLabel = status === 'completed' ? 'success' : status;
  const reportLines: string[] = [
    `# Task Report: ${task}`,
    '',
    `**Feature:** ${feature}`,
    `**Workflow Path:** ${workflowPath}`,
    `**Completed:** ${new Date().toISOString()}`,
    `**Status:** ${statusLabel}`,
    `**Commit:** ${commitSha || 'none'}`,
    '',
    '---',
    '',
    '## Summary',
    '',
    summary,
    '',
  ];

  if (workspaceMode === 'direct') {
    reportLines.push(
      '---',
      '',
      '## Workspace',
      '',
      '- **Mode:** direct',
      `- **Path:** ${workspacePath || 'unknown'}`,
      '- **Git state:** no isolated branch or worktree was created',
      '',
    );
  }

  if (diff.hasDiff) {
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
      for (const file of diff.filesChanged) {
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
      workspaceMode === 'worktree'
        ? '_No file changes detected_'
        : '_Direct-mode execution; git diff is not available._',
      '',
    );
  }

  return reportLines.join('\n');
}

/**
 * Format the blocked task response for commitWorktreeTool.
 */
export function formatBlockedResponse(input: {
  task: string;
  summary: string;
  blocker?: BlockerInfo;
  workspaceMode: 'worktree' | 'direct';
  workspacePath?: string;
  branch?: string;
}): Record<string, unknown> {
  const { task, summary, blocker, workspaceMode, workspacePath, branch } = input;
  return {
    ok: true,
    terminal: true,
    status: 'blocked',
    task,
    summary,
    blocker,
    workspaceMode,
    workspacePath,
    branch: workspaceMode === 'worktree' ? branch : undefined,
    message:
      workspaceMode === 'direct'
        ? 'Task blocked in direct mode. Warcraft Master will ask user and resume against the project root workspace.'
        : 'Task blocked. Warcraft Master will ask user and resume with warcraft_worktree_create(continueFrom: "blocked", decision: answer), then issue the returned task() call',
  };
}

/**
 * Build the terminal commit result for commitWorktreeTool.
 */
export function buildTerminalCommitResult(input: {
  task: string;
  status: string;
  workspaceMode: 'worktree' | 'direct';
  workspacePath?: string;
  branch?: string;
  verificationModel: 'tdd' | 'best-effort';
  missingGatesForWarn: string[];
}): Record<string, unknown> {
  const { task, status, workspaceMode, workspacePath, branch, verificationModel, missingGatesForWarn } = input;

  const finalStatus = status === 'completed' ? 'done' : status;
  const result: Record<string, unknown> = {
    ok: true,
    terminal: true,
    status: finalStatus === 'done' ? 'completed' : status,
    task,
    workspaceMode,
    workspacePath,
    branch: workspaceMode === 'worktree' ? branch : undefined,
    message:
      workspaceMode === 'worktree'
        ? `Task "${task}" ${status}. Changes committed to branch ${branch || 'unknown'}.\nUse warcraft_merge to integrate changes. Worktree preserved at ${workspacePath || 'unknown'}.`
        : `Task "${task}" ${status} in direct mode. No git commit or merge step was created; changes remain in the project root at ${workspacePath || 'unknown'}.`,
  };

  if (status === 'completed' && verificationModel === 'best-effort') {
    result.verificationDeferred = true;
    result.deferredTo = 'orchestrator';
  }

  if (status === 'completed' && missingGatesForWarn.length > 0) {
    result.verificationNote = `Missing evidence for: ${missingGatesForWarn.join(', ')}. Verification recommended.`;
  }

  return result;
}
