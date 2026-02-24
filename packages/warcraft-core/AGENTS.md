# warcraft-core Agent Guide

## Package Purpose

`warcraft-core` is the shared domain layer for Project Warcraft.
It owns feature/plan/task/worktree services, path utilities, and shared types used by plugin packages.

## Main Folders

- `src/services/`: core service implementations
  - feature lifecycle (`featureService`)
  - plan lifecycle (`planService`)
  - task lifecycle and dependency handling (`taskService`, `taskDependencyGraph`)
  - worktree lifecycle (`worktreeService`)
  - context/session/config/agents-md services
  - beads integration under `src/services/beads/`
- `src/services/tasks/`: task-domain specific helpers
- `src/utils/`: path resolution and environment/context detection helpers
- `src/types.ts`: shared TypeScript domain types
- `src/index.ts`: package export surface (single entry point)
- `src/__tests__/` and `*.test.ts`: unit tests for services and utilities

## Change Workflow

1. Add or update shared behavior in `src/services/` or `src/utils/`.
2. Keep public API stable; export new contracts via `src/index.ts` when needed.
3. Add focused unit tests next to affected modules.
4. Verify with:
   - `bun run test --filter warcraft-core`
   - `bun run lint`
   - `bun run build`

## Design Rules

- Prefer service-level abstractions over ad-hoc filesystem access.
- Use utilities for path and context resolution instead of manual string concatenation.
- Keep this package plugin-agnostic; runtime/plugin wiring belongs in `opencode-warcraft`.
