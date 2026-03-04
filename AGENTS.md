# Repository Guidelines

## Project Overview

**opencode-warcraft** is a feature development system built as an OpenCode plugin. It implements a plan-first workflow (Plan → Approve → Execute) using a character-based agent model with specialized roles.

**Key Concept**: Features are tracked through "beads" (task management entities) with human-shaped plans and agent-built implementations.

## Architecture & Data Flow

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
        ├── tools/           # Warcraft tool implementations (17 tools)
        ├── mcp/             # MCP integration (websearch, grep-app, context7)
        ├── hooks/           # Event hooks (variant, compaction)
        ├── skills/          # Skill definitions and generated registry
        ├── e2e/             # End-to-end tests
        └── container.ts     # Dependency injection root
```

### Architecture Patterns

**Service Layer Architecture**: Class-based services with dependency injection
- `FeatureService` - Feature lifecycle management
- `TaskService` - Task CRUD with dependency resolution and validation
- `PlanService` - Plan storage and retrieval
- `BeadGateway` - CLI interface to beads_rust (`br` commands)
- Stores: `FeatureStore`, `TaskStore`, `PlanStore` (pluggable: beads vs filesystem)

**Storage Abstraction**: Two modes controlled by `beadsMode` config
- **`"on"`** (default): Beads-native - beads are canonical, local files are cache
- **`"off"`**: Legacy local files mode - `.beads/artifacts/` files are authoritative

**Agent Model**: Six specialized agents with distinct roles
- **Khadgar** (Hybrid): Plans + orchestrates, detects phase, loads skills on-demand
- **Mimiron** (Planner): Plans features, interviews, writes plans. NEVER executes
- **Saurfang** (Orchestrator): Orchestrates execution, delegates, spawns workers, verifies
- **Brann** (Explorer): Researches codebase + external docs/data
- **Mekkatorque** (Worker): Executes tasks directly in isolated worktrees. Never delegates
- **Algalon** (Consultant): Reviews plan/code quality. OKAY/REJECT verdict

**Dependency Injection**: Container pattern in `container.ts` composes all services and tool modules

**Tool Domains** (17 tools total): Feature, Plan, Task, Worktree, Merge, Batch, Context, AGENTS.md, Status, Skill

### Data Flow

1. User creates feature via `warcraft_feature_create(name)`
2. Human writes plan via `warcraft_plan_write(content)`
3. User approves plan via `warcraft_plan_approve()` (stores SHA-256 hash for integrity)
4. `warcraft_tasks_sync()` generates tasks from plan
5. `warcraft_worktree_create(task)` creates isolated worktree per task
6. Worker executes in worktree → `warcraft_worktree_commit(task, summary)` commits to task branch
7. `warcraft_merge(task)` merges task branch into main

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `packages/warcraft-core/src/services/` | Core business logic services |
| `packages/warcraft-core/src/services/beads/` | Beads_rust CLI integration |
| `packages/warcraft-core/src/services/state/` | Storage abstraction layer |
| `packages/opencode-warcraft/src/agents/` | Agent system prompts and definitions |
| `packages/opencode-warcraft/src/tools/` | Tool implementations (7 domain modules) |
| `packages/opencode-warcraft/src/skills/` | Skill definitions (SKILL.md files) |
| `packages/opencode-warcraft/src/hooks/` | Event hooks (variant injection, compaction) |
| `packages/opencode-warcraft/src/mcp/` | MCP server integration |
| `packages/opencode-warcraft/src/e2e/` | End-to-end integration tests |
| `.beads/artifacts/` | Feature/task state (beadsMode on) |

## Development Commands

### Build & Test (from root)

```bash
# Build all packages
bun run build

# Run all tests
bun run test

# Type checking
bun run lint

# Format code
bun run format

# Full release check
bun run release:check
```

### Package-Specific Commands

```bash
# From packages/warcraft-core/
bun run build             # Build core library
bun run test              # Run tests
bun run typecheck         # Type check without emit

# From packages/opencode-warcraft/
bun run generate-skills   # Generate skills registry from SKILL.md files
bun run build             # Build plugin (includes skill generation)
bun run dev               # Watch mode for development
bun run test              # Run tests
bun run typecheck         # Type check without emit
```

### Worktree Dependency Note

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

## Code Conventions & Common Patterns

### TypeScript Configuration

- **Target**: ES2022 with ESNext modules
- **Mode**: Strict mode enabled
- **Modules**: ESM with `.js` extension required for local imports
- **Resolution**: `bundler` mode for modern module resolution

### Naming Conventions

| Category | Convention | Example |
|----------|------------|---------|
| Types/Interfaces | `PascalCase` | `FeatureInfo`, `TaskInput` |
| Classes | `PascalCase` | `FeatureService`, `BeadGateway` |
| Functions/Variables | `camelCase` | `readFeatureJson`, `ensureFeatureDir` |
| Constants | `UPPER_SNAKE_CASE` | `COMPLETION_GATES`, `MAX_TASKS` |
| Files | `kebab-case.ts` | `config-service.ts`, `task-tools.ts` |
| Test files | `*.test.ts` | `featureService.test.ts` |

### Import/Export Patterns

```typescript
// Type imports - separate with `import type`
import type { Feature, Task } from './types.js';

