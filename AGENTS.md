# Agent Guidelines for opencode-warcraft

## Overview

**opencode-warcraft** is a context-driven development system for AI coding assistants. It implements a plan-first workflow: Plan → Approve → Execute.

Project Warcraft uses **beads-core** for canonical task tracking (stored in `.beads/artifacts/`).

## Build & Test Commands

```bash
# Build all packages
bun run build

# Development mode (all packages)
bun run dev

# Run tests (from package directories)
bun run test              # Run all tests
bun run test -- <file>    # Run specific test

# Run static checks
bun run lint              # Run workspace type checks

# Release preparation
bun run release:check     # Install, build, and test all packages
bun run release:prepare   # Prepare release
```

Worktree dependency note: worktrees are isolated checkouts and do not share the root `node_modules`. If you run tests or builds inside a worktree, run `bun install` there first (or run tests from the repo root that already has dependencies installed).

## Troubleshooting

### Worktree Dependencies (Module Not Found)

If tests or builds fail with "module not found" errors inside a worktree:

```bash
# Option 1: Install dependencies in the worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install
bun run test

# Option 2: Run from repo root (recommended)
cd /path/to/repo/root
bun run test --filter warcraft-core
```

### Package-Specific Commands

```bash
# From packages/warcraft-core/
bun run build             # Build warcraft-core
bun run test              # Run warcraft-core tests

# From packages/opencode-warcraft/
bun run build             # Build opencode-warcraft plugin
bun run dev               # Watch mode

```

## Code Style

### General

- **TypeScript ES2022** with ESM modules
- **Semicolons**: Yes, use semicolons
- **Quotes**: Single quotes for strings
- **Imports**: Use `.js` extension for local imports (ESM requirement)
- **Type imports**: Separate with `import type { X }` syntax
- **Naming**:
  - `camelCase` for variables, functions
  - `PascalCase` for types, interfaces, classes
  - Descriptive function names (`readFeatureJson`, `ensureFeatureDir`)

### TypeScript Patterns

```typescript
// Explicit type annotations
interface FeatureInfo {
  name: string;
  path: string;
  status: 'active' | 'completed';
}

// Classes for services
export class FeatureService {
  constructor(private readonly rootDir: string) {}
  
  async createFeature(name: string): Promise<FeatureInfo> {
    // ...
  }
}

// Async/await over raw promises
async function loadConfig(): Promise<Config> {
  const data = await fs.readFile(path, 'utf-8');
  return JSON.parse(data);
}
```

### File Organization

```
packages/
├── warcraft-core/           # Shared logic (services, types, utils)
│   └── src/
│       ├── services/    # FeatureService, TaskService, PlanService, etc.
│       ├── utils/       # paths.ts, detection.ts
│       └── types.ts     # Shared type definitions
├── opencode-warcraft/       # OpenCode plugin (current)
│   └── src/
│       ├── agents/      # brann, saurfang, khadgar, mimiron, mekkatorque, algalon
│       ├── mcp/         # websearch, grep-app, context7
│       ├── tools/       # Warcraft tool implementations
│       ├── hooks/       # Event hooks
│       └── skills/      # Skill definitions
└── (future packages)       # Additional workspace packages as needed
```

### Package-Level Agent Maps

For folder ownership and workflow details, read these first:

- `packages/README.md`
- `packages/warcraft-core/AGENTS.md`
- `packages/opencode-warcraft/AGENTS.md`

### Tests

- Test files use `.test.ts` suffix
- Place tests next to source files or in `__tests__/` directories
- Use descriptive test names

## Commit Messages

Use **Conventional Commits**:

```
feat: add parallel task execution
fix: handle missing worktree gracefully
docs: update skill documentation
chore: upgrade dependencies
refactor: extract worktree logic to service
test: add feature service unit tests
perf: cache resolved paths
```

Breaking changes use `!`:
```
feat!: change plan format to support subtasks
```

## Architecture Principles

### Core Philosophy

