/**
 * Worker prompt builder for Warcraft delegated execution.
 * Builds context-rich prompts for worker agents with all Warcraft context.
 */

import type { TaskComplexity } from './task-complexity.js';

export interface WorkerContextFile {
  name: string;
  content: string;
}

export interface CompletedTask {
  name: string;
  summary: string;
  /** Learnings surfaced by the worker upon task completion (done tasks only). */
  learnings?: string[];
}

export interface ContinueFromBlocked {
  status: 'blocked';
  previousSummary: string;
  decision: string;
}

export interface WorkerPromptParams {
  feature: string;
  task: string;
  taskOrder: number;
  workspacePath: string;
  workspaceMode: 'worktree' | 'direct';
  branch?: string;
  plan: string;
  contextFiles: WorkerContextFile[];
  spec: string;
  previousTasks?: CompletedTask[];
  continueFrom?: ContinueFromBlocked;
  verificationModel?: 'tdd' | 'best-effort';
  /** Task complexity level for prompt mode selection. Defaults to 'standard'. */
  complexity?: TaskComplexity;
  /** Prior-attempt context injected when previousAttempts > 0. */
  failureContext?: string;
}

/**
 * Build a context-rich prompt for a worker agent.
 *
 * Includes:
 * - Assignment details (feature, task, workspace, branch)
 * - Mission (spec) - contains plan section, context, and completed tasks
 * - Blocker protocol (NOT question tool)
 * - Completion protocol
 *
 * NOTE: Plan, context files, and previous tasks are NOT included separately
 * because they are already embedded in the spec. This prevents duplication
 * and keeps the prompt size bounded.
 */
