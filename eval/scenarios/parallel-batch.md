---
title: Parallel Batch Execution
tags: lifecycle, parallel, batch, orchestration
expectedTools: warcraft_batch_execute, warcraft_worktree_create, warcraft_worktree_commit, warcraft_status
expectedOutcome: completed
---

# Parallel Batch Execution

Scenario covering the parallel batch dispatch workflow where multiple
independent tasks are executed simultaneously by separate workers.

## Setup

1. Feature "redesign-dashboard" exists with approved plan
2. Plan has 4 tasks:
   - "01-create-layout" (no dependencies)
   - "02-build-sidebar" (no dependencies)
   - "03-add-charts" (depends on 01)
   - "04-integrate-api" (depends on 01, 02)
3. All tasks synced and in "pending" state
4. Default config (`beadsMode: "off"`, `verificationModel: "tdd"`)

## Steps

1. **Preview batch**: `warcraft_batch_execute({ mode: "preview" })`
   - Expect: Tasks 01 and 02 shown as runnable (no unsatisfied deps)
   - Expect: Tasks 03 and 04 shown as blocked (dependencies pending)

2. **Execute batch**: `warcraft_batch_execute({ mode: "execute", tasks: ["01-create-layout", "02-build-sidebar"] })`
   - Expect: Returns task() call instructions for both tasks
   - Expect: Both tasks transition to "in_progress"

3. **Parallel worker execution**: Issue both task() calls in same message
   - Expect: Two workers spawned in separate worktrees
   - Expect: Workers execute independently without interference

4. **Workers complete**: Both workers call warcraft_worktree_commit with status "completed"
   - Expect: Both tasks transition to "done"
   - Expect: Worktree changes committed to respective task branches

5. **Check next batch**: `warcraft_status()`
   - Expect: Task 03 now runnable (01 is done)
   - Expect: Task 04 still blocked (needs both 01 AND 02 done)

6. **Complete task 03**: Execute via worktree_create, worker completes
   - Expect: Task 03 transitions pending → in_progress → done

7. **Final status check**: `warcraft_status()`
   - Expect: Task 04 now runnable (all dependencies satisfied)

## Assertions

- Batch preview correctly identifies runnable vs blocked tasks
- Parallel workers do not interfere with each other's worktrees
- Dependency resolution updates correctly as tasks complete
- Task status transitions are atomic and consistent
- No race conditions in status updates during parallel execution
- Batch execute returns correct task() call format for parallel dispatch
- All 4 tasks can complete through iterative batch execution
