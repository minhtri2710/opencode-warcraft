import { describe, expect, it } from 'bun:test';
import {
  buildBudgetApplied,
  buildBudgetWarnings,
  buildCommitReport,
  buildTerminalCommitResult,
  formatBlockedResponse,
  formatCreateResponseBase,
  formatDelegationInstructions,
  formatWorkerPromptPreview,
  mergeCreateWarnings,
} from './worktree-response.js';

describe('formatWorkerPromptPreview', () => {
  it('returns full prompt when under max length', () => {
    const prompt = 'Short prompt';
    expect(formatWorkerPromptPreview(prompt)).toBe('Short prompt');
  });

  it('truncates and adds ellipsis when over max length', () => {
    const prompt = 'A'.repeat(300);
    const preview = formatWorkerPromptPreview(prompt);
    expect(preview.length).toBe(203); // 200 + '...'
    expect(preview.endsWith('...')).toBe(true);
  });

  it('uses custom max length when provided', () => {
    const prompt = 'A'.repeat(50);
    const preview = formatWorkerPromptPreview(prompt, 10);
    expect(preview).toBe(`${'A'.repeat(10)}...`);
  });
});

describe('formatDelegationInstructions', () => {
  it('builds delegation instructions with agent and task', () => {
    const result = formatDelegationInstructions({
      agent: 'mekkatorque',
      task: '01-build-thing',
      taskToolPrompt: 'Do the work',
    });
    expect(result).toContain('Delegation Required');
    expect(result).toContain('mekkatorque');
    expect(result).toContain('01-build-thing');
    expect(result).toContain('Do the work');
    expect(result).toContain('task(');
  });
});

describe('formatCreateResponseBase', () => {
  it('constructs response base with all fields', () => {
    const result = formatCreateResponseBase({
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'task-branch',
      agent: 'mekkatorque',
      workerPromptPreview: 'Preview...',
      taskToolPrompt: 'Full prompt here',
      task: '01-my-task',
      specContent: '# Spec\nDo stuff',
      delegationInstructions: '## Delegation\nUse task()...',
    });

    expect(result.workspaceMode).toBe('worktree');
    expect(result.workspacePath).toBe('/tmp/wt');
    expect(result.branch).toBe('task-branch');
    expect(result.mode).toBe('delegate');
    expect(result.agent).toBe('mekkatorque');
    expect(result.delegationRequired).toBe(true);
    expect(result.workerPromptPreview).toBe('Preview...');
    expect(result.taskPromptMode).toBe('opencode-inline');
    expect(result.taskToolCall.subagent_type).toBe('mekkatorque');
    expect(result.taskToolCall.description).toBe('Warcraft: 01-my-task');
    expect(result.taskToolCall.prompt).toBe('Full prompt here');
    expect(result.instructions).toBe('## Delegation\nUse task()...');
    expect(result.taskSpec).toBe('# Spec\nDo stuff');
  });
});

describe('buildBudgetWarnings', () => {
  it('converts truncation events to warnings', () => {
    const events = [
      { type: 'tasks_truncated', message: 'Tasks truncated', affected: 'tasks', count: 2 },
      { type: 'context_truncated', message: 'Context truncated', affected: 'context', count: 1 },
    ];
    const result = buildBudgetWarnings(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'tasks_truncated',
      severity: 'info',
      message: 'Tasks truncated',
      affected: 'tasks',
      count: 2,
    });
  });

  it('returns empty array for no events', () => {
    expect(buildBudgetWarnings([])).toEqual([]);
  });
});

describe('mergeCreateWarnings', () => {
  it('merges size warnings and budget warnings', () => {
    const sizeWarnings = [
      {
        type: 'workerPromptSize' as const,
        severity: 'info' as const,
        message: 'big',
        currentValue: 100,
        threshold: 50,
      },
    ];
    const budgetWarnings = [
      { type: 'truncated', severity: 'info' as const, message: 'trimmed', affected: 'tasks', count: 1 },
    ];
    const result = mergeCreateWarnings(sizeWarnings, budgetWarnings);
    expect(result).toHaveLength(2);
  });

  it('returns undefined when both are empty', () => {
    expect(mergeCreateWarnings([], [])).toBeUndefined();
  });
});