1. **Context Persists** - Beads (`.beads/artifacts/`) are canonical; memory is ephemeral
2. **Plan → Approve → Execute** - No code without approved plan
3. **Human Shapes, Agent Builds** - Humans decide direction, agents implement
4. **Good Enough Wins** - Ship working code, iterate later
5. **Batched Parallelism** - Delegate independent tasks to workers
6. **Tests Define Done** - TDD subtasks: test → implement → verify
7. **Iron Laws + Hard Gates** - Non-negotiable constraints per agent

### Agent Roles

| Agent | Role |
|-------|------|
| Khadgar (Hybrid) | Plans + orchestrates. Detects phase, loads skills on-demand |
| Mimiron (Planner) | Plans features, interviews, writes plans. NEVER executes |
| Saurfang (Orchestrator) | Orchestrates execution. Delegates, spawns workers, verifies, merges |
| Brann (Explorer) | Researches codebase + external docs/data |
| Mekkatorque (Worker) | Executes tasks directly in isolated worktrees. Never delegates |
| Algalon (Consultant) | Reviews plan/code quality. OKAY/REJECT verdict |

### Data Model

Features stored in `.beads/artifacts/<name>/` (beadsMode `on`) or `docs/<name>/` (beadsMode `off`):
```
.beads/artifacts/my-feature/
├── feature.json       # Feature metadata (bead state cache in on mode)
├── plan.md            # Implementation plan
├── context/            # Persistent context files
│   ├── research.md
│   └── decisions.md
└── tasks/              # Task folders (beadsMode off only; cache in on mode)
    └── 01-sample-task/
        ├── status.json
        ├── spec.md
        ├── worker-prompt.md
        └── report.md
```

In beadsMode `on`, the `tasks/` directory is **not** created at feature creation. Task state lives canonically in bead artifacts. Local `tasks/` folders appear only as cache when tasks are synced.

In beadsMode `off`, the `tasks/` directory is created at feature creation and is the canonical source of task state.

Legacy nested feature paths (`.beads/artifacts/features/<feature>/`) are no longer supported.

## Development Workflow

### Adding a New Tool

1. Create tool in `packages/opencode-warcraft/src/tools/`
2. Register in tool index
3. Add to agent system prompt if needed
4. Test with actual agent invocation

### Adding a New Skill

1. Create directory in `packages/opencode-warcraft/skills/<name>/`
2. Add `SKILL.md` with skill instructions
3. Register in skill loader
4. Document triggers in skill description

### Adding a Service

1. Create in `packages/warcraft-core/src/services/`
2. Export from `services/index.ts`
3. Add types to `types.ts`
4. Write unit tests

## Important Patterns

### File System Operations

Use the utility functions from warcraft-core:

```typescript
import { readJson, writeJson, fileExists, ensureDir } from './utils/fs.js';

// Not: fs.readFileSync + JSON.parse
const data = await readJson<Config>(path);

// Not: fs.mkdirSync
await ensureDir(dirPath);
```

### Error Handling

```typescript
// Prefer explicit error handling
try {
  const feature = await featureService.load(name);
  return { success: true, feature };
} catch (error) {
  return { 
    error: `Failed to load feature: ${error.message}`,
    hint: 'Check that the feature exists'
  };
}
```

### Path Resolution

```typescript
import { getWarcraftDir, getFeatureDir } from './utils/paths.js';

// Use path utilities, not string concatenation
const warcraftPath = getWarcraftDir(rootDir);
const featurePath = getFeatureDir(rootDir, featureName);
```

## Monorepo Structure

This is a **bun workspaces** monorepo:

```json
{
  "workspaces": ["packages/*"]
}
```

- Dependencies are hoisted to root `node_modules/`
- Each package has its own `package.json`
- Run package scripts from the package directory (for example, `packages/opencode-warcraft/` → `bun run build`)

## Warcraft Feature Development System

Plan-first development: Write plan → User reviews → Approve → Execute tasks

### Tools (17 total)

