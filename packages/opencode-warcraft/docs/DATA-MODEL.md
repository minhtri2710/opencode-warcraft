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
 │   └── tasks/                    # Task folders
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
- There is no top-level `tasks.json`; task state lives in each `tasks/<task>/status.json`.

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

`planApprovalHash` and `planComments` are primarily used in local (`off`) mode and for legacy migration fallback paths.

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

### Feature status values

- `planning`
- `approved`
- `executing`
- `completed`

## Dependency Semantics

- `dependsOn` uses task folder names (`01-setup`, `02-core`, ...).
- Only dependency status `done` unblocks downstream tasks.
- If `dependsOn` is omitted, dependency checks use implicit sequential ordering by numeric prefix (`N` depends on `N-1`).

## `warcraft_status` Output

`warcraft_status` returns a JSON snapshot with task readiness fields:

```
tasks.list[]      # task metadata including status, summary, dependsOn
tasks.runnable[]  # task folders ready to start
tasks.blockedBy   # map: task folder -> unmet dependency folders
```

## Prompt Files

`warcraft_worktree_create` writes `worker-prompt.md` to:

```
<warcraft-root>/<feature>/tasks/<task>/worker-prompt.md
```

Delegation payloads are returned inline (`taskPromptMode: "opencode-inline"`), while the file persists for traceability/recovery.