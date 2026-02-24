# Warcraft Tools Inventory

## Tools (17 total)

### Feature Management (2 tools)
| Tool | Purpose |
|------|---------|
| `warcraft_feature_create` | Create new feature, set as active |
| `warcraft_feature_complete` | Mark feature completed (irreversible) |

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
| `warcraft_merge` | Merge task branch (strategies: merge/squash/rebase) |

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
