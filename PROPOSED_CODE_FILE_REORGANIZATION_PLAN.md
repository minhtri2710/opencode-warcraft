# Proposed Code File Reorganization Plan

## Executive Summary

After an exhaustive analysis of all 168 source files across both packages (`warcraft-core` and `opencode-warcraft`), this document proposes a reorganization focused on **grouping related loose files into domain-specific subdirectories** within `warcraft-core/src/services/`. The `opencode-warcraft/src/` package is already well-organized and requires minimal changes.

The guiding principle is: **a developer or AI agent should be able to intuitively find any module by thinking about what domain it belongs to**, without needing to scan a flat list of files.

---

## Current State Analysis

### Package: `warcraft-core/src/`

```
src/
├── defaults.ts                          ← Config defaults
├── index.ts                             ← Barrel re-exports
├── types.ts                             ← Shared type definitions
├── services/
│   ├── index.ts                         ← Barrel re-exports
│   ├── agentsMdService.ts               ← AGENTS.md management
│   ├── configService.ts                 ← User config management
│   ├── contextService.ts                ← Feature context files
│   ├── dockerSandboxService.ts          ← Docker container isolation
│   ├── event-logger.ts                  ← JSONL event logging
│   ├── featureService.ts                ← Feature CRUD
│   ├── outcomes.ts                      ← OperationOutcome envelope
│   ├── planService.ts                   ← Plan read/write/approve
│   ├── specFormatter.ts                 ← Spec markdown formatter
│   ├── task-state-machine.ts            ← Task transition validation
│   ├── taskDependencyGraph.ts           ← Task dep graph computation
│   ├── taskService.ts                   ← Task CRUD+sync (881 lines)
│   ├── worktreeService.ts              ← Git worktree ops (725 lines)
│   ├── beads/        (18 files)         ← Bead storage system
│   ├── planGates/    (7 files)          ← Workflow plan gates
│   ├── ports/        (4 files)          ← Git client abstractions
│   └── state/        (15 files)         ← Storage port adapters
└── utils/
    ├── detection.ts                     ← Workflow/plan detection
    ├── fs.ts                            ← Filesystem helpers
    ├── json-lock.ts                     ← JSON file locking
    ├── logger.ts                        ← Logger infrastructure
    ├── paths.ts                         ← Path resolution
    ├── shell.ts                         ← Shell utilities
    └── slug.ts                          ← Name sanitization
```

**Problem**: The `services/` directory has **11 loose service files** alongside **4 subdirectories**. Several files are closely related but aren't grouped together:
- `taskService.ts`, `task-state-machine.ts`, `taskDependencyGraph.ts` all relate to tasks
- `featureService.ts` stands alone but relates to the feature domain
- `planService.ts` and `specFormatter.ts` relate to plans
- `event-logger.ts` and `outcomes.ts` are cross-cutting infrastructure

### Package: `opencode-warcraft/src/`

```
src/
├── index.ts                             ← Plugin entry point
├── container.ts                         ← DI composition root
├── guards.ts                            ← Validation/gate logic
├── plugin-config.ts                     ← Agent config builder
├── types.ts                             ← Plugin-local types
├── agents/          (11 files)          ← Agent definitions & prompts
├── hooks/           (8 files)           ← Chat lifecycle hooks
├── mcp/             (5 files)           ← MCP server configs
├── skills/          (7 files)           ← Skill loading system
├── tools/           (17 files)          ← Tool implementations
├── utils/           (12 files)          ← Prompt utilities
└── e2e/             (9 files)           ← Integration tests
```

**This package is already well-organized.** Each subdirectory maps to a clear domain. The root-level files serve as the plugin wiring layer and are appropriately placed.

---

## Proposed Reorganization

### Phase 1: `warcraft-core/src/services/` — Group Loose Files into Domain Folders

This is the **primary change**. Move the 11 loose service files into 4 domain-specific subdirectories:

#### New Structure:

