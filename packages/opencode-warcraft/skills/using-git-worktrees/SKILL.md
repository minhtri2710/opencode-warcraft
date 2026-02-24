---
name: using-git-worktrees
description: Use when starting implementation work that requires isolation from the current branch and reproducible task execution.
---

# Using Git Worktrees

## Overview

In Warcraft, use worktree lifecycle tools rather than manual git worktree commands.

Primary interfaces:
- `warcraft_worktree_create`
- `warcraft_worktree_commit`
- `warcraft_worktree_discard`
- `warcraft_merge`

## Standard Flow

1. Confirm task is runnable (`warcraft_status`)
2. Create isolated worktree (`warcraft_worktree_create`)
3. Implement and verify inside that worktree
4. Commit/report (`warcraft_worktree_commit`)
5. Merge or discard based on outcome

## Why this matters

Warcraft tools keep task state, reports, and branch/worktree metadata in sync. Manual git-only operations can desynchronize artifacts.

## Red Flags

Never:
- Start task work without a worktree
- Bypass Warcraft task status updates
- Merge/discard without reflecting result in Warcraft flow

Always:
- Validate runnable status first
- Capture verification evidence before commit
- Use merge/discard paths deliberately
