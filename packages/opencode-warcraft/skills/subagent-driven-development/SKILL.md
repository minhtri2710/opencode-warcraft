---
name: subagent-driven-development
description: Use when executing an approved multi-task plan in the current session with fresh worker context per task.
---

# Subagent-Driven Development

## Overview

Execute one approved task at a time with isolated worktrees and review gates.

Core principle: fresh worker per task + explicit review before merge.

## Preconditions

- Plan is approved
- Tasks are synced
- Runnable tasks are known (`warcraft_status`)

## Per-Task Loop

1. Select next runnable task
2. Start execution with `warcraft_worktree_create`
3. Delegate implementation to worker subagent
4. Require task-level verification evidence
5. Run review pass (Algalon/reviewer)
6. Apply fixes and re-verify
7. Finalize via `warcraft_worktree_commit`
8. Merge (or keep/discard) using finishing workflow

## Dispatch Guidance

Each worker assignment should include:
- Exact task objective
- File scope constraints
- Acceptance criteria
- Required verification commands

## Quality Gates

Before marking task done:
- Requirements satisfied
- No unresolved critical findings
- Verification command output captured
- Task report updated

## Red Flags

Never:
- Run multiple tasks in parallel when dependencies are unresolved
- Skip review because implementation “seems fine”
- Merge without passing verification evidence
