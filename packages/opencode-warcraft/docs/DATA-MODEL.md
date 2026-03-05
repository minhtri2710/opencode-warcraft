# Warcraft Data Model

## Canonical Layout

```
 <warcraft-root>/
 ├── <feature-name>/
 │   ├── feature.json              # Feature metadata + workflow state cache
 │   ├── plan.md                   # Current implementation plan
 │   ├── context/                  # Persistent context files
 │   │   ├── decisions.md
 │   │   ├── architecture.md
 │   │   └── constraints.md
 │   └── tasks/                    # Task folders (off mode: canonical; on mode: cache)
 │       └── <NN-task-name>/
 │           ├── status.json       # Task state + metadata
 │           ├── spec.md           # Generated worker spec
 │           ├── worker-prompt.md  # Full worker prompt snapshot
 │           └── report.md         # Execution summary
 └── .worktrees/                   # Isolated git worktrees
     └── <feature>/<task>/
```

Notes:
- `warcraft-root` is `.beads/artifacts` in beadsMode `on` and `docs` in beadsMode `off`.
- Feature path is `<warcraft-root>/<feature-name>`.
- In beadsMode `on`, the `tasks/` directory is **not** created at feature creation. Task state lives in bead artifacts; local `tasks/` folders appear as cache when tasks are synced.
- In beadsMode `off`, the `tasks/` directory is created at feature creation and is the canonical source of task state.
- There is no top-level `tasks.json`; task state lives in each `tasks/<task>/status.json` (or bead artifacts in on mode).

## Beads Mode Behavior

- **`beadsMode: "on"`**: bead artifacts are canonical state; local cache lives under `.beads/artifacts/<feature>/`.
- **`beadsMode: "off"`**: local files under `docs/<feature>/` are authoritative.
- Plan approval hash is stored in bead artifact (`plan_approval`) when on, and in `feature.json.planApprovalHash` when off.


## `feature.json` (local cache / local source in off mode)

Typical fields:

```json
{
  "name": "user-auth",
  "epicBeadId": "bd_123",
  "status": "approved",
  "workflowPath": "standard",
  "reviewChecklistVersion": "v1",
  "reviewChecklistCompletedAt": "2026-02-24T09:30:00.000Z",
  "ticket": "PROJ-101",
  "sessionId": "ses_abc123",
  "createdAt": "2026-02-24T08:00:00.000Z",
  "approvedAt": "2026-02-24T09:30:00.000Z",
  "completedAt": null,
  "planApprovalHash": "a3f5c8e2d1b4f6...",
  "planComments": []
}
```

`planApprovalHash` and `planComments` are written by `PlanService` in local (`off`) mode. They are not part of the canonical `FeatureJson` TypeScript type but appear in on-disk `feature.json` files when the plan service manages approval state locally.

## `tasks/<task>/status.json`

```json
{
  "schemaVersion": 1,
  "status": "done",
  "origin": "plan",
  "planTitle": "Implement login",
  "summary": "Login endpoint implemented with JWT",
  "startedAt": "2026-02-24T09:00:00.000Z",
  "completedAt": "2026-02-24T10:30:00.000Z",
  "baseCommit": "abc123",
  "idempotencyKey": "task-01-attempt-1",
  "beadId": "bd_task_456",
  "dependsOn": ["01-setup"],
  "workerSession": {
    "sessionId": "ses_worker_1",
    "mode": "delegate",
    "attempt": 1
  },
  "blocker": {
    "reason": "waiting_on_decision",
    "detail": "Need API auth strategy confirmation"
  }
}
```

### Task status values

- `pending`
- `in_progress`
- `done`
- `cancelled`
- `blocked`
- `failed`
- `partial`

`partial` indicates a task that committed changes but did not fully complete its scope. The orchestrator may re-dispatch or split the remaining work.

### Feature status values

- `planning`
- `approved`
- `executing`
- `completed`

## Dependency Semantics

- `dependsOn` uses task folder names (`01-setup`, `02-core`, ...).
- Only dependency status `done` unblocks downstream tasks.
- If `dependsOn` is omitted, dependency checks use implicit sequential ordering by numeric prefix (`N` depends on `N-1`).
- `warcraft_tasks_sync` validates the dependency graph at sync time. Cycles are rejected with an error listing the involved tasks.
- Dependencies are validated again at dispatch time (`warcraft_worktree_create`, `warcraft_batch_execute`) to ensure no task starts before its dependencies are `done`.

## `warcraft_status` Output

`warcraft_status` returns a JSON snapshot:

```
feature            # feature name, status, workflow metadata
plan               # plan approval state (approved, hash)
tasks.list[]       # task metadata including status, summary, dependsOn
tasks.runnable[]   # task folders ready to start (dependencies met, not in progress)
tasks.blockedBy    # map: task folder -> unmet dependency folders
tasks.summary      # counts: total, done, inProgress, pending, blocked
triage             # (when bv available) blocker analysis and priority hints
```

## Prompt Files

`warcraft_worktree_create` writes `worker-prompt.md` to:

```
<warcraft-root>/<feature>/tasks/<task>/worker-prompt.md
```

Delegation payloads are returned inline (`taskPromptMode: "opencode-inline"`), while the file persists for traceability/recovery.