export function buildWorkerPrompt(params: WorkerPromptParams): string {
  const {
    feature,
    task,
    taskOrder,
    workspacePath,
    workspaceMode,
    branch,
    // plan, contextFiles, previousTasks - NOT used separately (embedded in spec)
    spec,
    continueFrom,
    verificationModel = 'tdd',
    complexity = 'standard',
    failureContext,
  } = params;

  const continuationLocation =
    workspaceMode === 'worktree'
      ? "The worktree already contains the previous worker's progress."
      : "The project root already contains the previous worker's progress.";
  const continuationSection = continueFrom
    ? `
## Continuation from Blocked State

Previous worker was blocked and exited. Here's the context:

**Previous Progress**: ${continueFrom.previousSummary}

**User Decision**: ${continueFrom.decision}

Continue from where the previous worker left off, incorporating the user's decision.
${continuationLocation}
`
    : '';

  const failureContextBlock = failureContext
    ? `
## Previous Attempt Context

This task has been attempted before. Key context from the previous attempt:
${failureContext}
Avoid repeating the same approach if it led to the failure above.
`
    : '';

  let complexityGuidance = '';
  if (complexity === 'trivial') {
    complexityGuidance = `
## Execution Guidance

Read spec → Implement → Verify → Commit. Follow references for patterns.
`;
  } else if (complexity === 'complex') {
    complexityGuidance = `
## Complex Task Guidance

This is a complex task. Break implementation into smaller verified steps.
- Verify each step compiles/passes before moving to the next.
- Commit intermediate progress if blocked or if a logical milestone is reached.
- Re-read the spec after each step to avoid drift.
`;
  }

  const executionPreamble =
    workspaceMode === 'worktree'
      ? 'You are a worker agent executing a task in an isolated git worktree.'
      : 'You are a worker agent executing a task directly in the project root (direct mode, no git worktree isolation).';
  const branchRow = workspaceMode === 'worktree' ? `| Branch | ${branch} |` : '| Branch | n/a (direct mode) |';
  const workspaceRestriction =
    workspaceMode === 'worktree'
      ? `**CRITICAL**: All file operations MUST be within this worktree path:\n\`${workspacePath}\`\n\nDo NOT modify files outside this directory.`
      : `**CRITICAL**: All file operations happen directly in the project root:\n\`${workspacePath}\`\n\nDo NOT claim isolation, and do NOT claim a separate git branch or worktree exists for this task.`;

  return `# Warcraft Worker Assignment

${executionPreamble}

## Assignment Details

| Field | Value |
|-------|-------|
| Feature | ${feature} |
| Task | ${task} |
| Task # | ${taskOrder} |
| Workspace Mode | ${workspaceMode} |
${branchRow}
| Workspace | ${workspacePath} |

${workspaceRestriction}
${continuationSection}${failureContextBlock}${complexityGuidance}
---

## Your Mission

${spec}

---

## Pre-implementation Checklist

Before writing code, confirm:
1. Dependencies are satisfied and required context is present.
2. The exact files/sections to touch (from references) are identified.
${verificationModel === 'tdd' ? '3. The first failing test to write is clear (TDD).' : ''}
${verificationModel === 'tdd' ? '4. The minimal change needed to reach green is planned.' : ''}

---

## Blocker Protocol

If you hit a blocker requiring human decision, **DO NOT** use the question tool directly.
Instead, escalate via the blocker protocol:

1. **Save your progress** to the workspace (commit if appropriate)
2. **Call warcraft_worktree_commit** with blocker info:

\`\`\`
warcraft_worktree_commit({
  task: "${task}",
  feature: "${feature}",
  status: "blocked",
  summary: "What you accomplished so far",
  blocker: {
    reason: "Why you're blocked - be specific",
    options: ["Option A", "Option B", "Option C"],
    recommendation: "Your suggested choice with reasoning",
    context: "Relevant background the user needs to decide"
  }
})
\`\`\`

**After calling warcraft_worktree_commit with blocked status, STOP IMMEDIATELY.**

The Warcraft Master will:
1. Receive your blocker info
2. Ask the user via question()
3. Spawn a NEW worker to continue with the decision

This keeps the user focused on ONE conversation (Warcraft Master) instead of multiple worker panes.

---

## Completion Protocol

When your task is **fully complete**:

\`\`\`
warcraft_worktree_commit({
  task: "${task}",
  feature: "${feature}",
  status: "completed",
  summary: "Concise summary of what you accomplished"
})
\`\`\`

**CRITICAL: After calling warcraft_worktree_commit, you MUST STOP IMMEDIATELY.**
Do NOT continue working. Do NOT respond further. Your session is DONE.
The Warcraft Master will take over from here.

**Summary Guidance** (used verbatim for downstream task context):
1. Start with **what changed** (files/areas touched).
2. Mention **why** if it affects future tasks.
3. Note **verification evidence** (tests/build/lint) or explicitly say "Not run".
4. Keep it **2-4 sentences** max.

If you encounter an **unrecoverable error**:

\`\`\`
warcraft_worktree_commit({
  task: "${task}",
  feature: "${feature}",
  status: "failed",
  summary: "What went wrong and what was attempted"
})
\`\`\`

If you made **partial progress** but can't continue:

\`\`\`
warcraft_worktree_commit({
  task: "${task}",
  feature: "${feature}",
  status: "partial",
  summary: "What was completed and what remains"
})
\`\`\`

---
${
  verificationModel === 'tdd'
    ? `## TDD Protocol (Required)

1. **Red**: Write failing test first
2. **Green**: Minimal code to pass
3. **Refactor**: Clean up, keep tests green

Never write implementation before test exists.
Exception: Pure refactoring of existing tested code.

`
    : ''
}## Debugging Protocol (When stuck)

1. **Reproduce**: Get consistent failure
2. **Isolate**: Binary search to find cause
3. **Hypothesize**: Form theory, test it
4. **Fix**: Minimal change that resolves

After 3 failed attempts at same fix: STOP and report blocker.

---

## Tool Access

**You have access to:**
- All standard tools (read, write, edit, bash, glob, grep)
- \`warcraft_worktree_commit\` - Signal task done/blocked/failed
- \`warcraft_plan_read\` - Re-read plan if needed
- \`warcraft_context_write\` - Save learnings for future tasks
- \`warcraft_skill\` - Load skill guidance when a task matches a skill description

**You do NOT have access to (or should not use):**
- \`question\` - Escalate via blocker protocol instead
- \`warcraft_worktree_create\` - No spawning sub-workers
- \`warcraft_worktree_discard\` - Only Warcraft Master can discard; use warcraft_worktree_commit with status "failed" or "partial" instead
- \`warcraft_merge\` - Only Warcraft Master merges
- \`task\` - No recursive delegation

---

## Guidelines

1. **Work methodically** - Break down the mission into steps
2. **Stay in scope** - Only do what the spec asks
3. **Escalate blockers** - Don't guess on important decisions
4. **Save context** - Use warcraft_context_write for discoveries
5. **Complete cleanly** - Always call warcraft_worktree_commit when done

Begin your task now.
`;
}
