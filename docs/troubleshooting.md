# Troubleshooting

Common issues, recovery patterns, and operational playbooks.

## Blocked Workers

### Symptoms

- `warcraft_status()` shows a task with `status: "blocked"`
- Task has a `blocker` field with `reason`, `options`, and `recommendation`

### Recovery

1. Check the blocker details:
   ```
   warcraft_status()
   ```
   Look at `tasks.list[]` for entries with `status: "blocked"` and read their `blocker` field.

2. Make a decision based on the blocker's `options` and `recommendation`.

3. Resume the worker with the decision:
   ```
   warcraft_worktree_create({
     task: "03-blocked-task",
     continueFrom: "blocked",
     decision: "Use approach A because..."
   })
   ```
   A new worker spawns in the same worktree with the previous worker's progress preserved.

### Prevention

- Write clear plan sections with explicit acceptance criteria
- Include `**Must NOT do**` guardrails in task specs
- Provide concrete file references so workers can orient without guessing

## Failed Verification

### Symptoms

- `warcraft_worktree_commit` returns `needs_verification` (in `enforce` mode)
- Worker summary is missing build/test/lint evidence

### Recovery

In `enforce` mode, the commit is blocked until the worker provides verification evidence. The worker must:

1. Run the verification commands (`bun run build`, `bun run test`, `bun run lint`)
2. Include the results in the commit summary
3. Re-attempt `warcraft_worktree_commit`

In `warn` mode (default), the commit proceeds but includes a `verificationNote`. The orchestrator should verify post-merge:

```
warcraft_merge({ task: "01-setup", verify: true })
```

### Switching Verification Modes

Edit `~/.config/opencode/opencode_warcraft.json`:

```json
{
  "verificationModel": "tdd",
  "workflowGatesMode": "enforce"
}
```

| Mode | Behavior |
|------|----------|
| `tdd` + `enforce` | Strictest. Blocks commits without evidence. |
| `tdd` + `warn` | Default. Warns but allows commits. |
| `best-effort` | Skips gate checks entirely. Verification deferred to orchestrator. |

## Worktree Issues

### Missing node_modules in Worktree

Worktrees are isolated git checkouts that do not share `node_modules` with the main repo.

**Fix:**
```bash
# Option 1: Install in the worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install
bun run test

# Option 2: Run tests from repo root (recommended)
bun run test --filter warcraft-core
```

### Stale Worktrees

Over time, completed or abandoned worktrees accumulate. Check for stale worktrees:

```bash
git worktree list
```

`warcraft_status()` surfaces stale-worktree warnings when worktrees exist for tasks that are already `done` or `cancelled`.

### Cleaning Up Worktrees

Worktrees are not automatically removed after task completion. To clean up:

```bash
# See what would be removed (safe, no changes)
git worktree list --porcelain

# Remove a specific worktree
git worktree remove .beads/artifacts/.worktrees/<feature>/<task>

# Prune stale worktree references
git worktree prune
```

### Worktree Creation Fails

If `warcraft_worktree_create` fails:

1. Check the task has `status: "pending"` and all dependencies are `done`
2. Verify the branch doesn't already exist: `git branch -a | grep <task>`
3. Check for leftover worktree: `git worktree list`
4. Clean up if needed: `git worktree remove <path>` then retry

## Plan Approval Issues

### Approval Invalidated After Edit

Plan approval uses SHA-256 content hashing. If you edit the plan after approval, the hash no longer matches and approval is invalidated.

**Fix:** Re-approve with `warcraft_plan_approve()`.

### Unresolved Comments Block Approval

`warcraft_plan_approve` blocks if there are unresolved comments in the plan.

**Fix:** Address all comments, then the agent revises the plan and removes resolved comments before re-approving.

## Task Dependency Problems

### Circular Dependencies Detected

`warcraft_tasks_sync` validates the dependency graph and rejects cycles.

**Fix:** Review plan task dependencies. Ensure no task chain forms a loop (e.g., A depends on B, B depends on C, C depends on A).

### Task Won't Start (Dependencies Not Met)

Dispatch tools (`warcraft_worktree_create`, `warcraft_batch_execute`) validate dependencies at dispatch time.

**Fix:** Check which dependencies are unmet:
```
warcraft_status()
```
Look at `tasks.blockedBy` for a map of task folder to unmet dependency folders. Complete the blocking tasks first.

## Beads Mode Issues

### Switching Between Beads Modes

Changing `beadsMode` between `on` and `off` changes where canonical state lives:

| Mode | Canonical State | Location |
|------|----------------|----------|
| `on` | Bead artifacts | `.beads/artifacts/<feature>/` |
| `off` | Local files | `docs/<feature>/` |

**Caution:** Switching modes mid-feature can cause state inconsistencies. Complete or abandon in-progress features before switching.

### br CLI Not Found

When `beadsMode: "on"`, some operations require the `br` (beads_rust) CLI.

**Fix:**
- Install `br` from the [beads_rust repository](https://github.com/beads-project/beads_rust)
- Or switch to `beadsMode: "off"` in config to use local file storage

## Merge Failures

### Merge Conflicts

When `warcraft_merge` encounters conflicts:

1. Resolve conflicts manually in the task worktree
2. Commit the resolution
3. Re-attempt the merge

### Post-Merge Verification Fails

When `warcraft_merge({ verify: true })` reports `verification.passed: false`:

1. Read `verification.output` for the failure details
2. Fix the issue on the main branch or revert the merge
3. Re-run verification: `bun run build && bun run test && bun run lint`

## Agent Configuration

### Wrong Agent Model

Each agent can use a different model. Update per-agent config:

```json
{
  "agents": {
    "mekkatorque": {
      "model": "kimi-for-coding/k2p5",
      "temperature": 0.4
    }
  }
}
```

### Agent Mode Selection

| Mode | Agents Active |
|------|---------------|
| `unified` (default) | Khadgar (hybrid), Brann, Mekkatorque, Algalon |
| `dedicated` | Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, Algalon |

Switch by setting `agentMode` in config. Use `dedicated` when you want strict separation between planning and execution phases.

## Getting Help

1. Check `warcraft_status()` for current state and suggested next actions
2. Review task `blocker` fields for specific guidance
3. Read context files (`warcraft_context_write` artifacts) for saved decisions and research
4. See the full [tool reference](../packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md)
