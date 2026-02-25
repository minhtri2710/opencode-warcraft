---
name: warcraft
description: Plan-first AI development with isolated git worktrees and human review. Use for any feature development.
---

# Warcraft Workflow

Plan-first development: Plan → Approve → Execute.

## Agent Modes

Warcraft has two agent modes, configured via `agentMode` in `~/.config/opencode/opencode_warcraft.json`:

### Unified Mode (default)

```
Khadgar (Hybrid) — plans AND orchestrates
  ├→ Brann (Explorer/Researcher)
  ├→ Mekkatorque (Worker/Coder)
  └→ Algalon (Consultant/Reviewer)
```

| Agent          | Mode     | Use                                |
| -------------- | -------- | ---------------------------------- |
| `@khadgar`     | Primary  | Discovery + planning + orchestration |
| `@brann`       | Subagent | Exploration/research/retrieval     |
| `@mekkatorque` | Subagent | Executes tasks in worktrees        |
| `@algalon`     | Subagent | Plan/code quality review           |

### Dedicated Mode

```
Mimiron (Planner) → Saurfang (Orchestrator)
                         ├→ Brann (Explorer/Researcher)
                         ├→ Mekkatorque (Worker/Coder)
                         └→ Algalon (Consultant/Reviewer)
```

| Agent          | Mode     | Use                                |
| -------------- | -------- | ---------------------------------- |
| `@mimiron`     | Primary  | Discovery + planning (never executes) |
| `@saurfang`    | Primary  | Orchestration (delegates, verifies, merges) |
| `@brann`       | Subagent | Exploration/research/retrieval     |
| `@mekkatorque` | Subagent | Executes tasks in worktrees        |
| `@algalon`     | Subagent | Plan/code quality review           |

---

## Research Delegation (MCP + Skill + Parallel Exploration)

Use MCP tools for focused research; for multi-domain exploration, use parallel Brann fan-out.

| Tool                        | Use For                                |
| --------------------------- | -------------------------------------- |
| `grep_app_searchGitHub`     | Find code in OSS repos                 |
| `context7_query-docs`       | Library documentation                  |
| `websearch_web_search_exa`  | Web search and scraping                |
| `warcraft_skill("ast-grep")` | AST-aware search workflow              |
| `task()`                    | Parallel exploration via Brann fan-out |

For exploratory fan-out, load `warcraft_skill("parallel-exploration")` for the full playbook.

---

## Intent Classification (Do First)

| Intent         | Signals                   | Action                                     |
| -------------- | ------------------------- | ------------------------------------------ |
| **Trivial**    | Single file, <10 lines    | Do directly. No feature.                   |
| **Simple**     | 1-2 files, <30 min        | Quick questions → light plan or just do it |
| **Complex**    | 3+ files, needs review    | Full feature workflow                      |
| **Refactor**   | "refactor", existing code | Safety: tests, rollback, blast radius      |
| **Greenfield** | New feature, "build new"  | Discovery: find patterns first             |

**Don't over-plan trivial tasks.**

---

## Lifecycle

```
Classify Intent → Discovery → Plan → Review → Execute → Merge
                      ↑                           │
                      └───────── replan ──────────┘
```

---

## Phase 1: Discovery

### Research First (Greenfield/Complex)

For parallel exploration, load `warcraft_skill("parallel-exploration")`.

### Question Tool

```json
{
  "questions": [
    {
      "question": "What authentication should we use?",
      "header": "Auth Strategy",
      "options": [
        { "label": "JWT", "description": "Token-based, stateless" },
        { "label": "Session", "description": "Cookie-based, server state" }
      ]
    }
  ]
}
```

### Self-Clearance Check

After each exchange:

```
□ Core objective clear?
□ Scope boundaries defined?
□ No critical ambiguities?
□ Technical approach decided?

ALL YES → Write plan
ANY NO → Ask the unclear thing
```

---

## Phase 2: Plan

### Create Feature

```
warcraft_feature_create({ name: "feature-name" })
```

