# opencode-warcraft

**Feature development plugin** for [OpenCode](https://opencode.ai) that implements a **plan-first workflow** (Plan → Approve → Execute) using a character-based agent model inspired by Warcraft lore.

**Key Concept**: Features are tracked through "beads" (task management entities) with human-shaped plans and agent-built implementations.

---

## Inspiration

This project draws inspiration from [agent-hive](https://github.com/tctinh/agent-hive) by [tctinh](https://github.com/tctinh), which pioneered the plan-first workflow approach for AI coding agents. Key concepts adapted:

- **Plan → Approve → Execute workflow**: Human shapes the what and why; agent handles the how
- **Context persistence**: Feature-scoped knowledge survives sessions
- **Worktree isolation**: Each task executes in its own isolated git worktree
- **Multi-agent orchestration**: Specialized agents with distinct roles working together
- **Audit trail**: Every decision, change, and agent action automatically captured

While agent-hive focuses on a bee-themed colony, opencode-warcraft adapts these principles into a Warcraft-themed universe with character-based agents (Khadgar, Mimiron, Saurfang, Brann, Mekkatorque, Algalon) each with unique personalities and specializations.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Inspiration](#inspiration)
- [Architecture](#architecture)
- [OpenCode Plugin Development](#opencode-plugin-development)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Workflow](#core-workflow)
- [Available Tools](#available-tools)
- [Configuration](#configuration)
- [Development](#development)
- [Testing](#testing)
- [Deployment & Release](#deployment--release)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Project Overview

**opencode-warcraft** is an OpenCode plugin that provides a structured feature development workflow with character-based AI agents. It extends OpenCode's capabilities with:

- **19 custom tools** for feature management, planning, and execution
- **6 specialized agents** (Khadgar, Mimiron, Saurfang, Brann, Mekkatorque, Algalon) inspired by Warcraft lore
- **Plan-first workflow**: Human shapes the plan; agents execute it
- **Integration with beads_rust**: Native task management and dependency tracking
- **MCP integrations**: Web search, GitHub code search, documentation lookup (optional)

### Monorepo Structure

| Package             | Purpose                              |
| ------------------- | ------------------------------------ |
| `warcraft-core`     | Shared domain logic, services, types |
| `opencode-warcraft` | OpenCode plugin integration          |

---

## Architecture

### Monorepo Structure

```
packages/
├── warcraft-core/           # Shared domain logic
│   └── src/
│       ├── services/        # FeatureService, TaskService, PlanService, stores
│       ├── utils/           # fs, paths, detection utilities
│       └── types.ts         # Core type definitions
└── opencode-warcraft/       # OpenCode plugin integration
    └── src/
        ├── agents/          # Agent definitions (Khadgar, Mimiron, Saurfang, etc.)
        ├── tools/           # Warcraft tool implementations (19 tools)
        ├── mcp/             # MCP integration (websearch, grep-app, context7)
        ├── hooks/           # Event hooks (variant, compaction)
        ├── skills/          # Skill definitions and generated registry
        ├── e2e/             # End-to-end tests
        ├── container.ts     # Dependency injection root
        └── index.ts        # Plugin entry point (exports Plugin function)
```

### Data Flow

```
User creates feature via warcraft_feature_create(name)
         ↓
Human writes plan via warcraft_plan_write(content)
         ↓
User approves plan via warcraft_plan_approve()
(stores SHA-256 hash for integrity)
         ↓
warcraft_tasks_sync() generates tasks from plan
         ↓
warcraft_worktree_create(task) creates isolated worktree per task
(spawns Mekkatorque worker in worktree)
         ↓
Worker executes in worktree → warcraft_worktree_commit(task, summary)
(commits to task branch)
         ↓
warcraft_merge(task) merges task branch into main
         ↓
warcraft_feature_complete() cleans up artifacts
```

**All operations are exposed as OpenCode tools** that agents can call directly through the CLI or API. The plugin handles all state management, file operations, and git worktree lifecycle.

### Agent Model

| Agent           | Role                                                           | Mode      |
| --------------- | -------------------------------------------------------------- | --------- |
| **Khadgar**     | Plans + orchestrates, detects phase, loads skills on-demand    | Unified   |
| **Mimiron**     | Plans features, interviews, writes plans. NEVER executes       | Dedicated |
| **Saurfang**    | Orchestrates execution, delegates, spawns workers, verifies    | Dedicated |
| **Brann**       | Researches codebase + external docs/data                       | Both      |
| **Mekkatorque** | Executes tasks directly in isolated worktrees. Never delegates | Both      |
| **Algalon**     | Reviews plan/code quality. OKAY/REJECT verdict                 | Both      |

**Agent Modes**:

- **`unified`** (default): Khadgar (hybrid), Brann, Mekkatorque, Algalon
- **`dedicated`**: Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, Algalon

---

## OpenCode Plugin Development

This plugin follows [OpenCode's plugin development guidelines](https://opencode.ai/docs/plugins/).

### Plugin Structure

An OpenCode plugin exports one or more plugin functions that receive a context object and return a hooks object:

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const WarcraftPlugin: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  return {
    // Hook implementations
    tool: {
      warcraft_feature_create: tool({
        /* ... */
      }),
      // ... more tools
    },
  };
};
```

### Context Object

Each plugin receives:

- `project`: Current project information
- `directory`: Current working directory
- `worktree`: Git worktree path (if applicable)
- `client`: OpenCode SDK client for AI interactions
- `$`: Bun's shell API for command execution

### Adding Custom Tools

Plugins can add custom tools to OpenCode using the `tool` helper:

```typescript
import { tool } from "@opencode-ai/plugin";

export const WarcraftPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      my_custom_tool: tool({
        description: "Custom tool description",
        args: {
          feature: z.string(),
          priority: z.number().min(1).max(5).default(3),
        },
        async execute(args, context) {
          // Tool implementation
          const { feature, priority } = args;
          const { directory, worktree } = context;

          // Return result
          return { success: true, data: { feature, priority } };
        },
      }),
    },
  };
};
```

### Event Hooks

Plugins can subscribe to various OpenCode events:

| Event Category | Example Events                                            |
| -------------- | --------------------------------------------------------- |
| **Session**    | `session.created`, `session.updated`, `session.compacted` |
| **Tool**       | `tool.execute.before`, `tool.execute.after`               |
| **Message**    | `message.updated`, `message.removed`                      |
| **File**       | `file.edited`, `file.watcher.updated`                     |
| **LSP**        | `lsp.client.diagnostics`, `lsp.updated`                   |
| **Permission** | `permission.asked`, `permission.replied`                  |

Example:

```typescript
export const WarcraftPlugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "warcraft_worktree_create") {
        // Validate or transform input before execution
      }
    },
    "session.compacted": async (input, output) => {
      // Inject custom context when session is compacted
      output.context.push("## Feature Context\nCurrent task status...");
    },
  };
};
```

### TypeScript Support

Import types from `@opencode-ai/plugin` for type-safe plugin development:

```typescript
import type { Plugin, ToolContext } from "@opencode-ai/plugin";

export const WarcraftPlugin: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  // Type-safe implementation
  return {
    /* hooks */
  };
};
```

### Dependencies

Local plugins can use external npm packages. Create a `package.json` in your config directory:

```json
{
  "dependencies": {
    "zod": "^3.22.0",
    "simple-git": "^3.20.0"
  }
}
```

OpenCode runs `bun install` at startup to install dependencies.

### Logging

Use structured logging via the SDK client:

```typescript
import { Plugin } from "@opencode-ai/plugin";

export const WarcraftPlugin: Plugin = async ({ client }) => {
  await client.app.log({
    body: {
      service: "warcraft",
      level: "info",
      message: "Plugin initialized",
      extra: { version: "0.1.1" },
    },
  });
};
```

See [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins/) for complete API reference and examples.

---

## Tech Stack

### Runtime & Tooling

| Category           | Tool                   | Purpose                                                |
| ------------------ | ---------------------- | ------------------------------------------------------ |
| Runtime            | Bun 1.3.9+             | Fast JavaScript runtime, built-in test runner, bundler |
| Package Manager    | Bun                    | Workspace support, fast installs                       |
| Build Tool         | Bun's built-in bundler | `bun build`                                            |
| Type Checking      | TypeScript Compiler    | `tsc --emitDeclarationOnly`                            |
| Linting/Formatting | Biome                  | Unified replacement for ESLint + Prettier              |

### Core Dependencies

- **warcraft-core**: `simple-git` (git operations)
- **opencode-warcraft**: `@opencode-ai/plugin` (peer dependency), `@opencode-ai/sdk`
- **MCP Integrations** (optional): `grep-mcp`, `@upstash/context7-mcp`, `exa-mcp-server`

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes
- **Semicolons**: Required
- **Line width**: 120 characters
- **Trailing commas**: All multi-line objects/arrays

---

## Installation

### Install from Git (Recommended)

```bash
cd ~/.config/opencode/plugins/
git clone https://github.com/YOUR_USERNAME/opencode-warcraft.git
cd opencode-warcraft
bun install
```

### Install from Local Files

Place plugin files in one of OpenCode's plugin directories:

- **Global**: `~/.config/opencode/plugins/opencode-warcraft/`
- **Project**: `.opencode/plugins/opencode-warcraft/`

### Configure OpenCode

Add to your `opencode.json` in the project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-warcraft"
  ]
}
```

**Plugin Auto-Load**: OpenCode loads plugins at startup from:
- Global config: `~/.config/opencode/opencode.json`
- Project config: `opencode.json`
- Global plugin directory: `~/.config/opencode/plugins/`
- Project plugin directory: `.opencode/plugins/`

Once the plugin is installed and configured, all **warcraft_* tools are automatically available** in OpenCode. You can use them through:

- **OpenCode CLI**: `opencode warcraft_*`
- **OpenCode Chat**: Agents can call tools directly
- **OpenCode TUI/IDE**: Interactive access through the interface

### 1. Create a Feature

```bash
# Using OpenCode CLI
opencode warcraft_feature_create --name "Add user authentication"
```

Or through the OpenCode chat interface:

```
You: Create a feature for adding user authentication

# OpenCode calls warcraft_feature_create automatically
```

### 2. Write a Plan

```bash
# CLI
opencode warcraft_plan_write
```

Or via chat:

```
You: Write a plan for the user authentication feature

# OpenCode opens warcraft_plan_write tool and you provide the content
```

Edit the generated `plan.md` with:

```markdown
# Plan: Add User Authentication

## Overview

Add JWT-based authentication to secure API endpoints.

## Discovery

- Current state: No authentication
- Requirements: JWT tokens, refresh tokens, protected routes
- Similar patterns in codebase: /lib/auth-example

## Implementation Plan

### 1. Create auth utilities

- Implement JWT signing/verification
- Add token refresh logic

### 2. Update API routes

- Add auth middleware
- Protect sensitive endpoints

### 3. Add user session management

- Store active sessions
- Handle logout

## Testing Strategy

- Unit tests for JWT utilities
- Integration tests for protected routes
- E2E tests for login/logout flow
```

### 3. Review and Approve Plan

Add comments to `plan.md` as needed, then:

```bash
opencode warcraft_plan_approve
```

### 4. Sync Tasks from Plan

```bash
opencode warcraft_tasks_sync
```

Tasks are generated from `### N. Task Name` headers in the plan.

### 5. Execute Tasks

**Option A: Sequential Execution**

```bash
# Preview runnable tasks
opencode warcraft_batch_execute --mode preview

# Create worktree and spawn worker
opencode warcraft_worktree_create --task-id "task-1"
```

**Option B: Parallel Batch Execution**

```bash
# Execute multiple independent tasks in parallel
opencode warcraft_batch_execute --mode execute --tasks "task-1,task-2,task-3"
```

### 6. Check Status

```bash
opencode warcraft_status
```

Shows progress, pending tasks, and any blockers.

### 7. Merge Completed Tasks

```bash
opencode warcraft_merge --task-id "task-1" --verify
```

### 8. Complete Feature

```bash
opencode warcraft_feature_complete
```

---

## Core Workflow

### Phase 1: Planning

1. **Create feature**: `warcraft_feature_create(name)`
2. **Write plan**: `warcraft_plan_write(content)`
3. **Review plan**: Add comments in `plan.md` → `warcraft_plan_read` to see them
4. **Approve plan**: `warcraft_plan_approve()` (stores SHA-256 hash for integrity)

### Phase 2: Task Generation

1. **Sync tasks**: `warcraft_tasks_sync()` (parses `### N. Task Name` headers)

### Phase 3: Execution

1. **Create worktree**: `warcraft_worktree_create(task)` → work in worktree → `warcraft_worktree_commit(task, summary)`
2. **Merge**: `warcraft_merge(task)` (commits changes to task branch, then merges to main)

**Important**: `warcraft_worktree_commit` commits changes to task branch but does NOT merge. Use `warcraft_merge` to explicitly integrate changes. Worktrees persist until manually removed.

### Delegated Execution

`warcraft_worktree_create` creates worktree and spawns worker automatically:

1. `warcraft_worktree_create(task)` → Creates worktree + spawns Mekkatorque (Worker/Coder)
2. Worker executes → calls `warcraft_worktree_commit(status: "completed")`
3. Worker blocked → calls `warcraft_worktree_commit(status: "blocked", blocker: {...})`

**Handling blocked workers**:

1. Check blockers with `warcraft_status()`
2. Read blocker info (reason, options, recommendation, context)
3. Answer via `question()` tool (auto-prompted)
4. Resume with `warcraft_worktree_create(task, continueFrom: "blocked", decision: answer)`

**CRITICAL**: When resuming, a NEW worker spawns in the SAME worktree. The previous worker's progress is preserved.

---

## Available Tools

| Domain        | Tools                                                                               |
| ------------- | ----------------------------------------------------------------------------------- |
| **Feature**   | `warcraft_feature_create`, `warcraft_feature_complete`                              |
| **Plan**      | `warcraft_plan_write`, `warcraft_plan_read`, `warcraft_plan_approve`                |
| **Task**      | `warcraft_tasks_sync`, `warcraft_task_create`, `warcraft_task_update`               |
| **Worktree**  | `warcraft_worktree_create`, `warcraft_worktree_commit`, `warcraft_worktree_discard` |
| **Merge**     | `warcraft_merge`                                                                    |
| **Batch**     | `warcraft_batch_execute`                                                            |
| **Context**   | `warcraft_context_write`                                                            |
| **AGENTS.md** | `warcraft_agents_md`                                                                |
| **Status**    | `warcraft_status`                                                                   |
| **Skill**     | `warcraft_skill`                                                                    |

### Tool Details

#### Feature Management

- **`warcraft_feature_create`**: Create new feature with priority (1-5)
- **`warcraft_feature_complete`**: Mark feature as complete, clean up artifacts

#### Plan Management

- **`warcraft_plan_write`**: Write/update plan.md content
- **`warcraft_plan_read`**: Read current plan with approval status
- **`warcraft_plan_approve`**: Approve plan (stores SHA-256 hash)

#### Task Management

- **`warcraft_tasks_sync`**: Generate tasks from plan headers
- **`warcraft_task_create`**: Manually create a task
- **`warcraft_task_update`**: Update task status, dependencies, notes

#### Worktree Operations

- **`warcraft_worktree_create`**: Create isolated worktree and spawn worker
- **`warcraft_worktree_commit`**: Commit worktree changes with status
- **`warcraft_worktree_discard`**: Discard worktree without merging

#### Merge & Batch

- **`warcraft_merge`**: Merge task branch into main with optional verification
- **`warcraft_batch_execute`**: Preview or execute multiple tasks in parallel

---

## Configuration

### Configuration File

Located at `~/.config/opencode/opencode_warcraft.json`:

```json
{
  "beadsMode": "on",
  "agentMode": "unified",
  "verificationModel": "tdd",
  "workflowGatesMode": "off",
  "parallelExecution": {
    "enabled": true,
    "maxParallel": 3
  },
  "agents": {
    "khadgar": {
      "model": "openai-gpt-4o"
    },
    "brann": {
      "model": "google-gemini-2.0-flash-exp"
    },
    "mekkatorque": {
      "model": "moonshot-v1-32k"
    },
    "algalon": {
      "model": "zai-coding-plan"
    }
  },
  "sandbox": null
}
```

### Configuration Options

| Option                          | Type                         | Default     | Description                                 |
| ------------------------------- | ---------------------------- | ----------- | ------------------------------------------- |
| `beadsMode`                     | `"on"` \| `"off"`            | `"on"`      | Beads-native (on) or local files (off) mode |
| `agentMode`                     | `"unified"` \| `"dedicated"` | `"unified"` | Agent execution mode                        |
| `verificationModel`             | `"tdd"` \| `"best-effort"`   | `"tdd"`     | Worker verification strategy                |
| `workflowGatesMode`             | `"on"` \| `"off"`            | `"off"`     | Enable workflow gates                       |
| `parallelExecution.enabled`     | boolean                      | `true`      | Enable parallel task execution              |
| `parallelExecution.maxParallel` | number                       | `3`         | Maximum parallel tasks                      |
| `agents.{agent}.model`          | string                       | -           | Model override for specific agent           |
| `sandbox`                       | `"docker"` \| `null`         | `null`      | Optional Docker sandbox                     |

### Beads Mode

When `beadsMode: "on"` (default):

- Beads are canonical source of truth
- Local `.beads/artifacts/` files are read-through cache
- Must manually git commit `.beads/` changes:

```bash
git add .beads/artifacts/
git commit -m "beads: update artifact state"
```

### Priority System

Features and tasks require priority (1-5):

- **1** = Critical (blockers, production incidents)
- **2** = High (important features, near-term deadlines)
- **3** = Medium (standard work, default)
- **4** = Low (nice-to-have improvements)
- **5** = Trivial (documentation tweaks, minor refactors)

### Plan Approval Hash Verification

Plan approval uses SHA-256 content hashing to detect changes:

- Approval record stores: hash, timestamp, approving session ID
- If plan content changes, approval is automatically invalidated

---

## Development

### Project Setup

```bash
# Clone repository
git clone https://github.com/your-org/opencode-warcraft.git
cd opencode-warcraft

# Install dependencies
bun install

# Build all packages
bun run build
```

### Development Workflow

```bash
# Watch mode (opencode-warcraft package)
cd packages/opencode-warcraft
bun run dev

# Run tests
bun run test

# Type check
bun run lint

# Format code
bun run format
```

### Package-Specific Commands

#### warcraft-core

```bash
cd packages/warcraft-core

# Build
bun run build

# Run tests
bun run test

# Type check
bun run typecheck
```

#### opencode-warcraft

```bash
cd packages/opencode-warcraft

# Generate skills registry (run before build)
bun run generate-skills

# Build
bun run build

# Watch mode
bun run dev

# Run tests
bun run test

# Type check
bun run typecheck
```

### Skill Development

Skills are defined as `.md` files in `packages/opencode-warcraft/skills/`:

```bash
# Add new skill
vim packages/opencode-warcraft/skills/my-skill/SKILL.md

# Regenerate registry
bun run generate-skills

# Build
bun run build
```

### Code Conventions

| Convention          | Example                                                |
| ------------------- | ------------------------------------------------------ |
| Types/Interfaces    | `PascalCase` → `FeatureInfo`, `TaskInput`              |
| Classes             | `PascalCase` → `FeatureService`, `BeadGateway`         |
| Functions/Variables | `camelCase` → `readFeatureJson`, `ensureFeatureDir`    |
| Constants           | `UPPER_SNAKE_CASE` → `COMPLETION_GATES`, `MAX_TASKS`   |
| Files               | `kebab-case.ts` → `config-service.ts`, `task-tools.ts` |
| Test files          | `*.test.ts` → `featureService.test.ts`                 |

### Import Patterns

```typescript
// Type imports - separate with `import type`
import type { Feature, Task } from "./types.js";

// Value imports
import { FeatureService, TaskService } from "./services/index.js";

// Local imports MUST use .js extension (ESM requirement)
import { readJson } from "./utils/fs.js";
```

---

## Testing

### Test Framework

- **Bun Test** (`bun test`) - Built-in test runner with `describe`, `it`, `expect`

### Running Tests

```bash
# All tests from root
bun run test

# Specific test file
bun test packages/warcraft-core/src/services/featureService.test.ts

# With filter (from root)
bun run test --filter warcraft-core
```

### Test Organization

**Co-located tests**: Test files next to source files

```
packages/warcraft-core/src/
├── services/
│   ├── featureService.ts
│   └── featureService.test.ts
```

**E2E tests**: Separate directory

```
packages/opencode-warcraft/src/e2e/
├── helpers/
│   └── test-env.ts
└── plugin-smoke.test.ts
```

### Test Patterns

**Unit Test**:

```typescript
import { describe, expect, it } from "bun:test";

describe("FeatureService", () => {
  it("should create feature with valid name", async () => {
    const service = new FeatureService(mockConfig, mockStore);
    const feature = await service.createFeature("test-feature");
    expect(feature.name).toBe("test-feature");
  });
});
```

### Worktree Testing Note

Worktrees are isolated checkouts without shared `node_modules`. If tests fail in worktrees:

```bash
# Option 1: Install in worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install
bun run test

# Option 2: Run from repo root (recommended)
cd /path/to/repo/root
bun run test --filter warcraft-core
```

### Coverage Expectations

- Unit tests for all service methods
- Integration tests for tool workflows
- E2E tests for critical user paths
- Prompt content validation tests for agent system prompts

---

## Deployment & Release

### Release Process

Releases are versioned via git tags:

```bash
# Tag release
git tag v0.1.2
git push origin v0.1.2
```

Users install from git by cloning the specific tag:

```bash
git clone --branch v0.1.2 https://github.com/YOUR_USERNAME/opencode-warcraft.git
```

### Pre-Release Checklist

```bash
# Run full release check
bun run release:check

# This runs:
# - bun install
# - bun run build
# - bun run test
# - bun run lint
# - bun run format:check
```

### Distribution

This plugin is designed for **local installation** from git:

```bash
# Clone to OpenCode plugins directory
cd ~/.config/opencode/plugins/
git clone https://github.com/YOUR_USERNAME/opencode-warcraft.git
cd opencode-warcraft
bun install
```

Users can also install by placing the plugin files in `.opencode/plugins/` for project-level or `~/.config/opencode/plugins/` for global access.

---

## Troubleshooting

### Common Issues

#### Worktree Not Found

**Error**: `fatal: '/path/to/.beads/artifacts/.worktrees/feature/task' does not exist`

**Solution**: Worktrees persist until manually removed. Clean up:

```bash
# List worktrees
git worktree list

# Remove specific worktree
git worktree remove .beads/artifacts/.worktrees/feature/task

# Or prune all removed worktrees
git worktree prune
```

#### Tests Fail in Worktree

**Error**: `Cannot find module 'bun:test'`

**Solution**: Worktrees lack shared `node_modules`. Run from repo root:

```bash
cd /path/to/repo/root
bun run test --filter warcraft-core
```

#### Plan Approval Invalidated

**Error**: `Plan has been modified since approval`

**Solution**: Re-approve the plan:

```bash
opencode warcraft_plan_approve
```

#### MCP Tools Not Available

**Error**: `MCP tool 'grep-app-searchGitHub' not found`

**Solution**: Install optional MCP dependencies:

```bash
npm install grep-mcp @upstash/context7-mcp exa-mcp-server
```

#### Beads Gateway Errors

**Error**: `BeadGatewayError: br not found`

**Solution**: Install beads_rust:

```bash
# From https://github.com/your-org/beads_rust
cargo install beads_rust
```

### Debug Mode

Enable verbose logging:

```json
{
  "debug": true
}
```

### Check Status

Always check status for current progress and blockers:

```bash
opencode warcraft_status
```

---

## License

**MIT License with Commons Clause Restriction**

Copyright © 2026 Minh Tri Nguyen

**IMPORTANT**: This software is licensed under the Commons Clause. You may NOT sell the software or use it to provide a SaaS/product whose value derives from its functionality for a fee.

> You are free to:
>
> - Use the software for internal projects
> - Fork and modify for personal use
> - Contribute improvements back to the project
>
> You are NOT free to:
>
> - Sell this software or derived products
> - Offer this as a commercial service
> - Remove or modify the license header

For full license text, see [LICENSE](LICENSE).

---

## Additional Resources

- [Quick Start Guide](docs/quickstart.md) - Detailed end-to-end workflow
- [AGENTS.md](AGENTS.md) - Repository guidelines and architecture deep-dive
- [Skills Documentation](packages/opencode-warcraft/skills/) - Available skills for agents
- [GitHub Issues](https://github.com/your-org/opencode-warcraft/issues) - Bug reports and feature requests

---

## Contributing

Contributions are welcome! Please read [AGENTS.md](AGENTS.md) for development guidelines.

1. Fork the repository
2. Create a feature branch
3. Write tests for your changes
4. Ensure all tests pass: `bun run test`
5. Run linting: `bun run lint`
6. Submit a pull request

### Code of Conduct

- Follow existing code conventions (see Development section)
- Test thoroughly before submitting
- Update documentation as needed
- Be respectful and constructive in discussions

---

## Acknowledgments

**Inspired by** [agent-hive](https://github.com/tctinh/agent-hive) by [tctinh](https://github.com/tctinh)

This project adapts the innovative plan-first workflow concepts pioneered by agent-hive into a Warcraft-themed plugin for OpenCode. Key contributions include:

- Plan → Approve → Execute workflow
- Multi-agent orchestration with specialized roles
- Context persistence across sessions
- Worktree isolation for task execution
- Audit trail for all agent actions

---

## License
