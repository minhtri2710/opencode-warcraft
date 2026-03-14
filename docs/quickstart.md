# Quickstart

Get a feature from idea to merged code in under 10 minutes.

## Prerequisites

- [Bun](https://bun.sh) 1.3.9+
- Git
- OpenCode with `opencode-warcraft` plugin installed
- Optional: `br` (beads_rust CLI) for bead-native task tracking

## Install

```bash
npm install opencode-warcraft
```

Add to your OpenCode config (`opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-warcraft"]
}
```

## End-to-End Workflow

### 1. Create a Feature

```
warcraft_feature_create({ name: "user-auth" })
```

This creates the feature directory under `.beads/artifacts/user-auth/` (beads mode on) or `docs/user-auth/` (beads mode off) and sets it as the active feature.

### 2. Write a Plan

```
warcraft_plan_write({ content: "# User Auth\n\n## Discovery\n..." })
```

Plans must include a `## Discovery` section. See [Plan Authoring Guide](plan-authoring.md) for the full format.

### 3. Review and Comment

Open `plan.md` in your editor. Add inline comments:

```markdown
<!-- comment: This should use JWT, not sessions -->
```

The agent reads comments via `warcraft_plan_read` and revises the plan.

### 4. Approve the Plan

```
warcraft_plan_approve()
```

Approval stores a SHA-256 hash of the plan content. If you edit the plan after approval, the approval is automatically invalidated and you must re-approve.

### 5. Generate Tasks

```
warcraft_tasks_sync()
```

Parses `### N. Task Name` headers from the plan and creates task folders. Dependencies declared as `**Depends on**: 1, 3` are validated; cycles are rejected.

### 6. Execute Tasks

**Single task:**
```
warcraft_worktree_create({ task: "01-setup-database" })
```

Creates an isolated git worktree and spawns a Mekkatorque (worker) agent to execute the task.

**Parallel batch:**
```
warcraft_batch_execute({ mode: "preview" })    // See what's runnable
warcraft_batch_execute({ mode: "execute", tasks: ["01-setup", "02-api"] })
```

Workers execute in isolated worktrees with no shared state. Each calls `warcraft_worktree_commit` when done.

### 7. Monitor Progress

```
warcraft_status()
```

Returns a JSON snapshot with feature status, task states, runnable tasks, blocked dependencies, and summary counts.

### 8. Merge Completed Tasks

```
warcraft_merge({ task: "01-setup-database" })
```

Merges the task branch into the main branch. Supports `merge`, `squash`, and `rebase` strategies. Use `verify: true` to run build and tests after merge:

```
warcraft_merge({ task: "01-setup-database", verify: true })
```

### 9. Complete the Feature

```
warcraft_feature_complete()
```

Marks the feature as completed (may be auto-reopened if task statuses change).

## Verification Semantics

Workers must provide evidence of passing build, test, and lint in their commit summary. The system enforces this via completion gates:

| `verificationModel` | `workflowGatesMode` | Behavior |
|---------------------|---------------------|----------|
| `tdd` (default) | `enforce` | Blocks commit if evidence missing. Returns `needs_verification`. |
| `tdd` | `warn` (default) | Proceeds but includes `verificationNote` about missing gates. |
| `best-effort` | (any) | Skips gate checks. Returns `verificationDeferred: true`. |

## Configuration

User config lives at `~/.config/opencode/opencode_warcraft.json`:

```json
{
  "beadsMode": "on",
  "agentMode": "unified",
  "verificationModel": "tdd",
  "workflowGatesMode": "warn",
  "parallelExecution": {
    "strategy": "unbounded",
    "maxConcurrency": 4
  },
  "agents": {
    "khadgar": { "model": "openai/gpt-5.3-codex" },
    "mekkatorque": { "model": "kimi-for-coding/k2p5" }
  }
}
```

Key settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `beadsMode` | `"on"` | Bead artifacts are canonical (`on`) or local files are authoritative (`off`) |
| `agentMode` | `"unified"` | `unified` uses Khadgar as hybrid; `dedicated` separates Mimiron (planner) and Saurfang (orchestrator) |
| `verificationModel` | `"tdd"` | `tdd` enforces build/test/lint evidence; `best-effort` defers verification |
| `workflowGatesMode` | `"warn"` | `enforce` blocks on missing evidence; `warn` proceeds with a note |
| `sandbox` | `"none"` | `"docker"` runs worker commands inside containers |

## Next Steps

- [Plan Authoring Guide](plan-authoring.md) -- How to write effective plans
- [Troubleshooting](troubleshooting.md) -- Common issues and recovery patterns
- [WARCRAFT-TOOLS.md](../packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md) -- Full tool reference
- [DATA-MODEL.md](../packages/opencode-warcraft/docs/DATA-MODEL.md) -- Data model and artifact layout
