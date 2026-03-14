---
title: Blocked Worker Resume
tags: lifecycle, blocked, resume, error-handling
expectedTools: warcraft_worktree_create, warcraft_worktree_commit, warcraft_status
expectedOutcome: completed
---

# Blocked Worker Resume

Scenario covering the worker-blocked-then-resumed workflow where a worker
encounters a blocker, reports it, and the orchestrator resumes with a decision.

## Setup

1. Feature "refactor-auth" exists with approved plan
2. Tasks synced, task "01-extract-middleware" is pending
3. Default config (`beadsMode: "off"`, `verificationModel: "tdd"`)

## Steps

1. **Prepare workspace**: `warcraft_worktree_create({ task: "01-extract-middleware" })`
   - Expect: Workspace prepared, task() delegation payload returned
   - Expect: Task status → "in_progress"

2. **Worker encounters blocker**: Worker calls
   `warcraft_worktree_commit({ task: "01-extract-middleware", status: "blocked", blocker: { reason: "Unclear if auth should use JWT or session tokens", options: ["JWT", "Session"], recommendation: "JWT" } })`
   - Expect: Task status → "blocked"
   - Expect: Blocker metadata stored with reason, options, recommendation

3. **Orchestrator checks status**: `warcraft_status()`
   - Expect: Task shows as "blocked" with blocker details
   - Expect: Blocker reason, options, and recommendation visible

4. **User provides decision**: Orchestrator calls
   `warcraft_worktree_create({ task: "01-extract-middleware", continueFrom: "blocked", decision: "Use JWT" })`
   - Expect: NEW worker launched in SAME workspace via returned task() call
   - Expect: Previous worker's progress preserved
   - Expect: Decision passed to new worker

5. **Resumed worker completes**: Worker calls
   `warcraft_worktree_commit({ task: "01-extract-middleware", summary: "Implemented JWT auth middleware", status: "completed" })`
   - Expect: Task status → "done"
   - Expect: Work finalized

## Assertions

- Task transitions follow: pending → in_progress → blocked → in_progress → done
- Blocker metadata is preserved and accessible via status
- Worker resume creates new worker, does not modify existing commits
- Previous worker's file changes are preserved in the workspace
- Decision text is available to the resumed worker
- No data loss during blocked → resume transition
