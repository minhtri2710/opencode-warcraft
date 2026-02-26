# opencode-warcraft

[![npm version](https://img.shields.io/npm/v/opencode-warcraft)](https://www.npmjs.com/package/opencode-warcraft)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](../../LICENSE)

**From Vibe Coding to Warcraft Coding** — The OpenCode plugin that brings structure to AI-assisted development.

## Why Warcraft?

Stop losing context. Stop repeating decisions. Start shipping with confidence.

```
Vibe: "Just make it work"
Warcraft: Plan → Review → Approve → Execute → Ship
```

## Installation

```bash
npm install opencode-warcraft
```

## Optional: Enable MCP Research Tools

1. Create `.opencode/mcp-servers.json` using the template:
   - From this repo: `packages/opencode-warcraft/templates/mcp-servers.json`
   - Or from npm: `node_modules/opencode-warcraft/templates/mcp-servers.json`
2. Set `EXA_API_KEY` to enable `websearch_exa` (optional).
3. Restart OpenCode.

This enables tools like `grep_app_searchGitHub`, `context7_query-docs`, and `websearch_web_search_exa`.

## The Workflow

1. **Create Feature** — `warcraft_feature_create("dark-mode")`
2. **Write Plan** — AI generates structured plan
3. **Review** — You review `plan.md`, add comments in `plan.md`
4. **Approve** — `warcraft_plan_approve()`
5. **Execute** — Tasks run in isolated git worktrees
6. **Ship** — Clean commits, full audit trail

### Workflow guardrails

- **Standard path**: default full plan.
- **Lightweight path**: for trivial/simple work, include `Workflow Path: lightweight`, keep 1-2 tasks, and include `Impact`, `Safety`, `Verify`, `Rollback`.
- `warcraft_plan_approve` validates `## Plan Review Checklist`; it blocks when `WARCRAFT_WORKFLOW_GATES_MODE=enforce` and warns in default `warn` mode.
- `warcraft_worktree_commit` completion summary must include build/test/lint pass evidence.
- PRs should map to artifact evidence (`plan.md`, task `report.md`, verification output).

Recommended local checks:

```bash
bun run workflow:verify    # Validates beads artifacts + PR evidence structure
bun run lint               # Type-check all packages
```

### Planning-mode delegation

During planning, "don't execute" means "don't implement" (no code edits, no worktrees). Read-only exploration is explicitly allowed and encouraged, both via local tools and by delegating to Scout.

#### Canonical Delegation Threshold

- Delegate to Scout when you cannot name the file path upfront, expect to inspect 2+ files, or the question is open-ended ("how/where does X work?").
- Local `read`/`grep`/`glob` is acceptable only for a single known file and a bounded question.

## Architecture

### Core/Plugin Boundary

Warcraft separates concerns between `warcraft-core` (shared domain logic) and `opencode-warcraft` (OpenCode plugin):

- **`warcraft-core`** returns structured data (e.g., `SpecData` from `TaskService.buildSpecData()`)
- **`opencode-warcraft`** formats data for presentation (e.g., `formatSpecContent()` converts `SpecData` to markdown)
- **BV triage** is extracted to `BvTriageService` with explicit state ownership (health, cache)

This separation allows:
- Core to remain plugin-agnostic
- Plugin to handle presentation concerns (markdown formatting, CLI output)
- Better testability with clear contracts between layers

## Tools (17 total)

### Feature Management
| Tool | Description |
|------|-------------|
| `warcraft_feature_create` | Create a new feature |
| `warcraft_feature_complete` | Mark feature as complete |

### Planning
| Tool | Description |
|------|-------------|
| `warcraft_plan_write` | Write plan.md |
| `warcraft_plan_read` | Read plan and comments |
| `warcraft_plan_approve` | Approve plan for execution |

### Tasks
| Tool | Description |
|------|-------------|
| `warcraft_tasks_sync` | Generate tasks from plan |
| `warcraft_task_create` | Create manual task |
| `warcraft_task_update` | Update task status/summary |

### Worktree
| Tool | Description |
|------|-------------|
| `warcraft_worktree_create` | Start work on task (creates worktree) |
| `warcraft_worktree_commit` | Complete task and write report (does not merge) |
| `warcraft_worktree_discard` | Abort task and discard changes |

### Merge
| Tool | Description |
|------|-------------|
| `warcraft_merge` | Merge task branch into main branch |

### Batch
| Tool | Description |
|------|-------------|
| `warcraft_batch_execute` | Execute multiple task operations in one call |

### Context & Status
| Tool | Description |
|------|-------------|
| `warcraft_context_write` | Write/update feature context files |
| `warcraft_status` | Return consolidated feature/task status JSON |

### Skill & AGENTS.md
| Tool | Description |
|------|-------------|
| `warcraft_skill` | Load registered Warcraft skills by ID |
| `warcraft_agents_md` | Read/append/replace AGENTS.md guidance |
## Prompt Budgeting & Observability

Warcraft automatically bounds worker prompt sizes to prevent context overflow and tool output truncation.

### Budgeting Defaults

| Limit | Default | Description |
|-------|---------|-------------|
| `maxTasks` | 10 | Number of previous tasks included |
| `maxSummaryChars` | 2,000 | Max chars per task summary |
| `maxContextChars` | 20,000 | Max chars per context file |
| `maxTotalContextChars` | 60,000 | Total context budget |

When limits are exceeded, content is truncated with `...[truncated]` markers and file path hints are provided so workers can read the full content.

### Observability

`warcraft_worktree_create` output includes metadata fields:

- **`promptMeta`**: Character counts for plan, context, previousTasks, spec, workerPrompt
- **`payloadMeta`**: JSON payload size, whether prompt is inlined or referenced by file
- **`budgetApplied`**: Budget limits, tasks included/dropped, path hints for dropped content
- **`warnings`**: Array of threshold exceedances with severity levels (info/warning/critical)

### Prompt Transport

`warcraft_worktree_create` returns delegated execution input inline in `taskToolCall.prompt` with `taskPromptMode: "opencode-inline"`.

Worker prompts are persisted to `<warcraft-root>/<feature>/tasks/<task>/worker-prompt.md` (`.beads/artifacts` in beadsMode `on`, `docs` in beadsMode `off`) for traceability and recovery, while delegation uses inline prompt payloads.

## Plan Format

```markdown
# Feature Name

## Overview
What we're building and why.

## Tasks

### 1. Task Name
Description of what to do.

### 2. Another Task
Description.
```

## Configuration

Warcraft uses a config file at `~/.config/opencode/opencode_warcraft.json`. You can customize agent models, variants, disable skills, and disable MCP servers.

### Beads Mode

Use `beadsMode` to control integration with the **beads_rust (`br`)** CLI. Accepts boolean or string values:

```json
{
  "$schema": "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  "beadsMode": "on"
}
```

**`beadsMode: "on"` (default)** — Beads-native state:
- Beads are the **canonical source of truth** for feature and task state
- Local cache is still maintained under `.beads/artifacts/<feature>/` while bead artifacts remain canonical
- Feature lifecycle and approval state are sourced from bead epics/artifacts via `br` CLI
- Feature creation does not pre-create task status files
- Plan approval stored in bead artifacts with SHA-256 content hash
- Warcraft tools run `br sync --import-only` at start and `br sync --flush-only` at end
- Manual git operations required for `.beads/` directory

**`beadsMode: "off"`** — Legacy local artifacts:
- Local `docs/<feature>/` files remain authoritative
- Feature creation initializes `docs/<feature>/feature.json`, `docs/<feature>/context/`, and `docs/<feature>/tasks/`; task `status.json` files are created when tasks are generated
- Plan approval is persisted in `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)
- No bead integration; works without `br` CLI

**Configuration values**:
- `"on"` or `true`: Enable beads-native mode
- `"off"` or `false`: Disable bead interactions (legacy mode)

**Legacy migration**: Values `"dual-write"` and `"beads-primary"` are no longer supported. Use `"on"` or `"off"` instead.

### Agent Mode

Use `agentMode` to choose between unified and dedicated agent configurations:

- **`"unified"`** (default): Registers Khadgar (hybrid planner+orchestrator), Brann, Mekkatorque, and Algalon. Default agent is Khadgar.
- **`"dedicated"`**: Registers Mimiron (planner), Saurfang (orchestrator), Brann, Mekkatorque, and Algalon. Default agent is Mimiron.

```json
{
	"agentMode": "dedicated"
}
```

Install `br` to use bead lifecycle sync and install `bv` for blocker/causality triage in `warcraft_status` and dependency hints.

### Priority System

Features and tasks require a numeric **priority** (1–5) that determines urgency:

| Priority | Level | Use Case |
|----------|-------|----------|
| 1 | Critical | Blockers, production incidents |
| 2 | High | Important features, near-term deadlines |
| 3 | Medium | Standard work (default) |
| 4 | Low | Nice-to-have improvements |
| 5 | Trivial | Documentation tweaks, minor refactors |

**API usage**:
- `warcraft_feature_create(name, ticket?, priority?)` — optional priority parameter (default: 3)
- `warcraft_task_create(featureName, taskName, order?, priority?)` — optional priority parameter (default: 3)

**Requirements**:
- Must be an integer between 1 and 5 (inclusive)
- Mapped to br priority before CLI calls (`1->0, 2->1, 3->2, 4->3, 5->4`)
- Passed to `br create` commands via `-p <mapped-priority>`

**Examples**:
```typescript
// Create critical priority feature
warcraft_feature_create("Fix production bug", "INCIDENT-123", 1);

// Create medium priority task (default)
warcraft_task_create("my-feature", "Implement API", 1, 3);
```

### Parallel Execution

Control how batch task dispatch works:

```json
{
	"parallelExecution": {
		"strategy": "bounded",
		"maxConcurrency": 4
	}
}
```

- `strategy`: `"unbounded"` (default) dispatches all tasks at once; `"bounded"` limits concurrency.
- `maxConcurrency`: Maximum parallel workers when strategy is `"bounded"` (default: 4).

### Sandbox

Isolate worker execution in Docker containers:

```json
{
	"sandbox": "docker",
	"dockerImage": "node:22-slim",
	"persistentContainers": true
}
```

- `sandbox`: `"none"` (default) or `"docker"`
- `dockerImage`: Override auto-detected image (optional)
- `persistentContainers`: Reuse containers per worktree (default: `true` when sandbox is `"docker"`)
### Plan Approval and Content Hashing

Plan approval uses **SHA-256 content hashing** to detect plan modifications:

1. When `warcraft_plan_approve()` is called:
   - SHA-256 hash of `plan.md` content is computed
   - Approval record stores: hash, timestamp, session ID
   - Full plan snapshot stored alongside approval

2. Plan change detection:
   - If `plan.md` is modified after approval, hash mismatch is detected
   - Approval is automatically invalidated (feature returns to "planning" status)
   - Must re-approve before execution can continue

**Storage by mode**:
- **`beadsMode: "on"`**: Approval stored in bead artifacts:
  - `plan_approval`: JSON with hash, approvedAt, approvedBySession
  - `approved_plan`: Full plan content snapshot
- **`beadsMode: "off"`**: Approval stored in `docs/<feature>/feature.json` (`status`, `approvedAt`, `planApprovalHash`)

### Disable Skills or MCPs

```json
{
  "$schema": "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  "disableSkills": ["brainstorming", "writing-plans"],
  "disableMcps": ["websearch"]
}
```

#### Available Skills

| ID | Description |
|----|-------------|
| `agents-md-mastery` | Use when bootstrapping, updating, or reviewing AGENTS.md — teaches effective agent memory and signal vs noise filtering. |
| `ast-grep` | Guide for writing ast-grep rules to perform structural code search and analysis using AST patterns. |
| `brainstorming` | Use before any creative work — creating features, building components, adding functionality, or modifying behavior. |
| `code-reviewer` | Use when reviewing implementation changes against an approved plan or task to catch missing requirements, YAGNI, dead code, and risky patterns. |
| `dispatching-parallel-agents` | Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies. |
| `docker-mastery` | Use when working with Docker containers — debugging failures, writing Dockerfiles, docker-compose, image optimization, or deploying containerized apps. |
| `executing-plans` | Use when you have a written implementation plan to execute in a separate session with review checkpoints. |
| `finishing-a-development-branch` | Use when implementation is complete and you need to choose how to integrate, preserve, or discard worktree changes safely. |
| `parallel-exploration` | Use when you need parallel, read-only exploration with task() (Brann fan-out). |
| `receiving-code-review` | Use when review feedback arrives and you must evaluate, clarify, and apply it with technical rigor. |
| `requesting-code-review` | Use when finishing a task or milestone and you need an explicit review pass before merge or handoff. |
| `subagent-driven-development` | Use when executing an approved multi-task plan in the current session with fresh worker context per task. |
| `systematic-debugging` | Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes. |
| `test-driven-development` | Use when implementing any feature or bugfix, before writing implementation code. |
| `using-git-worktrees` | Use when starting implementation work that requires isolation from the current branch and reproducible task execution. |
| `verification-before-completion` | Use when about to claim work is complete, fixed, or passing — requires running verification commands and confirming output before making any success claims. |
| `warcraft` | Plan-first AI development with isolated git worktrees and human review. Use for any feature development. |
| `writing-plans` | Use when you have a spec or requirements for a multi-step task, before touching code. |
| `writing-skills` | Use when creating or updating built-in skills so they remain discoverable, testable, and aligned with Warcraft workflows. |

#### Available MCPs

| ID | Description | Requirements |
|----|-------------|--------------|
| `websearch` | Web search via [Exa AI](https://exa.ai). Real-time web searches and content scraping. | Set `EXA_API_KEY` env var |
| `context7` | Library documentation lookup via [Context7](https://context7.com). Query up-to-date docs for any programming library. | None |
| `grep_app` | GitHub code search via [grep.app](https://grep.app). Find real-world code examples from public repositories. | None |

### Per-Agent Skills

Each agent can have specific skills enabled. If configured, only those skills appear in `warcraft_skill()`:

```json
{
  "agents": {
    "khadgar": {
      "skills": ["brainstorming", "writing-plans", "dispatching-parallel-agents", "executing-plans"]
    },
    "mekkatorque": {
      "skills": ["test-driven-development", "verification-before-completion"]
    }
  }
}
```

**How `skills` filtering works:**

| Config | Result |
|--------|--------|
| `skills` omitted | All skills enabled (minus global `disableSkills`) |
| `skills: []` | All skills enabled (minus global `disableSkills`) |
| `skills: ["tdd", "debug"]` | Only those skills enabled |

Note: Wildcards like `["*"]` are **not supported** - use explicit skill names or omit the field entirely for all skills.

### Auto-load Skills

Use `autoLoadSkills` to automatically inject skills into an agent's system prompt at session start.

```json
{
  "$schema": "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  "agents": {
    "khadgar": {
      "autoLoadSkills": ["parallel-exploration"]
    },
    "mekkatorque": {
      "autoLoadSkills": ["test-driven-development", "verification-before-completion"]
    }
  }
}
```

**Supported skill sources:**

`autoLoadSkills` accepts both Warcraft builtin skill IDs and file-based skill IDs. Resolution order:

1. **Warcraft builtin** — Skills bundled with opencode-warcraft (always win if ID matches)
2. **Project OpenCode** — `<project>/.opencode/skills/<id>/SKILL.md`
3. **Global OpenCode** — `~/.config/opencode/skills/<id>/SKILL.md`
4. **Project Claude** — `<project>/.claude/skills/<id>/SKILL.md`
5. **Global Claude** — `~/.claude/skills/<id>/SKILL.md`

Skill IDs must be safe directory names (no `/`, `\`, `..`, or `.`). Missing or invalid skills emit a warning and are skipped—startup continues without failure.

**How `skills` and `autoLoadSkills` interact:**

- `skills` controls what appears in `warcraft_skill()` — the agent can manually load these on demand
- `autoLoadSkills` injects skills unconditionally at session start — no manual loading needed
- These are **independent**: a skill can be auto-loaded but not appear in `warcraft_skill()`, or vice versa
- User `autoLoadSkills` are **merged** with defaults (use global `disableSkills` to remove defaults)

**Default auto-load skills by agent:**

| Agent | autoLoadSkills default |
|-------|------------------------|
| `khadgar` | `parallel-exploration` |
| `mimiron` | `parallel-exploration` |
| `saurfang` | (none) |
| `brann` | (none) |
| `mekkatorque` | `test-driven-development`, `verification-before-completion` |
| `algalon` | (none) |

### Per-Agent Model Variants

You can set a `variant` for each Warcraft agent to control model reasoning/effort level. Variants are keys that map to model-specific option overrides defined in your `opencode.json`.

```json
{
  "$schema": "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  "agents": {
    "khadgar": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "variant": "high"
    },
    "mekkatorque": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "variant": "medium"
    },
    "brann": {
      "variant": "low"
    }
  }
}
```

The `variant` value must match a key in your OpenCode config at `provider.<provider>.models.<model>.variants`. For example, with Anthropic models you might configure thinking budgets:

```json
// opencode.json
{
  "provider": {
    "anthropic": {
      "models": {
        "claude-sonnet-4-20250514": {
          "variants": {
            "low": { "thinking": { "budget_tokens": 5000 } },
            "medium": { "thinking": { "budget_tokens": 10000 } },
            "high": { "thinking": { "budget_tokens": 25000 } }
          }
        }
      }
    }
  }
}
```

**Precedence:** If a prompt already has an explicit variant set, the per-agent config acts as a default and will not override it. Invalid or missing variant keys are treated as no-op (the model runs with default settings).

### Custom Models

Override models for specific agents:

```json
{
  "agents": {
    "khadgar": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.5
    }
  }
}
```

## Troubleshooting

### Worktree Dependencies (Module Not Found)

Worktrees are isolated git checkouts and do not share the root `node_modules`. If tests or builds fail with "module not found" errors inside a worktree:

```bash
# Option 1: Install dependencies in the worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install

# Option 2: Run from repo root (recommended)
cd /path/to/repo/root
bun run test --filter warcraft-core
```

## License

MIT with Commons Clause — Free for personal and non-commercial use. See [LICENSE](../../LICENSE) for details.

---

**Stop vibing. Start questing.** ⚔️
