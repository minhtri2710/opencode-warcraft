# Autoresearch: Bug Hunting in warcraft-core

## Goal
Systematically explore code files in `packages/warcraft-core/`, understand their purpose and execution flows, and find/fix bugs, errors, and issues.

## Primary Metric
- **tests_passing**: Number of tests passing (higher is better)
- Baseline: 987 tests passing, 0 failing

## Rules
1. Each iteration: pick a code file (or cluster), read deeply, trace imports/exports, find bugs
2. Fix bugs carefully, ensuring all existing tests still pass
3. Add tests for any bugs found where appropriate
4. Never break existing functionality
5. Conform to AGENTS.md code style (Biome, ESM .js extensions, import type, etc.)

## Checks
- `bun test packages/warcraft-core/` must pass with 0 failures
- `bun run lint` must pass (typecheck)
