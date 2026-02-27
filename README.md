# Project Warcraft

Context-driven development for AI coding assistants with a strict plan-first workflow:

1. Plan
2. Review and approve
3. Execute in isolated task worktrees
4. Merge with traceable artifacts

This repository is a Bun workspace monorepo containing shared core services and OpenCode plugin packages.

> Note: This project is forked from [agent-hive](https://github.com/tctinh/agent-hive).

[![npm version](https://img.shields.io/npm/v/opencode-warcraft.svg)](https://www.npmjs.com/package/opencode-warcraft)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](LICENSE)

## Repository Layout

| Path | Purpose |
| --- | --- |
| `packages/warcraft-core/` | Shared domain services, task/plan/worktree logic, filesystem utilities |
| `packages/opencode-warcraft/` | OpenCode plugin (agents, tools, hooks, MCP wiring, built-in skills) |
| `packages/opencode-copilot-auth/` | Internal auth plugin for GitHub Copilot OAuth/device-flow and request header shaping |
| `scripts/` | CI and release verification scripts |
| `.beads/artifacts/` | Beads artifact cache and task execution records |

See also:
- [packages/README.md](packages/README.md)
- [AGENTS.md](AGENTS.md)
- [packages/opencode-warcraft/README.md](packages/opencode-warcraft/README.md)

## Prerequisites

- [Bun](https://bun.sh)
- Git
- Optional: `br` (beads_rust CLI) when running with `beadsMode: "on"` (default)

## Development Setup

```bash
bun install
bun run build
bun run test
bun run lint
```

### Workspace Commands

From the repository root:

```bash
bun run build          # Build all workspace packages
bun run test           # Run all package tests
bun run lint           # Type-check all workspace packages
bun run workflow:verify
bun run release:check
```

## Install the OpenCode Plugin

`opencode-warcraft` is published on npm:

```bash
npm install opencode-warcraft
```

Add plugin config in your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-warcraft"]
}
```

## Core Workflow

Warcraft is designed around:

1. `warcraft_feature_create`
2. `warcraft_plan_write`
3. Human review in `plan.md`
4. `warcraft_plan_approve`
5. `warcraft_tasks_sync`
6. Task execution via `warcraft_worktree_create` / `warcraft_worktree_commit`
7. Integration via `warcraft_merge`

Canonical artifact shape (beads mode on):

```text
.beads/artifacts/<feature>/
├── feature.json   # bead state cache
├── plan.md
└── context/
```

In beads mode `on`, task state lives in bead artifacts. Local `tasks/` folders appear only as cache when tasks are synced.
In beads mode `off`, the layout also includes `tasks/` as the canonical source of task state.

## Available Warcraft Tools (17)

- `warcraft_feature_create`
- `warcraft_feature_complete`
- `warcraft_plan_write`
- `warcraft_plan_read`
- `warcraft_plan_approve`
- `warcraft_tasks_sync`
- `warcraft_task_create`
- `warcraft_task_update`
- `warcraft_worktree_create`
- `warcraft_worktree_commit`
- `warcraft_worktree_discard`
- `warcraft_merge`
- `warcraft_batch_execute`
- `warcraft_context_write`
- `warcraft_agents_md`
- `warcraft_status`
- `warcraft_skill`

## Configuration Notes

Configuration file path:

`~/.config/opencode/opencode_warcraft.json`

Important settings:

- `beadsMode`: `"on"` (default) or `"off"`
  - `on`: bead artifacts are canonical; local `.beads/artifacts/` acts as cache
  - `off`: legacy local `docs/<feature>/` artifacts are canonical
- `disableSkills`: globally disable specific built-in skills
- `disableMcps`: disable MCP integrations (`websearch`, `context7`, `grep_app`)
- `agents.<name>.model`: choose model per agent role
- `agents.<name>.skills`: restrict manual `warcraft_skill` list per agent
- `agents.<name>.autoLoadSkills`: inject skills at session start

### Priority System

Features and tasks support priority `1..5`:

- `1` Critical
- `2` High
- `3` Medium (default)
- `4` Low
- `5` Trivial

In beads mode, Warcraft maps these to `br` priority `0..4` before CLI operations.

## Worktree Troubleshooting

If a task worktree fails with missing modules, either install dependencies in the worktree or run tests from repo root:

```bash
# Inside task worktree
bun install
bun run test

# From repository root
bun run test --filter warcraft-core
```

## Package-Level References

- [packages/warcraft-core/AGENTS.md](packages/warcraft-core/AGENTS.md)
- [packages/opencode-warcraft/AGENTS.md](packages/opencode-warcraft/AGENTS.md)
- [packages/opencode-warcraft/docs](packages/opencode-warcraft/docs)

## License

MIT with Commons Clause. See [LICENSE](LICENSE).
