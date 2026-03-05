---
name: finishing-a-development-branch
description: Use when implementation is complete and you need to decide how to integrate, preserve, or discard worktree changes safely.
---

# Finishing a Development Branch

## Overview

Close a task deliberately: verify evidence, choose an integration path, then clean up.

In this project, prefer Warcraft tools over raw git plumbing.

**Core principle:** Verify evidence → Present options → Execute choice → Confirm final state.

## Preconditions

Before presenting options:
- Task implementation is done in its worktree
- Verification evidence exists (tests/checks run for the touched scope)
- `warcraft_worktree_commit` has been run if code should be preserved

If verification is missing, stop and gather it first.

## Step 1: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge task branch now (`warcraft_merge`)
2. Keep branch/worktree for later
3. Discard branch/worktree (`warcraft_worktree_discard`)
4. Keep branch for PR workflow, merge later

Which option?
```

## Step 2: Execute Choice

### Option 1 — Merge now
- Run `warcraft_merge` for the task
- Confirm merge result and current branch state

### Option 2 — Keep as-is
- Leave worktree and branch intact
- Report location/status so it can be resumed later

### Option 3 — Discard
- Require explicit confirmation before destructive action
- Use this confirmation text:

```
This will permanently delete branch/worktree changes for this task.
Type 'discard' to confirm.
```

- Wait for exact confirmation
- Run `warcraft_worktree_discard`

### Option 4 — PR workflow
- Keep branch/worktree intact
- Provide evidence summary (what changed + verification commands/results)
- Merge later after PR review

## Step 3: Confirm Outcome

Always report:
- Which option was chosen
- What was merged/kept/discarded
- Any follow-up required

## Red Flags

Never:
- Merge without verification evidence
- Discard without explicit confirmation
- Hide unresolved failures at handoff

Always:
- State which option was chosen
- State what was merged/kept/discarded
- State any follow-up required

## Integration

Called by:
- `subagent-driven-development` after all tasks complete
- `executing-plans` after all batches complete

Pairs with:
- `using-git-worktrees` for worktree lifecycle setup/teardown
