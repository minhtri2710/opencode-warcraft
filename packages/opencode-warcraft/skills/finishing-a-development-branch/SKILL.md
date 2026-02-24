---
name: finishing-a-development-branch
description: Use when implementation is complete and you need to choose how to integrate, preserve, or discard worktree changes safely.
---

# Finishing a Development Branch

## Overview

Close a task deliberately: verify evidence, choose an integration path, then clean up.

In this project, prefer Warcraft tools over raw git plumbing.

## Preconditions

Before presenting options:
- Task implementation is done in its worktree
- Verification evidence exists (tests/checks run for the touched scope)
- `warcraft_worktree_commit` has been run if code should be preserved

If verification is missing, stop and gather it first.

## Completion Options

Present exactly these options:

1. Merge task branch now (`warcraft_merge`)
2. Keep branch/worktree for later
3. Discard branch/worktree (`warcraft_worktree_discard`)
4. Export branch for PR workflow, merge later

## Execution Guidance

### Option 1 — Merge now
- Run `warcraft_merge` for the task
- Confirm merge result and current branch state

### Option 2 — Keep as-is
- Leave worktree and branch intact
- Report location/status so it can be resumed later

### Option 3 — Discard
- Require explicit confirmation before destructive action
- Run `warcraft_worktree_discard`

### Option 4 — PR workflow
- Keep branch/worktree intact
- Provide evidence summary (what changed + verification commands)
- Merge later after PR review

## Red Flags

Never:
- Merge without verification evidence
- Discard without explicit confirmation
- Hide unresolved failures at handoff

Always:
- State which option was chosen
- State what was merged/kept/discarded
- State any follow-up required