```
services/
├── index.ts                              ← Updated barrel (re-exports from subfolders)
│
├── task/                                  ← NEW: Task domain
│   ├── taskService.ts                     ← (moved from services/)
│   ├── task-state-machine.ts              ← (moved from services/)
│   ├── taskDependencyGraph.ts             ← (moved from services/)
│   └── (test files co-located)
│
├── feature/                               ← NEW: Feature domain
│   ├── featureService.ts                  ← (moved from services/)
│   ├── contextService.ts                  ← (moved from services/) — context is per-feature
│   ├── agentsMdService.ts                 ← (moved from services/) — AGENTS.md is a feature-scoped concern
│   └── (test files co-located)
│
├── plan/                                  ← NEW: Plan domain
│   ├── planService.ts                     ← (moved from services/)
│   ├── specFormatter.ts                   ← (moved from services/) — formats task specs from plans
│   └── (test files co-located)
│
├── infrastructure/                        ← NEW: Cross-cutting infrastructure
│   ├── configService.ts                   ← (moved from services/)
│   ├── dockerSandboxService.ts            ← (moved from services/)
│   ├── event-logger.ts                    ← (moved from services/)
│   ├── outcomes.ts                        ← (moved from services/)
│   ├── worktreeService.ts                 ← (moved from services/) — git worktree ops
│   └── (test files co-located)
│
├── beads/           (18 files)            ← UNCHANGED
├── planGates/       (7 files)             ← UNCHANGED
├── ports/           (4 files)             ← UNCHANGED
└── state/           (15 files)            ← UNCHANGED
```

#### Rationale for Each Grouping:

**`task/`** — These three files form a tightly-coupled unit:
- `taskService.ts` (881 lines) is the core task CRUD service.
- `task-state-machine.ts` defines the allowed task state transitions, consumed exclusively by `taskService`.
- `taskDependencyGraph.ts` computes runnable/blocked tasks, consumed by `taskService.getRunnableTasks()`.
- All three share the same `TaskStatusType` type and work together to manage the task lifecycle.

**`feature/`** — Feature-scoped services:
- `featureService.ts` manages feature CRUD and lifecycle.
- `contextService.ts` manages per-feature context files (it takes `featureName` as primary input on every method).
- `agentsMdService.ts` syncs findings from feature contexts into AGENTS.md — it depends on `ContextService` and operates at the feature level.

**`plan/`** — Plan-related services:
- `planService.ts` handles plan read/write/approval.
- `specFormatter.ts` formats `SpecData` (derived from plans) into markdown spec content. It's the single-source formatter for spec generation from plan data.
- `planGates/` already exists as a subdirectory and handles plan gate validation. It stays where it is but is now a conceptual sibling of this folder.

**`infrastructure/`** — Cross-cutting services not tied to one domain:
- `configService.ts` — global user config, not domain-specific.
- `dockerSandboxService.ts` — execution infrastructure.
- `event-logger.ts` — operational logging infrastructure.
- `outcomes.ts` — generic `OperationOutcome` envelope pattern used across services.
- `worktreeService.ts` — git worktree management, used by task dispatch but conceptually is infrastructure (git operations).

### Phase 2: `opencode-warcraft/src/` — Minor Improvements

The plugin package is already excellent. Two small improvements:

#### 2a. Co-locate `guards.ts` considerations

`guards.ts` contains validation and gate logic extracted from `index.ts`. It's used by the plugin wiring layer. It's fine at root level since it's a core module. **No move needed.**

#### 2b. Consider merging `tool-input.ts` into `tools/` proper

`tool-input.ts` is already in `tools/` and is appropriately placed. **No change needed.**

---

## File-Level Consolidation / Splitting Recommendations

### Files That Should Stay As-Is (No Merge/Split)

| File | Lines | Rationale |
|------|-------|-----------|
| `taskService.ts` | 881 | Large but cohesive — all methods on a single `TaskService` class. Field data, sync logic, CRUD, and spec building are all tightly interwoven. Splitting would create artificial boundaries. |
| `worktreeService.ts` | 725 | All methods on `WorktreeService` class — git operations (create, diff, apply, merge, prune) form a coherent unit. |
| `BeadGateway.ts` | ~780 | Large but operates as a single gateway to the bead system. All methods are closely related. |
| `BeadsRepository.ts` | ~700 | Repository pattern — conceptually a single persistence layer. |
| `plugin-config.ts` | 299 | Builds all agent configs from a single entry point. Splitting per-agent would scatter related logic. |

### Potential Future Consolidations (Not Recommended Now)