| Domain | Tools |
|--------|-------|
| Feature | warcraft_feature_create, warcraft_feature_complete |
| Plan | warcraft_plan_write, warcraft_plan_read, warcraft_plan_approve |
| Task | warcraft_tasks_sync, warcraft_task_create, warcraft_task_update |
| Worktree | warcraft_worktree_create, warcraft_worktree_commit, warcraft_worktree_discard |
| Merge | warcraft_merge |
| Batch | warcraft_batch_execute |
| Context | warcraft_context_write |
| AGENTS.md | warcraft_agents_md |
| Status | warcraft_status |
| Skill | warcraft_skill |

### Workflow

1. `warcraft_feature_create(name)` - Create feature
2. `warcraft_plan_write(content)` - Write plan.md
3. User adds comments in `plan.md` → `warcraft_plan_read` to see them
4. Revise plan → User approves
5. `warcraft_tasks_sync()` - Generate tasks from plan
6. `warcraft_worktree_create(task)` → work in worktree → `warcraft_worktree_commit(task, summary)`
7. `warcraft_merge(task)` - Merge task branch into main (when ready)

**Important:** `warcraft_worktree_commit` commits changes to task branch but does NOT merge.
Use `warcraft_merge` to explicitly integrate changes. Worktrees persist until manually removed.

### Workflow Guardrails

- **Standard path**: use full discovery and normal multi-task planning.
- **Lightweight path**: add `Workflow Path: lightweight`, keep 1-2 tasks, include mini-record entries (`Impact`, `Safety`, `Verify`, `Rollback`).
- Plan approval validates `## Plan Review Checklist`; it blocks only in enforce mode and warns in default warn mode.
- PRs should include references to `plan.md`, task `report.md`, and verification command results.
- CI should enforce `.beads/artifacts` sync (`br sync --flush-only` drift check) and PR evidence structure.

### Sandbox Configuration

**Docker sandbox** provides isolated test environments for workers:

- **Config location**: `~/.config/opencode/opencode_warcraft.json`
- **Fields**:
  - `sandbox: 'none' | 'docker'` — Isolation mode (default: 'none')
  - `dockerImage?: string` — Custom Docker image (optional, auto-detects if omitted)
- **Auto-detection**: Detects runtime from project files:
  - `package.json` → `node:22-slim`
  - `requirements.txt` / `pyproject.toml` → `python:3.12-slim`
  - `go.mod` → `golang:1.22-slim`
  - `Cargo.toml` → `rust:1.77-slim`
  - `Dockerfile` → builds from project Dockerfile
  - Fallback → `ubuntu:24.04`
**Example config**:
```json
{
  "sandbox": "docker",
  "dockerImage": "node:22-slim",
  "beadsMode": "on"
}
```

Workers are unaware of sandboxing — bash commands are transparently intercepted and wrapped with `docker run`.

### Agent Mode

`agentMode` controls which agents are registered:

- **`"unified"`** (default): Khadgar (hybrid), Brann, Mekkatorque, Algalon. Default agent: Khadgar.
- **`"dedicated"`**: Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, Algalon. Default agent: Mimiron.

Configured in `~/.config/opencode/opencode_warcraft.json`:
```json
{
	"agentMode": "dedicated"
}
```

### Parallel Execution

`parallelExecution` controls batch task dispatch:

- `strategy`: `"unbounded"` (default) or `"bounded"`
- `maxConcurrency`: Max parallel workers when bounded (default: 4)

```json
{
	"parallelExecution": {
		"strategy": "bounded",
		"maxConcurrency": 4
	}
}
```

### Beads Mode (beads_rust Workflow)

`beadsMode` controls integration with the **beads_rust (`br`)** CLI:

- **`"on"`** (default): Beads-native state — beads are the canonical source of truth
  - Feature state stored in bead epics (via `br create -t epic`)
  - Local cache files are still written under `.beads/artifacts/<feature>/`; task status files are not pre-created at feature creation time
  - Plan approval stored in bead artifacts with content hash for integrity
  - Local `.beads/artifacts/` files serve as read-through cache, not source of truth
  - At workflow start: warcraft tools run `br sync --import-only` to load current bead state
  - At workflow end: warcraft tools run `br sync --flush-only` to persist bead state
  - Warcraft tools do NOT perform any CLI-driven git actions
  - Manual git operations are required for `.beads/` artifacts (see below)
