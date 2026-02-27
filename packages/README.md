# Packages Guide for AI Agents

This directory contains two workspace packages:

- `warcraft-core`: shared domain services and filesystem logic
- `opencode-warcraft`: OpenCode plugin, agent prompts, hooks, and MCP wiring

Use this split when making changes:

1. Put reusable logic in `warcraft-core` first.
2. Keep `opencode-warcraft` focused on plugin integration and runtime behavior.
3. Export shared APIs from `warcraft-core/src/index.ts`.
4. Consume shared APIs from `opencode-warcraft/src/index.ts`.

For workflow details, configuration options (beadsMode, agentMode, priority, plan approval, parallel execution), and tool reference, see the root [AGENTS.md](../AGENTS.md).

## Workflow

1. Identify the package boundary (`core` logic vs plugin runtime).
2. Update code in the correct package.
3. Add or update tests next to touched files.
4. Run package tests first, then workspace checks.

Common commands:

- `bun run test --filter warcraft-core`
- `bun run test --filter opencode-warcraft`
- `bun run lint`
- `bun run build`

## Troubleshooting

### Worktree Dependencies (Module Not Found)

Worktrees are isolated checkouts and do not share the root `node_modules`. If tests or builds fail with "module not found" errors inside a worktree:

```bash
# Option 1: Install dependencies in the worktree
cd .beads/artifacts/.worktrees/<feature>/<task>
bun install
bun run test

# Option 2: Run from repo root (recommended)
cd /path/to/repo/root
bun run test --filter warcraft-core
```
