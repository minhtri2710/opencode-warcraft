---
title: Simple Feature Lifecycle
tags: lifecycle, smoke, happy-path
expectedTools: warcraft_feature_create, warcraft_plan_write, warcraft_plan_approve, warcraft_tasks_sync, warcraft_worktree_create, warcraft_worktree_commit, warcraft_merge
expectedOutcome: completed
---

# Simple Feature Lifecycle

End-to-end scenario covering the happy-path feature development workflow.

## Setup

1. Fresh git repository with initial commit
2. Warcraft plugin initialized with default config (`beadsMode: "off"`)
3. No existing features or tasks

## Steps

1. **Create feature**: `warcraft_feature_create({ name: "add-search" })`
   - Expect: Feature directory created, feature.json written
   - Expect: Status shows feature "add-search" with no plan

2. **Write plan**: `warcraft_plan_write({ content: "<valid plan with Discovery section>" })`
   - Expect: plan.md written under feature directory
   - Expect: Plan contains task headers (`### 1. ...`)

3. **Approve plan**: `warcraft_plan_approve()`
   - Expect: Approval record with SHA-256 hash stored
   - Expect: Status shows plan as approved

4. **Sync tasks**: `warcraft_tasks_sync()`
   - Expect: Tasks generated from plan headers
   - Expect: Each task has status "pending"
   - Expect: Task dependencies parsed from plan

5. **Create worktree**: `warcraft_worktree_create({ task: "01-first-task" })`
   - Expect: Git worktree created at expected path
   - Expect: Worker agent spawned in worktree
   - Expect: Task status changes to "in_progress"

6. **Worker completes**: `warcraft_worktree_commit({ task: "01-first-task", summary: "Done", status: "completed" })`
   - Expect: Changes committed to task branch
   - Expect: Task status changes to "done"

7. **Merge task**: `warcraft_merge({ task: "01-first-task" })`
   - Expect: Task branch merged into feature branch or main
   - Expect: Dependent tasks become unblocked

## Assertions

- Feature lifecycle completes without errors
- All tool calls return structured success responses
- Task status transitions follow: pending → in_progress → done
- Git history contains the expected commits
- No orphaned worktrees after merge