// Value imports
import { FeatureService, TaskService } from './services/index.js';

// Local imports MUST use .js extension (ESM requirement)
import { readJson } from './utils/fs.js';
```

### Service Class Pattern

```typescript
export class FeatureService {
  constructor(
    private readonly config: Config,
    private readonly store: FeatureStore
  ) {}

  async createFeature(name: string): Promise<Feature> {
    // Explicit error handling
    try {
      const feature = await this.store.create(name);
      return feature;
    } catch (error) {
      throw new FeatureServiceError(
        'feature_create_failed',
        `Failed to create feature: ${error.message}`,
        { featureName: name }
      );
    }
  }
}
```

### Async/Await Patterns

- **Prefer async/await** over raw promise chaining
- **Always specify return types** for public functions: `Promise<T>`
- **Use explicit error types** with error codes

```typescript
// Good: Explicit types, error handling
async function loadConfig(path: string): Promise<Config> {
  try {
    const data = await fs.readFile(path, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    throw new ConfigError('config_load_failed', `Failed: ${error.message}`);
  }
}
```

### Error Handling Patterns

**Custom Error Classes**:
```typescript
export class BeadGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BeadGatewayError';
  }
}

// Usage
throw new BeadGatewayError(
  'br_not_found',
  'br CLI not found or not usable',
  { command: 'br', exitCode: error.exitCode }
);
```

**Structured Tool Responses**:
```typescript
// Success
return toolSuccess({ featureId, path });

// Error with hints
return toolError(
  'Feature not found',
  ['Check that the feature exists with `warcraft_status`']
);
```

### Dependency Injection Pattern

Services are composed in `container.ts`:
```typescript
export function createContainer(config: Config) {
  const store = new BeadFeatureStore(config);
  const featureService = new FeatureService(config, store);
  const taskService = new TaskService(config, store);

  return {
    featureService,
    taskService,
    // ... wire up tool modules with services
  };
}
```

### Validation Patterns

**Pure validation functions** in `guards.ts`:
```typescript
export const VALID_TASK_STATUSES = new Set<TaskStatusType>([
  'pending',
  'in_progress',
  'completed',
  'abandoned',
]);