### Save Context

```
warcraft_context_write({
  name: "research",
  content: "# Findings\n- Pattern at src/lib/auth:45-78..."
})
```

### Write Plan

```
warcraft_plan_write({ content: "..." })
```

### Plan Structure (REQUIRED)

```markdown
# {Feature Title}

## Discovery

### Original Request

- "{User's exact words}"

### Interview Summary

- {Point}: {Decision}

### Research Findings

- `{file:lines}`: {Finding}

---

## Non-Goals (What we're NOT building)

- {Explicit exclusion}

## Ghost Diffs (Alternatives Rejected)

- {Approach}: {Why rejected}

---

## Tasks

### 1. {Task Title}

**Depends on**: none

**What to do**:

- {Implementation step}

**Must NOT do**:

- {Task guardrail}

**References**:

- `{file:lines}` — {WHY this reference}

**Acceptance Criteria**:

- [ ] {Verifiable outcome}
- [ ] Run: `{command}` → {expected}

---

## Success Criteria

- [ ] {Final checklist}
```

### Key Sections

| Section                 | Purpose                                  |
| ----------------------- | ---------------------------------------- |
| **Discovery**           | Ground plan in user words + research     |
| **Non-Goals**           | Prevents scope creep                     |
| **Ghost Diffs**         | Prevents re-proposing rejected solutions |
| **References**          | File:line citations with WHY             |
| **Must NOT do**         | Task-level guardrails                    |
| **Acceptance Criteria** | Verifiable conditions                    |
| **Depends on**          | Task execution order (optional)          |

### Task Dependencies

The `**Depends on**:` annotation declares which tasks must complete before a task can start.

| Syntax                 | Meaning                                              |
| ---------------------- | ---------------------------------------------------- |
| `**Depends on**: none` | No dependencies — can run immediately or in parallel |
| `**Depends on**: 1`    | Depends on task 1                                    |
| `**Depends on**: 1, 3` | Depends on tasks 1 and 3                             |
| _(omitted)_            | Implicit sequential — depends on previous task (N-1) |

**Default behavior**: When no `**Depends on**:` annotation is present, the task implicitly depends on the previous task (task N depends on task N-1). This preserves backwards compatibility with existing plans.

**Example**:

```markdown
### 1. Set up database schema

**Depends on**: none
...

### 2. Create API endpoints

**Depends on**: 1
...

### 3. Add authentication

**Depends on**: 1
...

### 4. Build UI components

**Depends on**: 2, 3
...
```

In this example, tasks 2 and 3 can run in parallel (both only depend on 1), while task 4 waits for both.

---

## Phase 3: Review

1. User reviews `plan.md`
2. Check comments: `warcraft_plan_read()`
3. Revise if needed
4. User approves via: `warcraft_plan_approve()`

---

## Phase 4: Execute

### Sync Tasks

```
warcraft_tasks_sync()
```

### Single Task Execution

`warcraft_worktree_create` creates the worktree and returns delegation instructions with `delegationRequired: true` and a `taskToolCall` object:

```
warcraft_worktree_create({ task: "01-task-name" })
  → returns { delegationRequired: true, taskToolCall: { subagent_type, description, prompt } }

task({
  subagent_type: "mekkatorque",
  description: "Warcraft: 01-task-name",
  prompt: <from taskToolCall.prompt>
})
  → [Mekkatorque implements in worktree]

warcraft_worktree_commit({ task: "01-task-name", summary: "...", status: "completed" })
  → warcraft_merge({ task: "01-task-name", strategy: "squash" })
```

### Parallel Batch Execution

Use `warcraft_batch_execute` to dispatch multiple independent tasks:

1. `warcraft_batch_execute({ mode: "preview" })` — See runnable tasks
2. Present to user, confirm which to run
3. `warcraft_batch_execute({ mode: "execute", tasks: ["01-...", "02-..."] })` — Dispatch
4. Issue ALL returned `task()` calls in the SAME assistant message for true parallelism
5. After all workers return, call `warcraft_status()` and repeat for the next batch

