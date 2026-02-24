# opencode-warcraft Agent Guide

## Package Purpose

`opencode-warcraft` is the OpenCode plugin package.
It wires Warcraft prompts, tools, hooks, skills, and MCP integrations into runtime behavior.

## Main Folders

- `src/agents/`: role prompts and role-specific tests (`khadgar`, `mimiron`, `saurfang`, `brann`, `mekkatorque`, `algalon`)
- `src/hooks/`: runtime hook behavior (variant/system prompt shaping)
- `src/mcp/`: built-in MCP provider wiring (`websearch`, `context7`, `grep-app`)
- `src/skills/`: skill registry, loading, filtering, and generated registry integration
- `src/utils/`: prompt assembly, workflow gates, observability, formatting helpers
- `src/__tests__/`: cross-cutting unit tests for workflow gates and sandbox behavior
- `src/e2e/`: runtime/plugin smoke and integration-level tests
- `docs/`: package-specific design notes and internal docs
- `schema/`: configuration schema assets
- `skills/`: built-in skill markdown content distributed with the plugin
- `templates/`: template files used by plugin workflows
- `scripts/`: local scripts for build/generation support

## Change Workflow

1. Put shared business logic in `warcraft-core` first when possible.
2. Keep plugin-specific behavior in this package (`src/index.ts`, hooks, skills, MCP).
3. Update tests close to touched code (`src/**` test files).
4. Verify with:
   - `bun run test --filter opencode-warcraft`
   - `bun run lint`
   - `bun run build`

## Fast Ownership Map

- Tool behavior and orchestration: `src/index.ts`
- Prompt role changes: `src/agents/`
- Skill loading/registration: `src/skills/`
- MCP integration behavior: `src/mcp/`
- Prompt/workflow gates and budgeting: `src/utils/`
