# Project Warcraft ⚔️

**Evolution to Project Warcraft** — Plan first. Execute with trust. Context persists.

> **Note:** `opencode-warcraft` is the Beads-core orchestration path.
>
> **Fork:** This project is forked by [agent-hive](https://github.com/tctinh/agent-hive).

[![npm version](https://img.shields.io/npm/v/opencode-warcraft.svg)](https://www.npmjs.com/package/opencode-warcraft)
[![License: MIT with Commons Clause](https://img.shields.io/badge/License-MIT%20with%20Commons%20Clause-blue.svg)](LICENSE)

---

## Codebase Overview

This repository is a TypeScript monorepo (bun workspaces) containing the Project Warcraft orchestration system:

| Directory | Purpose |
|-----------|---------|
| `packages/warcraft-core/` | Shared domain services (features, tasks, plans, worktrees) |
| `packages/opencode-warcraft/` | OpenCode plugin — agent tools and MCP integrations |
| `scripts/` | CI, release, and workflow verification scripts |
| `.beads/artifacts/` | Feature state storage (auto-generated) |

See [packages/README.md](packages/README.md) for contributor maps and [AGENTS.md](AGENTS.md) for AI agent guidelines.

---

## The Problem

Vibe coding is powerful but chaotic. Without structure:

| Pain Point | What Happens |
|------------|--------------|
| **Lost context** | New session = start from scratch. "We discussed this yesterday" means nothing. |
| **Subagents go wild** | Parallel agents do their own thing. No coordination, duplicated work. |
| **Scope creep** | "Add dark mode" becomes "rewrite the entire theme system." |
| **Messes to clean up** | Agent changes 47 files. Half are broken. Good luck reverting. |
| **No audit trail** | "What happened?" Nobody knows. Logs scattered everywhere. |
| **Agent hallucination** | Agent invents solutions that don't fit your codebase. No grounding. |

---

## The Warcraft Solution

| Problem | Warcraft Solution |
|---------|---------------|
| Lost context | **Context persists** — Feature-scoped knowledge survives sessions |
| Subagents go wild | **Batched parallelism** — Coordinated execution with context flow |
| Scope creep | **Plan approval gate** — Human shapes, agent builds |
| Messes to clean up | **Worktree isolation** — Each task isolated, easy discard |
| No audit trail | **Automatic tracking** — Every task logged to `.beads/artifacts/` |
| Agent hallucination | **Context files** — Research and decisions ground agent work |

**Warcraft doesn't change how you work. It makes what happens traceable, auditable, and grounded.**

---

## Built on Battle-Tested Principles

We studied what actually works in the AI coding community and built upon it:

| Source | What We Learned | Warcraft Implementation |
|--------|-----------------|---------------------|
| **[Boris Cherny's 13 Tips](https://www.anthropic.com/research/claude-code-best-practices)** | Feedback loops = 2-3x quality | Task-level verification with tests |
| **[Spec Kit](https://github.com/github/spec-kit)** | Specs are valuable | Specs emerge from dialogue, not upfront |
| **[Conductor](https://github.com/gemini-cli-extensions/conductor)** | Context persistence matters | Feature-scoped `.beads/artifacts/context/` |
| **[Ralph Wiggum](https://awesomeclaude.ai/ralph-wiggum)** | Retry loops work for verification | TDD loops, not infinite retries |
| **[Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | Agent delegation scales | OMO as Warcraft commander, Warcraft as workflow |
| **Antigravity** | Plan gates build trust | Plan → Approve → Execute workflow |

> *"Give Claude a way to verify its work. When Claude has a feedback loop, it will 2-3x the quality of the final result."* — Boris Cherny

See [packages/opencode-warcraft/docs](packages/opencode-warcraft/docs) for the current tool inventory and data-model references.

---

## Quick Start

Warcraft follows a **Plan → Review → Approve → Execute** workflow. The planning phase includes discovery (read-only exploration to understand the codebase) before any implementation begins.

### OpenCode

Add `opencode-warcraft` to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-warcraft"]
}
```

OpenCode handles the rest — no manual npm install needed.

### Configuration

Run Project Warcraft once to auto-generate a default configuration at `~/.config/opencode/opencode_warcraft.json`. Review it to ensure it matches your local setup.

```json
{
  "$schema": "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  "agentMode": "unified",
  "disableSkills": [],
  "disableMcps": [],
  "agents": {
    "khadgar": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "temperature": 0.5
    }
  }
}
```

#### Core Options

| Option | Values | Description |
|--------|--------|-------------|
| `agentMode` | `unified` (default), `dedicated` | `unified`: Single `khadgar` agent handles planning + orchestration (Khadgar persona). `dedicated`: Separate `mimiron` (Mimiron) and `saurfang` (Saurfang) agents. |
| `disableSkills` | `string[]` | Globally disable specific skills (won't appear in `warcraft_skill` tool). |
| `disableMcps` | `string[]` | Globally disable MCP servers. Options: `websearch`, `context7`, `grep_app`. |

#### Agent Models

Configure models for each agent role. **Update these to models available on your system:**

```json
{
  "agents": {
    "khadgar": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.5 },
    "brann": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.5 },
    "mekkatorque": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.3 },
    "algalon": { "model": "anthropic/claude-sonnet-4-20250514", "temperature": 0.3 }
  }
}
```

All agents: `khadgar`, `mimiron`, `saurfang`, `brann`, `mekkatorque`, `algalon`.

#### Skills

Skills provide specialized workflows that agents can load on-demand via `warcraft_skill`.

| Skill | Description |
|-------|-------------|
| `brainstorming` | Explores user intent, requirements, and design before implementation |
| `writing-plans` | Creates detailed implementation plans with bite-sized tasks |
| `executing-plans` | Executes tasks in batches with review checkpoints |
| `dispatching-parallel-agents` | Dispatches multiple agents for concurrent independent work |
| `test-driven-development` | Enforces write-test-first, red-green-refactor cycle |
| `systematic-debugging` | Requires root cause investigation before proposing fixes |
| `verification-before-completion` | Requires running verification commands before claiming success |
| `parallel-exploration` | Fan-out research across multiple Brann agents |
| `code-reviewer` | Reviews code changes against plan for quality and alignment |
| `docker-mastery` | Docker container expertise — debugging, docker-compose, optimization |
| `agents-md-mastery` | AGENTS.md quality review — signal vs noise, when to prune |
| `ast-grep` | AST-aware code search workflow and rule authoring for ast-grep CLI |

**Per-agent skills:** Restrict which skills appear in `warcraft_skill()` tool:

```json
{
  "agents": {
    "mekkatorque": {
      "skills": ["test-driven-development", "verification-before-completion"]
    }
  }
}
```

**Auto-load skills:** Automatically inject skills into an agent's system prompt at session start:

```json
{
  "agents": {
    "khadgar": { "autoLoadSkills": ["parallel-exploration"] },
    "mekkatorque": { "autoLoadSkills": ["test-driven-development", "verification-before-completion"] }
  }
}
```

**Supported skill sources for `autoLoadSkills`:**

1. **Warcraft builtin** — Skills bundled with opencode-warcraft (always win if ID matches)
2. **Project OpenCode** — `<project>/.opencode/skills/<id>/SKILL.md`
3. **Global OpenCode** — `~/.config/opencode/skills/<id>/SKILL.md`
4. **Project Claude** — `<project>/.claude/skills/<id>/SKILL.md`
5. **Global Claude** — `~/.claude/skills/<id>/SKILL.md`

Missing or invalid skills emit a warning and are skipped—startup continues without failure.

**How these interact:**
- `skills` controls what's available in `warcraft_skill()` — the agent can manually load these
- `autoLoadSkills` injects skills unconditionally at session start — no manual loading needed
- These are **independent**: a skill can be auto-loaded but not appear in `warcraft_skill()`, or vice versa
- Default `autoLoadSkills` are merged with user config (use `disableSkills` to remove defaults)

#### MCP Research Tools

Auto-enabled by default. Disable with `disableMcps`:

| MCP | Tool | Description | Requirements |
|-----|------|-------------|--------------|
| `websearch` | `websearch_web_search_exa` | Web search via Exa AI | `EXA_API_KEY` env var |
| `context7` | `context7_query-docs` | Library documentation lookup | None |
| `grep_app` | `grep_app_searchGitHub` | GitHub code search via grep.app | None |

#### Model Variants

Set reasoning/effort levels per agent:

```json
{
  "agents": {
    "khadgar": { "model": "anthropic/claude-sonnet-4-20250514", "variant": "high" },
    "mekkatorque": { "variant": "medium" }
  }
}
```

Variants must match keys in your OpenCode config at `provider.<provider>.models.<model>.variants`.

See [packages/opencode-warcraft/README.md](packages/opencode-warcraft/README.md) for advanced configuration options.

### Start Questing

```
You: "Create a feature for user dashboard"
```

That's it. You're questing.

---

## How It Works

### The Old Way (Chaos)

```
Main Agent: "Build auth system"
    │
    ├── Subagent 1: Does... something?
    ├── Subagent 2: Also does... something?
    └── Subagent 3: Conflicts with Subagent 1?
    │
You: "What just happened?" 🤷
```

### The Warcraft Way (Orchestrated)

```
Saurfang (Orchestrator): Creates plan, you approve it
    │
    ├── Batch 1 (parallel):
    │   ├── Mekkatorque A (own worktree, tracked)
    │   ├── Mekkatorque B (own worktree, tracked)
    │   └── Mekkatorque C (own worktree, tracked)
    │           ↓
    │      Context flows forward
    │           ↓
    ├── Batch 2 (parallel):
    │   ├── Mekkatorque D (uses A+B+C results)
    │   └── Mekkatorque E (uses A+B+C results)
    │
Warcraft: Full audit of what each agent did
You: Clear visibility into everything ✅
```

**The Warcraft Agent Roster:**
| Agent | Role |
|-------|------|
| **Khadgar (Hybrid)** 👑 | Plans + orchestrates (phase-aware, skills on-demand) |
| **Mimiron (Planner)** 🏗️ | Discovers requirements, writes plans |
| **Saurfang (Orchestrator)** ⚔️ | Orchestrates execution, delegates to workers |
| **Brann (Explorer/Researcher/Retrieval)** 🔍 | Explores codebase + external docs/data |
| **Mekkatorque (Worker/Coder)** 🔧 | Executes tasks in isolated worktrees |
| **Algalon (Consultant/Reviewer/Debugger)** 🧹 | Reviews plan quality, OKAY/REJECT verdict |

---

## Real Example: Building Auth with Warcraft

### Step 1: Start the Conversation

```
You: "Let's add authentication to the app"
```

The agent creates a structured plan:

```markdown
# User Authentication

## Overview
Add JWT-based authentication with login, signup, and protected routes.

## Tasks

### 1. Extract auth logic to service
Move scattered auth code to dedicated AuthService class.

### 2. Add token refresh mechanism
Implement refresh token rotation for security.

### 3. Update API routes
Convert all routes to use the new AuthService.
```

### Step 2: Review `plan.md` (Discovery + Checklist Gate)

Open `plan.md` and review the plan. The agent performs discovery (read-only exploration) during planning—no code changes until you approve.

Before approving, ensure the plan includes:
- **Discovery findings**: What files were examined, what patterns were found
- **Plan Review Checklist**: Include this section and check required items (enforced when `WARCRAFT_WORKFLOW_GATES_MODE=enforce`; warning-only in default `warn` mode)
- Clear task breakdown with verification steps

You can:
- Read through each task
- Add comments ("Use httpOnly cookies for tokens")
- Request changes if discovery seems incomplete
- Approve when ready

### Step 3: Execute

```
You: "Execute"
```

Each task runs in its own worktree. Parallel agents don't conflict. Everything is tracked.

### Step 4: Ship

When done, you have:

- **Working code** — Auth system implemented
- **Clean git history** — Each task merged cleanly
- **Full audit trail** — What was done, when, by which agent

```
.beads/artifacts/user-auth/
├── feature.json         # Feature metadata
├── plan.md              # Your approved plan
├── context/             # Decisions and calibration
│   └── architecture.md
└── tasks/
    ├── 01-extract-auth-logic/
    │   ├── status.json  # Task state
    │   ├── spec.md      # Task context, prior/upcoming tasks
    │   └── report.md    # Summary, files changed, diff stats
    ├── 02-add-token-refresh/
    │   ├── status.json
    │   ├── spec.md
    │   └── report.md
    └── 03-update-api-routes/
        ├── status.json
        ├── spec.md
        └── report.md
```

**That's Warcraft workflow.** Natural conversation → structured plan → approved execution → documented result.

---

## Troubleshooting

### Worktree Dependencies (Module Not Found)

Worktrees are isolated git checkouts and do not share the root `node_modules`. If tests or builds fail with "module not found" errors inside a worktree:

```bash
# Run from within the worktree directory
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install

# Or run tests from the repo root (which has dependencies installed)
cd /path/to/repo/root
bun run test
```

---

## The Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  1. PLAN                                                    │
│  Chat with your agent about what to build                   │
│  Agent creates structured plan in .beads/artifacts/                    │
├─────────────────────────────────────────────────────────────┤
│  2. REVIEW (plan.md)                                        │
│  Open and review plan.md                                    │
│  Add comments in plan.md, refine, approve                   │
├─────────────────────────────────────────────────────────────┤
│  3. EXECUTE (parallel-friendly)                             │
│  Tasks run in isolated worktrees                            │
│  Batched parallelism with context flow                      │
├─────────────────────────────────────────────────────────────┤
│  4. SHIP                                                    │
│  Clean merges, full history                                 │
│  Context persists for next time                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Workflow Guardrails

To keep speed and auditability balanced, use two explicit planning paths:

- **Standard path** (default): full discovery depth and multi-task plans.
- **Lightweight path** (small/trivial work): add `Workflow Path: lightweight`, keep plan at 1-2 tasks, and include mini-record fields `Impact`, `Safety`, `Verify`, `Rollback`.

`warcraft_plan_approve` validates the checklist. In `WARCRAFT_WORKFLOW_GATES_MODE=enforce`, incomplete checklist items block approval; in default `warn` mode, approval succeeds with warnings.

For pull requests, include evidence links to:

- feature `plan.md`
- task `report.md` files
- verification command output summary

CI should validate that:

- `.beads/artifacts` stays in sync after `br sync --flush-only`
- PR evidence sections are present and reference valid artifact paths

### Pre-PR Checks (Required)

Before creating a pull request, run these commands locally:

```bash
# Verify workflow compliance (non-zero exit on drift, zero when clean)
bun run workflow:verify

# Full release check (install, build, test, lint)
bun run release:check
```

These checks are enforced by CI and will fail the build if:
- Beads artifacts are out of sync (`br sync --flush-only` produces changes)
- Required PR evidence sections are missing
- Build, tests, or linting fail

No warning-mode bypasses are available.

---

## Packages

| Package | Platform | Description |
|---------|----------|-------------|
| **[warcraft-core](packages/warcraft-core/AGENTS.md)** | workspace | Shared domain services, task/plan/worktree logic, and utilities |
| **[opencode-warcraft](https://www.npmjs.com/package/opencode-warcraft)** | npm | OpenCode plugin — Beads-core orchestration (recommended) |

Contributor maps for AI agents:

- [packages/README.md](packages/README.md)
- [packages/warcraft-core/AGENTS.md](packages/warcraft-core/AGENTS.md)
- [packages/opencode-warcraft/AGENTS.md](packages/opencode-warcraft/AGENTS.md)

**Agent Selection:** Use `khadgar`, `mimiron`, or `saurfang` as your primary agent. Use `@brann`, `@mekkatorque`, or `@algalon` for subagents.

---

## Why Warcraft?

### 🎯 Plan First

Human shapes the what and why. Agent handles the how. The approval gate is where trust is earned.

### 🤖 Easy Orchestrate

Break work into isolated tasks. Subagents work in parallel without conflicts. Batches coordinate context flow.

### 📊 Easy Audit

Every decision, every change, every agent action — automatically captured in `.beads/artifacts/`

### 🚀 Easy Ship

Clean git history (worktree merges), full documentation (generated as you work), traceable decisions (who did what, when).

---

## Comparison

| Feature | Vibe Coding | Spec-First Tools | Project Warcraft |
|---------|-------------|------------------|------------|
| Setup required | None | Heavy | Minimal |
| Documentation | None | Upfront | Emerges from work |
| Planning | Ad-hoc | Required first | Conversational |
| Tracking | None | Manual | Automatic |
| Audit trail | None | If maintained | Built-in |
| Multi-agent ready | Chaos | ❌ | ✅ Native |
| Subagent tracing | Painful | ❌ | ✅ Automatic |
| Plan file review | ❌ | ❌ | ✅ Full support |

---

## Philosophy

Warcraft is built on 7 core principles:

1. **Context Persists** — Calibration survives sessions. The "3 months later" problem solved.
2. **Plan → Approve → Execute** — Dialogue until approved, then trust. Two phases with a clear gate.
3. **Human Shapes, Agent Builds** — Human owns the why. Agent owns the how.
4. **Good Enough Wins** — Capture what works for this context. Reject over-engineering.
5. **Batched Parallelism** — Parallel tasks in batches. Sequential batches share context.
6. **Tests Define Done** — For implementation tasks, tests provide the feedback loop.
7. **Iron Laws + Hard Gates** — Non-negotiable constraints enforced by tools, not guidelines.

See [AGENTS.md](AGENTS.md) and [packages/opencode-warcraft/docs](packages/opencode-warcraft/docs) for current workflow and data-model details.

---

## Related Tools

Warcraft complements these excellent projects:

| Tool | What It Does | How Warcraft Relates |
|------|--------------|------------------|
| **[Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | Agent-first delegation with specialized workers | Perfect combo: OMO as a Warcraft commander orchestrating Warcraft workers |
| **[Conductor](https://github.com/gemini-cli-extensions/conductor)** | Context-driven track-based execution | Similar goals; Warcraft adds worktree isolation + batching |
| **[Spec Kit](https://github.com/github/spec-kit)** | Heavy upfront specification | Warcraft: specs emerge from planning, not before |
| **[Ralph Wiggum](https://awesomeclaude.ai/ralph-wiggum)** | Loop-until-done persistence | Different philosophy; Warcraft plans first, not retries first |

---

## Platform Support

| Platform | Setup | Status |
|----------|-------|--------|
| **OpenCode** | Add `opencode-warcraft` plugin | Full support |

Designed to work seamlessly with:

- **[OpenCode](https://opencode.ai)** — The AI coding CLI
- **Git** — Worktrees for isolation

---

## License

MIT with Commons Clause — Free for personal and non-commercial use. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <strong>Stop vibing. Start questing.</strong> ⚔️
  <br>
  <em>Plan first. Execute with trust. Context persists.</em>
</p>
