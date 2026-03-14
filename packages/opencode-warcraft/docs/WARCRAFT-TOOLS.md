# Warcraft Tools Inventory

## Tools (17 total)

### Feature Management (2 tools)
| Tool | Purpose |
|------|---------|
| `warcraft_feature_create` | Create new feature, set as active |
| `warcraft_feature_complete` | Mark feature completed (may be auto-reopened if task statuses change) |

### Plan Management (3 tools)
| Tool | Purpose |
|------|---------|
| `warcraft_plan_write` | Write plan.md (clears comments) |
| `warcraft_plan_read` | Read plan.md and user comments |
| `warcraft_plan_approve` | Approve plan for execution |

### Task Management (3 tools)
| Tool | Purpose |
|------|---------|
| `warcraft_tasks_sync` | Generate tasks from approved plan (parses ### headers) |
| `warcraft_task_create` | Create manual task (not from plan) |
| `warcraft_task_update` | Update task status or summary |

### Worktree (3 tools)
| Tool | Purpose |
|------|---------|
| `warcraft_worktree_create` | Create worktree and begin work |
| `warcraft_worktree_commit` | Commit changes, write report (does NOT merge) |
| `warcraft_worktree_discard` | Discard changes, reset status |

#### warcraft_worktree_create output

- `taskPromptMode`: prompt transport mode (`opencode-inline`)
- `taskToolCall`: delegated `task()` payload with inline prompt
- `workerPromptPreview`: short preview of the prompt
- `promptMeta`, `payloadMeta`, `budgetApplied`, `warnings`: size and budget observability

### Merge (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_merge` | Integrate a task branch using `merge`/`squash`/`rebase`. Successful results may report a real merge, an already-integrated branch, or no commits to apply. Optional `verify` runs build+test afterward. |

### Batch (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_batch_execute` | Execute multiple task operations in one call |

### Context (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_context_write` | Write context file |

### Status (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_status` | Get comprehensive feature status as JSON |

### AGENTS.md (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_agents_md` | Manage AGENTS.md guidance (read/append/replace mode) |

### Skill (1 tool)
| Tool | Purpose |
|------|---------|
| `warcraft_skill` | Load registered Warcraft skills by ID |

## Key Tool Parameters

### warcraft_merge

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task folder name to merge |
| `strategy` | `merge` \| `squash` \| `rebase` | `merge` | Git merge strategy |
| `feature` | string | (active) | Feature name |
| `verify` | boolean | `false` | Run build and test commands after merge to verify integration |

Successful `warcraft_merge` responses are truthful about what happened. The tool exposes `outcome` with one of `merged`, `already-up-to-date`, or `no-commits-to-apply` on success. Success responses also include the merge `strategy`, resulting `sha`, `filesChanged`, and an empty `conflicts` list.
When `verify: true`, Warcraft runs the project's build and test commands after a successful merge attempt and adds a `verification` payload. `verification.passed: false` means the merge tool still succeeded, but post-merge verification reported degraded results; `verification.output` is included on verification failure. Failure responses remain `toolError` payloads: conflict errors enumerate files in the message, and generic failures return `Merge failed: ...`.

### warcraft_worktree_commit

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `task` | string | required | Task folder name |
| `summary` | string | required | Summary of what was done |
| `status` | `completed` \| `blocked` \| `failed` \| `partial` | `completed` | Task completion status |
| `blocker` | object | (none) | Blocker info (reason, options, recommendation, context) |
| `feature` | string | (active) | Feature name |

**Gate behavior by configuration:**

| `verificationModel` | `workflowGatesMode` | Behavior |
|---------------------|---------------------|----------|
| `tdd` | `enforce` | Blocks commit if build/test/lint evidence missing in summary. Returns `needs_verification`. |
| `tdd` | `warn` | Proceeds with commit but includes `verificationNote` about missing gates. |
| `best-effort` | (any) | Skips gate checks. Returns `verificationDeferred: true`, `deferredTo: "orchestrator"`. |

### warcraft_batch_execute

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `preview` \| `execute` | required | Preview shows runnable tasks; execute dispatches them |
| `tasks` | string[] | (none) | Task folders to execute (required for execute mode) |
| `feature` | string | (active) | Feature name |

**Preview mode** returns: `parallelPolicy`, task summary counts, `runnable` list, `blocked` map, `inProgress` list, `nextAction`.

**Execute mode** returns: `parallelPolicy`, `dispatched` (total/succeeded/failed counts), `taskToolCalls` (delegation payloads), `instructions` (parallel dispatch guidance), `failed` list.

`parallelPolicy` reflects the effective `parallelExecution` config: `{ strategy, maxConcurrency }`.

## Agent Tool Permissions

Each agent has an explicit allowlist of Warcraft tools. Tools not in an agent's allowlist are not registered for that agent.

| Tool | Khadgar | Mimiron | Saurfang | Mekkatorque | Brann | Algalon |
|------|---------|---------|----------|-------------|-------|---------|
| `warcraft_skill` | Yes | Yes | Yes | Yes | Yes | Yes |
| `warcraft_feature_create` | Yes | Yes | Yes | No | No | No |
| `warcraft_feature_complete` | Yes | No | Yes | No | No | No |
| `warcraft_plan_write` | Yes | Yes | No | No | No | No |
| `warcraft_plan_read` | Yes | Yes | Yes | Yes | Yes | Yes |
| `warcraft_plan_approve` | Yes | No | Yes | No | No | No |
| `warcraft_tasks_sync` | Yes | No | Yes | No | No | No |
| `warcraft_task_create` | Yes | No | Yes | No | No | No |
| `warcraft_task_update` | Yes | No | Yes | No | No | No |
| `warcraft_worktree_create` | Yes | No | Yes | No | No | No |
| `warcraft_worktree_commit` | Yes | No | No | Yes | No | No |
| `warcraft_worktree_discard` | Yes | No | Yes | No | No | No |
| `warcraft_merge` | Yes | No | Yes | No | No | No |
| `warcraft_batch_execute` | Yes | No | Yes | No | No | No |
| `warcraft_context_write` | Yes | Yes | Yes | Yes | Yes | Yes |
| `warcraft_status` | Yes | Yes | Yes | No | Yes | Yes |
| `warcraft_agents_md` | Yes | No | Yes | No | No | No |

**Key patterns:**
- **Khadgar** (hybrid): full access to all 17 tools
- **Mimiron** (planner): planning + read-only tools (6 tools)
- **Saurfang** (orchestrator): all except `worktree_commit` and `plan_write` (15 tools)
- **Mekkatorque** (worker): minimal set, commit, read plan, write context, load skills (4 tools)
- **Brann** (explorer) and **Algalon** (reviewer): read-only + context + skills (4 tools each)

## Advanced Configuration

These options control tool behavior at runtime. They are supported by `ConfigService` but are not yet declared in the JSON schema.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `verificationModel` | `'tdd'` \| `'best-effort'` | `'tdd'` | Controls completion gate enforcement in `warcraft_worktree_commit` |
| `workflowGatesMode` | `'enforce'` \| `'warn'` | `'warn'` | Strictness of workflow gates. Also settable via `WARCRAFT_WORKFLOW_GATES_MODE` env var |
| `hook_cadence` | `Record<string, number>` | `1` per hook | Per-hook execution frequency. Safety-critical hooks always run every time |

## Workflow Guardrails

- `warcraft_plan_write`: blocks plans missing substantive `## Discovery`; lightweight path allows shorter discovery but still requires mini-record fields (`Impact`, `Safety`, `Verify`, `Rollback`).
- `warcraft_plan_approve`: blocks unresolved comments; checklist gate runs in warning/enforce mode via `WARCRAFT_WORKFLOW_GATES_MODE`.
- `warcraft_tasks_sync`: lightweight path enforces constrained scope (max 2 tasks + mini-record).
- `warcraft_worktree_commit`: completed status requires build/test/lint pass evidence in summary.
- CI integration should verify `.beads/artifacts` sync drift and PR evidence references.

---

## Removed Tools

| Tool | Reason |
|------|--------|
| `warcraft_subtask_*` (5 tools) | Subtask complexity not needed, use todowrite instead |
| `warcraft_session_*` (2 tools) | Replaced by `warcraft_status` |
| `warcraft_context_read` | Agents can read files directly |
| `warcraft_context_list` | Agents can use glob/Read |

---

## Tool Categories Summary

| Category | Count | Tools |
|----------|-------|-------|
| Feature | 2 | create, complete |
| Plan | 3 | write, read, approve |
| Task | 3 | sync, create, update |
| Worktree | 3 | create, commit, discard |
| Merge | 1 | merge |
| Batch | 1 | batch_execute |
| Context | 1 | write |
| AGENTS.md | 1 | agents_md |
| Status | 1 | status |
| Skill | 1 | skill |
| **Total** | **17** | |
