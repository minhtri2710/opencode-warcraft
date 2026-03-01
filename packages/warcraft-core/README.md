# warcraft-core

Shared domain services, types, and utilities for [Project Warcraft](https://github.com/minhtri2710/opencode-warcraft) — a context-driven development system for AI coding assistants.

## Installation

```bash
npm install warcraft-core
```

## Overview

`warcraft-core` provides the foundational services used by `opencode-warcraft` and related tooling. It has **no dependency on OpenCode** and can be consumed independently.

### Services

| Service | Purpose |
|---------|---------|
| `FeatureService` | Feature lifecycle (create, list, complete, metadata) |
| `PlanService` | Plan CRUD, comment management, approval with SHA-256 hash verification |
| `TaskService` | Task sync from plan, CRUD, dependency graph resolution |
| `WorktreeService` | Git worktree creation, commit, merge, diff, conflict detection |
| `ContextService` | Persistent context file management for features |
| `ConfigService` | User config at `~/.config/opencode/opencode_warcraft.json` |
| `AgentsMdService` | AGENTS.md generation and management |
| `DockerSandboxService` | Docker-based sandbox for worker isolation |

### Beads Subsystem

Integration with `beads_rust` (`br` CLI) for canonical artifact tracking:

| Module | Purpose |
|--------|---------|
| `BeadsRepository` | Core bead lifecycle and state synchronization |
| `BeadGateway` | CLI command execution adapter |
| `BvTriageService` | Beads viewer health and triage |
| `ArtifactSchemas` | Schema definitions for bead artifacts |

### State Stores

Pluggable storage backends via Strategy pattern:

- **Beads stores** (`beads-feature-store`, `beads-task-store`, `beads-plan-store`) — backed by `br` artifacts
- **Filesystem stores** (`fs-feature-store`, `fs-task-store`, `fs-plan-store`) — backed by local JSON files
- **Factory** (`createStores`) — selects backend based on `beadsMode`

## Usage

```typescript
import {
  FeatureService,
  TaskService,
  PlanService,
  ConfigService,
  createStores,
} from 'warcraft-core';

const config = new ConfigService();
const stores = createStores(projectRoot, config.getBeadsMode());
const planService = new PlanService(projectRoot, stores.planStore);
const taskService = new TaskService(projectRoot, stores.taskStore);
const featureService = new FeatureService(projectRoot, stores.featureStore, planService);
```

## License

MIT with Commons Clause. See [LICENSE](../../LICENSE).
