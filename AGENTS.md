# AGENTS.md — opencode-warcraft

## Commands
- **Build**: `bun run build` | **Test all**: `bun run test` | **Single test**: `bun test packages/warcraft-core/src/services/featureService.test.ts` | **Typecheck**: `bun run lint` | **Format**: `bun run format`
- Package filter: `bun run test --filter warcraft-core` | Generate skills: `bun run generate-skills` (from `packages/opencode-warcraft/`)

## Architecture
- Bun monorepo with two packages: `warcraft-core` (domain logic: services, stores, types) and `opencode-warcraft` (OpenCode plugin: agents, tools, hooks, MCP, skills, DI container)
- Service layer with DI (`container.ts`), pluggable storage (beads vs filesystem via `beadsMode`), 6 specialized agents (Khadgar, Mimiron, Saurfang, Brann, Mekkatorque, Algalon), 17 tools across 7 domain modules
- Data flow: feature create → plan write → plan approve (SHA-256 hash) → tasks sync → worktree create → worker executes → worktree commit → merge

## Code Style
- **Runtime**: Bun 1.3.9+; **Formatter**: Biome (2-space indent, single quotes, semicolons, trailing commas, 120 char width)
- **ESM**: local imports require `.js` extension; use `import type` for type-only imports
- **Naming**: PascalCase types/classes, camelCase functions/vars, UPPER_SNAKE_CASE constants, kebab-case files, `*.test.ts` co-located tests
- **Patterns**: async/await over promises, explicit return types on public functions, structured errors with codes (`throw new XError(code, msg, details)`), tool responses via `toolSuccess()`/`toolError()`
- **Testing**: `bun:test` with `describe/it/expect`; `spyOn` for mocking; E2E helpers in `packages/opencode-warcraft/src/e2e/helpers/test-env.ts`