describe('buildBudgetApplied', () => {
  it('calculates budget applied with correct task counts', () => {
    const truncationEvents = [
      { type: 'tasks_dropped', message: 'Dropped 3', count: 3 },
      { type: 'tasks_dropped', message: 'Dropped 2', count: 2 },
      { type: 'context_truncated', message: 'Other', count: 1 },
    ];
    const result = buildBudgetApplied({
      previousTasksCount: 5,
      truncationEvents,
      droppedTasksHint: 'See earlier tasks',
      budget: { maxTasks: 10, maxSummaryChars: 500, maxContextChars: 2000, maxTotalContextChars: 5000 },
    });

    expect(result.maxTasks).toBe(10);
    expect(result.maxSummaryChars).toBe(500);
    expect(result.maxContextChars).toBe(2000);
    expect(result.maxTotalContextChars).toBe(5000);
    expect(result.tasksIncluded).toBe(5);
    expect(result.tasksDropped).toBe(5); // 3 + 2
    expect(result.droppedTasksHint).toBe('See earlier tasks');
  });

  it('returns 0 tasksDropped when no tasks_dropped events', () => {
    const result = buildBudgetApplied({
      previousTasksCount: 3,
      truncationEvents: [],
      budget: { maxTasks: 10, maxSummaryChars: 500, maxContextChars: 2000, maxTotalContextChars: 5000 },
    });
    expect(result.tasksDropped).toBe(0);
    expect(result.droppedTasksHint).toBeUndefined();
  });
});

describe('buildCommitReport', () => {
  it('builds report for completed worktree task with diff', () => {
    const report = buildCommitReport({
      task: '01-my-task',
      feature: 'cool-feature',
      workflowPath: 'standard',
      status: 'completed',
      commitSha: 'abc123',
      summary: 'Did the thing',
      workspaceMode: 'worktree',
      diff: { hasDiff: true, filesChanged: ['a.ts', 'b.ts'], insertions: 10, deletions: 5 },
    });

    expect(report).toContain('# Task Report: 01-my-task');
    expect(report).toContain('**Feature:** cool-feature');
    expect(report).toContain('**Workflow Path:** standard');
    expect(report).toContain('**Status:** success');
    expect(report).toContain('**Commit:** abc123');
    expect(report).toContain('Did the thing');
    expect(report).toContain('**Files changed:** 2');
    expect(report).toContain('+10');
    expect(report).toContain('-5');
    expect(report).toContain('`a.ts`');
    expect(report).toContain('`b.ts`');
  });

  it('builds report for direct mode task', () => {
    const report = buildCommitReport({
      task: '01-task',
      feature: 'feat',
      workflowPath: 'standard',
      status: 'completed',
      commitSha: '',
      summary: 'Done',
      workspaceMode: 'direct',
      workspacePath: '/project/root',
      diff: { hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 },
    });

    expect(report).toContain('**Mode:** direct');
    expect(report).toContain('/project/root');
    expect(report).toContain('no isolated branch or worktree');
    expect(report).toContain('Direct-mode execution');
  });

  it('builds report for task with no diff', () => {
    const report = buildCommitReport({
      task: '01-task',
      feature: 'feat',
      workflowPath: 'standard',
      status: 'completed',
      commitSha: 'sha1',
      summary: 'No changes',
      workspaceMode: 'worktree',
      diff: { hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 },
    });

    expect(report).toContain('No file changes detected');
    expect(report).not.toContain('Files Modified');
  });

  it('maps completed status to success label', () => {
    const report = buildCommitReport({
      task: '01-task',
      feature: 'feat',
      workflowPath: 'standard',
      status: 'completed',
      commitSha: '',
      summary: 'x',
      workspaceMode: 'worktree',
      diff: { hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 },
    });
    expect(report).toContain('**Status:** success');
  });

  it('preserves non-completed status labels', () => {
    const report = buildCommitReport({
      task: '01-task',
      feature: 'feat',
      workflowPath: 'standard',
      status: 'partial',
      commitSha: '',
      summary: 'x',
      workspaceMode: 'worktree',
      diff: { hasDiff: false, filesChanged: [], insertions: 0, deletions: 0 },
    });
    expect(report).toContain('**Status:** partial');
  });
});