export function validateTaskStatus(status: string): TaskStatusType {
  if (!VALID_TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: "${status}"`);
  }
  return status as TaskStatusType;
}
```

### Tool Implementation Pattern

```typescript
export const warcraftFeatureCreate: Tool = {
  name: 'warcraft_feature_create',
  description: 'Create a new feature',
  parameters: z.object({
    name: z.string().min(1),
    priority: z.number().min(1).max(5).default(3),
  }),
  executor: async (params, context) => {
    // Validate inputs
    const validated = validateFeatureName(params.name);

    // Execute business logic
    const feature = await context.services.feature.create(validated, params.priority);

    // Return structured response
    return toolSuccess({ feature });
  },
};
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/warcraft-core/src/index.ts` | Core package entry point |
| `packages/opencode-warcraft/src/index.ts` | Plugin entry point with system prompt, hooks, MCP |
| `packages/opencode-warcraft/src/container.ts` | Dependency injection root |
| `packages/warcraft-core/src/types.ts` | Core type definitions (150 lines) |
| `packages/warcraft-core/src/services/state/types.ts` | Storage port interfaces |
| `packages/opencode-warcraft/src/guards.ts` | Validation functions and constants |
| `packages/opencode-warcraft/src/utils/prompt-budgeting.ts` | Task budgeting logic |
| `packages/opencode-warcraft/scripts/generate-skills.ts` | Code generation for skills registry |

## Runtime/Tooling Preferences

### Runtime
- **Required**: Bun 1.3.9+
- **Package Manager**: Bun (not npm/yarn/pnpm)
- **Reasoning**: Built-in test runner, fast bundling, workspace support

### Build Tooling
- **Bundler**: Bun's built-in bundler (`bun build`)
- **TypeScript**: `tsc` for declaration emission only (`--emitDeclarationOnly`)
- **Linting/Formatting**: Biome (unified replacement for ESLint + Prettier)

### Biome Configuration
- 2-space indentation
- Single quotes for strings
- Semicolons required
- Trailing commas in objects/arrays
- 120 character line width
- VCS integration for optimized checks

## Testing & QA

### Test Framework
- **Bun Test** (`bun test`) - Built-in test runner with `describe`, `it`, `expect`

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
│   └── test-env.ts          # Temp dir setup, git project setup, cleanup
└── plugin-smoke.test.ts     # Full plugin testing
```

### Test Patterns

**Unit Test**:
```typescript
import { describe, expect, it } from 'bun:test';

describe('FeatureService', () => {
  it('should create feature with valid name', async () => {
    const service = new FeatureService(mockConfig, mockStore);
    const feature = await service.createFeature('test-feature');
    expect(feature.name).toBe('test-feature');
  });
});
```

**Service Test with Mocking**:
```typescript
// Use spyOn for child_process mocking
const execSpy = spyOn(BeadGateway.prototype, 'execBrCommand')
  .mockResolvedValueOnce({ stdout: 'mock output', stderr: '' });

await expect(gateway.createTask(featureId, taskData)).resolves.toBe(expected);
```

**E2E Test with Setup/Teardown**:
```typescript
describe('plugin smoke test', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await setupTempGitProject();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('should handle full workflow', async () => {
    // Test full feature creation, planning, task execution
  });
});
```

### Running Tests

```bash
# All tests
bun test

# Specific test file
bun test packages/warcraft-core/src/services/featureService.test.ts

# With filter (from root)
bun run test --filter warcraft-core
```

### Coverage Expectations
- Unit tests for all service methods
- Integration tests for tool workflows
- E2E tests for critical user paths
- Prompt content validation tests for agent system prompts

### Common Test Utilities

**E2E Helper** (`packages/opencode-warcraft/src/e2e/helpers/test-env.ts`):
- `setupTempDir()` - Creates temporary directory
- `setupGitProject()` - Initializes git repo with commits
- `cleanupTempDir()` - Removes temp directories
- `checkHostPrerequisites()` - Conditional test skipping

## Special Considerations

### Beads Mode (beads_rust Integration)

When `beadsMode: "on"` (default):
- Beads are canonical source of truth
- Local `.beads/artifacts/` files are read-through cache
- Must manually git commit `.beads/` changes:
  ```bash
  git add .beads/artifacts/
  git commit -m "beads: update artifact state"
  ```

### Worktree Persistence

Worktrees persist until manually removed:
- `warcraft_worktree_commit` commits to task branch but does NOT merge
- Use `warcraft_merge` to integrate changes
- Clean up worktrees manually when done

### Priority System

Features and tasks require priority (1-5):
- 1 = Critical (blockers, production incidents)
- 2 = High (important features, near-term deadlines)
- 3 = Medium (standard work, default)
- 4 = Low (nice-to-have improvements)
- 5 = Trivial (documentation tweaks, minor refactors)

### Plan Approval Hash Verification

Plan approval uses SHA-256 content hashing to detect changes:
- Approval record stores: hash, timestamp, approving session ID
- If plan content changes, approval is automatically invalidated

### Agent Mode Configuration

`agentMode` in `~/.config/opencode/opencode_warcraft.json`:
- `"unified"` (default): Khadgar (hybrid), Brann, Mekkatorque, Algalon
- `"dedicated"`: Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, Algalon

### Sandbox Configuration

Optional Docker sandbox for isolated test environments:
```json
{
  "sandbox": "docker",
  "dockerImage": "node:22-slim"
}
```

Auto-detects runtime from project files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`).

### Cross-Model Prompts

Agent prompts are designed to work across different LLM providers. Each agent can be backed by a different model:
- **Khadgar** → OpenAI
- **Brann** → Google
- **Mekkatorque** → Kimi
- **Algalon** → zai-coding-plan

Prompts avoid provider-specific features and use plain-text instructions that any capable LLM can follow.

### Verification Model

The `verificationModel` config option (`'tdd' | 'best-effort'`) controls how workers verify their changes:
- **`tdd`** (default): Workers follow strict TDD — write a failing test first, implement the minimum change, confirm tests pass.
- **`best-effort`**: Workers use lightweight checks (LSP diagnostics, ast-grep) instead of full test suites. Full verification is deferred to post-merge by the orchestrator.

## Code Style Checklist

- [ ] Single quotes for strings
- [ ] Semicolons required
- [ ] 2-space indentation
- [ ] Trailing commas in multi-line objects/arrays
- [ ] Explicit return types on public functions
- [ ] `import type` for type-only imports
- [ ] `.js` extension on local imports (ESM)
- [ ] PascalCase for types/classes, camelCase for functions/variables
- [ ] UPPER_SNAKE_CASE for constants
- [ ] Structured error responses with codes
- [ ] Async/await over promise chaining
- [ ] Dependency injection for services
