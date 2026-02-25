# Packages Guide for AI Agents

This directory contains the two main workspace packages:

- `warcraft-core`: shared domain services and filesystem logic
- `opencode-warcraft`: OpenCode plugin, agent prompts, hooks, and MCP wiring

Use this split when making changes:

1. Put reusable logic in `warcraft-core` first.
2. Keep `opencode-warcraft` focused on plugin integration and runtime behavior.
3. Export shared APIs from `warcraft-core/src/index.ts`.
4. Consume shared APIs from `opencode-warcraft/src/index.ts`.

## Beads Mode Configuration

The `beadsMode` setting in `~/.config/opencode/opencode_warcraft.json` controls how feature state is managed:

### `beadsMode: "on"` (default)
- **Beads-native state**: Beads are the canonical source of truth
- **Local cache still exists**: `.beads/artifacts/<feature>/feature.json` and task files are maintained as read-through cache while bead artifacts stay canonical
- Feature lifecycle and approval state are sourced from bead epics/artifacts via `br` CLI
- Feature creation does not pre-create task status files
- Plan approval stored in bead artifacts with SHA-256 content hash
- Requires `br` CLI installed for full functionality

### `beadsMode: "off"`
- **Legacy local artifacts**: Local files remain authoritative
- Feature creation initializes `docs/<feature>/feature.json`, `docs/<feature>/context/`, and `docs/<feature>/tasks/`; task `status.json` files are created when tasks are generated
- No bead integration; works without `br` CLI
- Plan approval is persisted in `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)

**Migration note**: Legacy values `"dual-write"` and `"beads-primary"` are no longer supported. Use `"on"` or `"off"` (or boolean `true`/`false`).

## Priority System

Features and tasks require a numeric priority (1–5):

| Priority | Level | Description |
|----------|-------|-------------|
| 1 | Critical | Blockers, incidents |
| 2 | High | Important features |
| 3 | Medium | Standard work (default) |
| 4 | Low | Nice-to-have |
| 5 | Trivial | Minor tweaks |

- Must be an integer 1–5
- Default is 3
- Mapped to br priority before CLI calls (`1->0, 2->1, 3->2, 4->3, 5->4`)
- Passed to `br create` via `-p <mapped-priority>`

## Plan Approval and Hash Verification

Plans are approved with SHA-256 content hashing:

- Hash computed at approval time and stored with timestamp
- Plan changes invalidate approval (hash mismatch detected)
- **beadsMode: on**: Stored in bead artifacts (`plan_approval`, `approved_plan`)
- **beadsMode: off**: Stored in `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)

## Agent Mode

`agentMode` controls which agents are registered at runtime:

- **`"unified"`** (default): Khadgar (hybrid planner+orchestrator), Brann, Mekkatorque, Algalon
- **`"dedicated"`**: Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, Algalon

In unified mode, Khadgar is the default agent. In dedicated mode, Mimiron is the default.

## Parallel Execution

`parallelExecution` controls batch task dispatch behavior:

| Setting | Default | Description |
|---------|---------|-------------|
| `strategy` | `"unbounded"` | `"unbounded"` dispatches all tasks at once; `"bounded"` limits concurrency |
| `maxConcurrency` | `4` | Maximum parallel workers when strategy is `"bounded"` |

## Recommended Workflow

1. Identify the package boundary (`core` logic vs plugin runtime).
2. Update code in the correct package.
3. Add or update tests next to touched files.
4. Run package tests first, then workspace checks.

Common commands:

- `bun run test --filter warcraft-core`
- `bun run test --filter opencode-warcraft`
- `bun run lint`
- `bun run build`

## Troubleshooting

### Worktree Dependencies (Module Not Found)

Worktrees are isolated checkouts and do not share the root `node_modules`. If tests or builds fail with "module not found" errors inside a worktree:

```bash
# Option 1: Install dependencies in the worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install
bun run test

# Option 2: Run from repo root (recommended)
cd /path/to/repo/root
bun run test --filter warcraft-core
```