describe('formatBlockedResponse', () => {
  it('formats blocked response for worktree mode', () => {
    const result = formatBlockedResponse({
      task: '01-task',
      summary: 'Stuck on config',
      blocker: { reason: 'Need credentials' },
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt/path',
      branch: 'task-branch',
    });

    expect(result.ok).toBe(true);
    expect(result.terminal).toBe(true);
    expect(result.status).toBe('blocked');
    expect(result.task).toBe('01-task');
    expect(result.summary).toBe('Stuck on config');
    expect(result.blocker).toEqual({ reason: 'Need credentials' });
    expect(result.workspaceMode).toBe('worktree');
    expect(result.workspacePath).toBe('/tmp/wt/path');
    expect(result.branch).toBe('task-branch');
    expect(result.message).toContain('warcraft_worktree_create');
  });

  it('formats blocked response for direct mode', () => {
    const result = formatBlockedResponse({
      task: '01-task',
      summary: 'Stuck',
      blocker: { reason: 'x' },
      workspaceMode: 'direct',
      workspacePath: '/project',
    });

    expect(result.workspaceMode).toBe('direct');
    expect(result.workspacePath).toBe('/project');
    expect(result.branch).toBeUndefined();
    expect(result.message).toContain('direct mode');
  });
});

describe('buildTerminalCommitResult', () => {
  it('builds completed worktree result', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'completed',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'task-branch',
      verificationModel: 'tdd',
      missingGatesForWarn: [],
    });

    expect(result.ok).toBe(true);
    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.task).toBe('01-task');
    expect(result.workspaceMode).toBe('worktree');
    expect(result.workspacePath).toBe('/tmp/wt');
    expect(result.branch).toBe('task-branch');
    expect(result.message).toContain('committed to branch');
    expect(result.message).toContain('warcraft_merge');
    expect(result.verificationDeferred).toBeUndefined();
  });

  it('builds completed direct mode result', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'completed',
      workspaceMode: 'direct',
      workspacePath: '/project',
      verificationModel: 'tdd',
      missingGatesForWarn: [],
    });

    expect(result.branch).toBeUndefined();
    expect(result.message).toContain('direct mode');
    expect(result.message).toContain('/project');
  });

  it('adds verificationDeferred for best-effort completed tasks', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'completed',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'branch',
      verificationModel: 'best-effort',
      missingGatesForWarn: [],
    });

    expect(result.verificationDeferred).toBe(true);
    expect(result.deferredTo).toBe('orchestrator');
  });

  it('does not add verificationDeferred for non-completed status', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'partial',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'branch',
      verificationModel: 'best-effort',
      missingGatesForWarn: [],
    });

    expect(result.verificationDeferred).toBeUndefined();
  });

  it('adds verificationNote for missing gates in warn mode', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'completed',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'branch',
      verificationModel: 'tdd',
      missingGatesForWarn: ['build', 'lint'],
    });

    expect(result.verificationNote).toContain('build');
    expect(result.verificationNote).toContain('lint');
    expect(result.verificationNote).toContain('Missing evidence');
  });

  it('maps done back to completed in status field', () => {
    // 'completed' input status goes through finalStatus='done' internally,
    // but the response should say 'completed'
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'completed',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'b',
      verificationModel: 'tdd',
      missingGatesForWarn: [],
    });
    expect(result.status).toBe('completed');
  });

  it('preserves non-completed status values', () => {
    const result = buildTerminalCommitResult({
      task: '01-task',
      status: 'failed',
      workspaceMode: 'worktree',
      workspacePath: '/tmp/wt',
      branch: 'b',
      verificationModel: 'tdd',
      missingGatesForWarn: [],
    });
    expect(result.status).toBe('failed');
  });
});