| Candidate | Why Not Now |
|-----------|-------------|
| `task-state-machine.ts` (56 lines) → merge into `taskService.ts` | Separate file makes the state machine easy to find and test independently. The 56 lines justify their own file for discoverability. |
| `specFormatter.ts` (86 lines) → merge into `taskService.ts` | It's imported by `task-dispatch.ts` in the plugin package too. Separate file avoids circular dependencies. |
| `outcomes.ts` (97 lines) → merge into a "shared" module | It's a standalone utility pattern used across services. Its own file makes it importable without pulling in unrelated code. |

### No Stubs/Placeholders/Mocks Found

A thorough `grep` for `TODO`, `FIXME`, `HACK`, `STUB`, `placeholder`, `mock`, and `not implemented` across all non-test `.ts` files yielded **zero results**. The production code is fully fleshed out.

---

## Import Path Update Plan

The reorganization of `warcraft-core/src/services/` requires updating import paths. Here is the precise change tracking:

### Changes to `warcraft-core/src/services/index.ts` (Barrel)

The barrel file must update paths to reflect new subdirectory locations:

```diff
-export { AgentsMdService } from './agentsMdService.js';
+export { AgentsMdService } from './feature/agentsMdService.js';

-export { ConfigService } from './configService.js';
+export { ConfigService } from './infrastructure/configService.js';

-export { ContextService } from './contextService.js';
+export { ContextService } from './feature/contextService.js';

-export { DockerSandboxService } from './dockerSandboxService.js';
+export { DockerSandboxService } from './infrastructure/dockerSandboxService.js';

-export { ... } from './event-logger.js';
+export { ... } from './infrastructure/event-logger.js';

-export { FeatureService } from './featureService.js';
+export { FeatureService } from './feature/featureService.js';

-export * from './outcomes.js';
+export * from './infrastructure/outcomes.js';

-export { PlanService } from './planService.js';
+export { PlanService } from './plan/planService.js';

-export { formatSpecContent } from './specFormatter.js';
+export { formatSpecContent } from './plan/specFormatter.js';

-export { ... } from './taskDependencyGraph.js';
+export { ... } from './task/taskDependencyGraph.js';

-export { TaskService } from './taskService.js';
+export { TaskService } from './task/taskService.js';

-export { ... } from './worktreeService.js';
+export { ... } from './infrastructure/worktreeService.js';
```

### Intra-Service Relative Import Updates

Files within `warcraft-core/src/services/` import each other with relative paths. These must be updated when files move:

| Moving File | Current Import | New Import |
|-------------|---------------|------------|
| `taskService.ts` → `task/` | `'./task-state-machine.js'` | `'./task-state-machine.js'` (same folder — no change!) |
| `taskService.ts` → `task/` | `'./state/types.js'` | `'../state/types.js'` |
| `taskService.ts` → `task/` | `'../types.js'` | `'../../types.js'` |
| `taskService.ts` → `task/` | `'../utils/...'` | `'../../utils/...'` |
| `featureService.ts` → `feature/` | `'../types.js'` | `'../../types.js'` |
| `featureService.ts` → `feature/` | `'../utils/...'` | `'../../utils/...'` |
| `featureService.ts` → `feature/` | `'./state/types.js'` | `'../state/types.js'` |
| `contextService.ts` → `feature/` | `'../types.js'` | `'../../types.js'` |
| `contextService.ts` → `feature/` | `'../utils/...'` | `'../../utils/...'` |
| `agentsMdService.ts` → `feature/` | `'../types.js'` | `'../../types.js'` |
| `agentsMdService.ts` → `feature/` | `'../utils/...'` | `'../../utils/...'` |
| `agentsMdService.ts` → `feature/` | `'./contextService.js'` | `'./contextService.js'` (same folder — no change!) |
| `planService.ts` → `plan/` | `'../types.js'` | `'../../types.js'` |
| `planService.ts` → `plan/` | `'../utils/...'` | `'../../utils/...'` |
| `planService.ts` → `plan/` | `'./state/types.js'` | `'../state/types.js'` |
| `specFormatter.ts` → `plan/` | `'../types.js'` | `'../../types.js'` |
| `configService.ts` → `infrastructure/` | `'../defaults.js'` | `'../../defaults.js'` |
| `configService.ts` → `infrastructure/` | `'../types.js'` | `'../../types.js'` |
| `configService.ts` → `infrastructure/` | `'./dockerSandboxService.js'` | `'./dockerSandboxService.js'` (same folder!) |
| `worktreeService.ts` → `infrastructure/` | `'../types.js'` | `'../../types.js'` |
| `worktreeService.ts` → `infrastructure/` | `'../utils/...'` | `'../../utils/...'` |
| `worktreeService.ts` → `infrastructure/` | `'./ports/...'` | `'../ports/...'` |
| `event-logger.ts` → `infrastructure/` | No internal relative imports | Only `fs` and `path` — no changes |
| `outcomes.ts` → `infrastructure/` | No internal imports | Pure module — no changes |
| `dockerSandboxService.ts` → `infrastructure/` | No internal imports | Only node builtins — no changes |