When multiple tasks are runnable, ask the operator:

```json
{
  "questions": [
    {
      "question": "Multiple tasks are ready. How should we proceed?",
      "header": "Parallel Execution",
      "options": [
        {
          "label": "Parallel",
          "description": "Run all ready tasks simultaneously"
        },
        {
          "label": "Sequential",
          "description": "Run one at a time for easier review"
        },
        { "label": "Pick", "description": "Let me choose which to run" }
      ]
    }
  ]
}
```

---

## Blocker Handling

When worker returns `status: 'blocked'`:

### Quick Decision (No Plan Change)

1. `warcraft_status()` - get details
2. Ask user via question tool
3. Resume: `warcraft_worktree_create({ task, continueFrom: "blocked", decision: "..." })`

### Plan Gap Detected

If blocker suggests plan is incomplete:

```json
{
  "questions": [
    {
      "question": "This suggests our plan may need revision. How proceed?",
      "header": "Plan Gap Detected",
      "options": [
        { "label": "Revise Plan", "description": "Go back to planning" },
        { "label": "Quick Fix", "description": "Handle as one-off" },
        { "label": "Abort Feature", "description": "Stop entirely" }
      ]
    }
  ]
}
```

If "Revise Plan":

1. `warcraft_worktree_discard({ task })`
2. `warcraft_context_write({ name: "learnings", content: "..." })`
3. `warcraft_plan_write({ content: "..." })` (updated plan)
4. Wait for re-approval

---

## Tool Reference

| Phase     | Tool                                                       | Purpose                                    |
| --------- | ---------------------------------------------------------- | ------------------------------------------ |
| Discovery | `grep_app_searchGitHub` / `context7_query-docs` / `task()` | Research delegation (parallel exploration) |
| Plan      | `warcraft_feature_create`                                  | Start feature                              |
| Plan      | `warcraft_context_write`                                   | Save research                              |
| Plan      | `warcraft_plan_write`                                      | Write plan                                 |
| Plan      | `warcraft_plan_read`                                       | Check comments                             |
| Plan      | `warcraft_plan_approve`                                    | Approve plan                               |
| Execute   | `warcraft_tasks_sync`                                      | Generate tasks                             |
| Execute   | `warcraft_task_create`                                     | Create ad-hoc task                         |
| Execute   | `warcraft_task_update`                                     | Update task status                         |
| Execute   | `warcraft_worktree_create`                                 | Create worktree + delegation instructions  |
| Execute   | `warcraft_worktree_commit`                                 | Finish task                                |
| Execute   | `warcraft_worktree_discard`                                | Discard task                               |
| Execute   | `warcraft_merge`                                           | Integrate task branch                      |
| Execute   | `warcraft_batch_execute`                                   | Parallel task dispatch                     |
| Execute   | `warcraft_status`                                          | Check workers/blockers                     |
| Complete  | `warcraft_feature_complete`                                | Mark done                                  |
| Any       | `warcraft_skill`                                           | Load skill on demand                       |
| Any       | `warcraft_agents_md`                                       | Sync/init AGENTS.md                        |

---

## Iron Laws

**Never:**

- Plan without discovery
- Execute without approval
- Complete without verification
- Assume when uncertain - ASK
- Force through blockers that suggest plan gaps

**Always:**

- Match effort to complexity
- Include file:line references with WHY
- Define Non-Goals and Must NOT guardrails
- Provide verification commands
- Offer replan when blockers suggest gaps

---

## Error Recovery

### Task Failed

```
warcraft_worktree_discard({ task })  # Discard
warcraft_worktree_create({ task })   # Fresh start
```

### After 3 Failures

1. Stop all workers
2. Delegate to Algalon: `task({ subagent_type: "algalon", prompt: "Analyze failure pattern..." })`
3. Ask user how to proceed

### Merge Conflicts

1. Resolve in worktree
2. Commit resolution
3. `warcraft_merge` again