- **`"off"`**: Legacy local artifacts behavior
  - Local `docs/<feature>/` files remain authoritative
  - Feature state stored in local `docs/<feature>/feature.json`
  - Plan approval stored in local `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)
  - No bead integration; `br` CLI commands are not invoked
  - Use this for projects without beads_rust installed or when bead workflow is not desired

**Configuration values**:
- `"on"` or `true`: Enable beads-native mode (default)
- `"off"` or `false`: Disable bead interactions (legacy mode)

**Legacy migration note**: Values `"dual-write"` and `"beads-primary"` are no longer supported. Use `"on"` or `"off"` instead.

**Important**: When `beadsMode` is `"on"`, you must manually stage and commit `.beads/` changes:

```bash
git add .beads/artifacts/
git commit -m "beads: update artifact state"
```

### Priority System

Features and tasks require a numeric **priority** (1–5) that determines urgency:

| Priority | Level | Use Case |
|----------|-------|----------|
| 1 | Critical | Blockers, production incidents |
| 2 | High | Important features, near-term deadlines |
| 3 | Medium | Standard work (default) |
| 4 | Low | Nice-to-have improvements |
| 5 | Trivial | Documentation tweaks, minor refactors |

**Requirements**:
- Must be an integer between 1 and 5 (inclusive)
- Defaults to 3 when not specified
- Mapped to br priority when executing CLI commands (`1->0, 2->1, 3->2, 4->3, 5->4`)
- Used when creating epic beads (`br create -t epic -p <mapped-priority>`)
- Used when creating task beads (`br create -t task -p <mapped-priority>`)

**Examples**:
```bash
# Create high-priority feature (Warcraft priority 2 -> br priority 1)
br create "Fix critical bug" -t epic -p 1

# Create medium-priority task (Warcraft priority 3 -> br priority 2, default)
br create "Implement API endpoint" -t task --parent $EPIC_ID -p 2
```

### Plan Approval and Hash Verification

Plan approval uses **SHA-256 content hashing** to detect plan changes:

**Approval flow**:
1. When `warcraft_plan_approve()` is called, the system computes a SHA-256 hash of `plan.md` content
2. Approval record stores: hash, timestamp, and approving session ID
3. If plan content changes later, the approval is automatically invalidated (hash mismatch)

**Storage by mode**:
- **`beadsMode: on`**: Approval stored in bead artifact (`plan_approval` kind) with full plan snapshot (`approved_plan` kind)
- **`beadsMode: off`**: Approval stored in local `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)

**Example approval record**:
```json
{
  "hash": "a3f5c8e2d1b4f6...",
  "approvedAt": "2026-02-23T10:30:00.000Z",
  "approvedBySession": "session-abc123"
}
```

### Beads Command Reference

Core `br` commands for bead lifecycle management:

```bash
# Create beads
br create "Epic Title" -t epic                              # Create epic
br create "Task title" -t task --parent $EPIC_ID -d "..."  # Create child task

# Update beads
br update $BEAD_ID --claim          # Claim bead for work
br update $BEAD_ID --unclaim        # Release claim
br update $BEAD_ID -s deferred      # Mark deferred/blocked
br update $BEAD_ID --status open    # Explicit status update
br update $BEAD_ID --add-label parallel   # Add label
br update $BEAD_ID --add-label blocked
br update $BEAD_ID --priority 2     # br priority (0-4)
br update $BEAD_ID --description "## Plan\n- Markdown content"   # Update description with markdown

# Comments
br comments add $BEAD_ID "text"     # Add comment

# Close beads
br close $BEAD_ID                   # Close completed bead

# Sync artifacts
br sync --import-only               # Import bead state from disk
br sync --flush-only                # Flush bead state to disk (does NOT git commit)

# Manual git operations for .beads/
git add .beads/artifacts/           # Stage bead artifacts
git commit -m "beads: update artifact state"   # Commit artifacts
```

Note: `br sync --flush-only` persists bead state to `.beads/artifacts/` but does not create git commits. Warcraft tools never perform git operations via CLI. Always manually `git add` and `git commit` `.beads/` changes to version control.