### External Package Imports (No Changes Needed!)

**Critical**: Since all external consumers import from `warcraft-core` (the package name) and the barrel `index.ts` re-exports everything, **no import changes are needed in `opencode-warcraft`**. The barrel serves as a stable public API boundary.

The only files that import from relative paths within `warcraft-core` are other `warcraft-core` files, and those are all tracked in the table above.

### Test File Migration

Each test file co-located with its source file (e.g., `taskService.test.ts`) moves alongside its source file into the new subdirectory. Test files import their subject with relative `'./'` paths, so as long as they move together, no test imports need updating.

Test files that cross-reference other services will need their relative paths updated (same pattern as the table above, but for `.test.ts` files).

---

## Why This Structure is Optimal

### 1. **Domain Navigation**
A developer thinking "where's the task state machine?" now checks `services/task/` instead of scanning 11+ files in `services/`. Each folder is a self-describing domain.

### 2. **Minimal Nesting**
The deepest path is `services/task/taskService.ts` — only 2 levels from `src/`. No folder has more than 5-6 source files. This avoids the over-nesting anti-pattern.

### 3. **Cohesion Over Coupling**
Files that are functionally coupled (like `taskService` + `task-state-machine` + `taskDependencyGraph`) now share a folder. Files that are only used together are discoverable together.

### 4. **Stable Public API**
The barrel `services/index.ts` insulates all consumers from structural changes. External packages only see the flat re-export surface — they never break even when we reorganize internally.

### 5. **Backwards-Compatible**
Since `warcraft-core`'s barrel `src/index.ts` re-exports from `src/services/index.ts`, which re-exports from the subdirectory barrels, the external API surface is 100% unchanged.

---

## Verification Plan

### Automated Tests

1. **TypeScript type-checking** (catches all broken import paths):
   ```bash
   bun run --filter warcraft-core typecheck
   ```

2. **Unit tests** (catches runtime import failures and regression):
   ```bash
   bun run --filter warcraft-core test
   ```

3. **Plugin package tests** (catches if barrel re-exports are broken):
   ```bash
   bun run --filter opencode-warcraft test
   ```

4. **Full build** (catches if module resolution works for bundling):
   ```bash
   bun run build
   ```

5. **Lint** (catches any formatting/import ordering issues):
   ```bash
   bun run lint
   ```

6. **Full release check** (integration of all above):
   ```bash
   bun run release:check
   ```

### Manual Verification
- After changes, visually inspect the `services/` folder structure to confirm it matches the proposed layout.
- Verify that `git diff` shows only file moves and import path changes (no logic changes).

---

## Implementation Steps (Execution Order)

1. Create the 4 new directories: `task/`, `feature/`, `plan/`, `infrastructure/`
2. Move source files + co-located test files into their new directories
3. Update all relative import paths within moved files
4. Update `services/index.ts` barrel to point to new locations
5. Run `bun run --filter warcraft-core typecheck` — fix any remaining path issues
6. Run `bun run --filter warcraft-core test` — confirm all tests pass
7. Run `bun run build` — confirm full build succeeds
8. Run `bun run lint` — confirm formatting is clean
9. Run `bun run test` — monorepo-wide test pass

---

## Summary of Changes

| Change | Scope | Risk |
|--------|-------|------|
| Move 11 service files → 4 domain subdirectories | `warcraft-core/src/services/` | Low — barrel insulates consumers |
| Update ~20 relative import paths | Within moved files | Low — TypeScript catches errors |
| Update barrel `services/index.ts` | 1 file | Low — mechanical change |
| No logic changes | — | Zero regression risk |
| Tests move alongside source files | Co-located test files | Zero risk |
