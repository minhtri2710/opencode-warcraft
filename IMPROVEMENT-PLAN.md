# opencode-warcraft Improvement Plan

> Deep review performed on 2026-03-01. All 239 tests pass, 0 failures.

## Summary

**Project health**: Solid foundation — clean monorepo layout, well-defined service boundaries (`warcraft-core` / `opencode-warcraft`), pluggable state stores, comprehensive type system. The core architecture is sound.

**Key numbers**:
- ~14,000 LoC production TypeScript, ~15,200 LoC tests (1.08:1 test ratio ✓)
- 239 tests passing across 23 files
- 31 Biome lint warnings (all `noExcessiveCognitiveComplexity`)
- 38 source files with no unit tests
- 3 broken internal links (missing `LICENSE` file)

---

## Priority 1 — Critical (Blocking Quality / Correctness)

### 1.1 Missing LICENSE file

**Impact**: README, warcraft-core README, and opencode-warcraft README all link to `LICENSE`, but the file doesn't exist. npm package says "MIT with Commons Clause" but there's no legal text.

**Fix**: Create a `LICENSE` file at repo root with the MIT + Commons Clause text.

### 1.2 `node_modules` not in `.gitignore`

**Impact**: Risk of accidentally committing `node_modules/` to git. Currently clean only because it hasn't been staged.

**Fix**: Add `node_modules/` to `.gitignore`.

### 1.3 Ghost script references in README

The root `README.md` references two scripts that don't exist:
- `bun run workflow:verify` — not defined in `package.json`
- `bun run release:prepare` — referenced in `AGENTS.md` but not in `package.json`
- `scripts/` directory — mentioned in README's layout table but doesn't exist at root

**Fix**: Either create these scripts or remove the references.

### 1.4 Empty skill directory: `using-superpowers`

`packages/opencode-warcraft/skills/using-superpowers/` exists as an empty directory with no `SKILL.md`. It's not listed in the README skill table either. Likely a stale placeholder.

**Fix**: Remove the empty directory, or add the missing `SKILL.md`.

---

## Priority 2 — High (Code Quality & Maintainability)

### 2.1 Resolve 31 cognitive complexity warnings

20 unique functions across the codebase exceed the Biome complexity threshold of 15. Key offenders:

| File | Score | Function |
|------|-------|----------|
| `opencode-runtime-smoke.test.ts:164` | 31 | e2e test body |
| `opencode-runtime-smoke.test.ts:217` | 28 | `approvePermissions` |
| `container.ts:188` | 24 | `checkDependencies` |
| `plugin-config.ts:138` | — | `applyWarcraftConfig` |
| `worktree-tools.ts:46` | — | worktree create handler |
| `context-tools.ts` (3 functions) | — | status/context tools |
| `json-lock.ts` (2 functions) | 16 | `acquireLock` / `acquireLockSync` |

**Fix**: Extract helpers, split branching into separate functions, use early returns. Target: zero complexity warnings.

### 2.2 Test coverage gaps — filesystem stores have no direct tests

The 3 filesystem store implementations (`fs-feature-store.ts`, `fs-task-store.ts`, `fs-plan-store.ts`) have no dedicated test files. They're only tested transitively through service-level tests.

Other notable untested files:
- `guards.ts` — validation and gate logic (pure functions, easy to test)
- `detection.ts` — context detection utility
- `slug.ts` — slug generation
- `specFormatter.ts` — spec content formatting
- `container.ts` — composition root
- `plugin-config.ts` — config application

**Fix**: Add unit tests for at minimum: `guards.ts`, `fs-*-store.ts`, `slug.ts`, `detection.ts`, `specFormatter.ts`.

### 2.3 Documentation duplication and drift

The same information (workflow, tools table, beads mode, priority system, config, etc.) is duplicated across **5 files**:
1. `AGENTS.md` (root)
2. `README.md` (root)
3. `packages/opencode-warcraft/README.md`
4. `packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md`
5. `packages/warcraft-core/BEADS.md`

Specific drift found:
- `BEADS.md` references `.warcraft/` paths, but the actual implementation uses `.beads/artifacts/` (on mode) and `docs/` (off mode)
- `BEADS.md` store factory comment references `'.warcraft/features/<name>/'` which differs from `DATA-MODEL.md`
- Root `AGENTS.md` is ~400 lines and replicates nearly the entire `README.md` content

**Fix**: Adopt a "single source of truth" approach:
- Keep `AGENTS.md` as the AI agent reference (concise)
- Keep `README.md` as the human-facing docs (comprehensive)
- Make `BEADS.md`, `DATA-MODEL.md`, `WARCRAFT-TOOLS.md` link back to README sections rather than duplicating
- Fix path references in `BEADS.md`

---

## Priority 3 — Medium (Developer Experience)

### 3.1 Add a CHANGELOG.md

No changelog exists. With v0.0.5 published to npm, users have no way to track breaking changes.

**Fix**: Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com) format. Backfill from git history for major milestones.

### 3.2 Add a CI workflow for PRs (not just main/tags)

`workflow-guards.yml` runs on `push: [main]` and PRs, which is good. But there is no branch protection enforcement visible. The release workflow pins Bun to `1.3.9` while guards use `latest` — version skew risk.

**Fix**:
- Pin Bun version consistently across all workflows
- Consider adding a `bun run format:check` step to CI (formatting is not checked currently)

### 3.3 Missing `rootDir` in opencode-warcraft tsconfig

`packages/opencode-warcraft/tsconfig.json` is missing `"rootDir": "src"`, unlike warcraft-core. This can cause declaration file path issues.

**Fix**: Add `"rootDir": "src"` to align with warcraft-core.

### 3.4 Build uses `bun build` single-entry bundling

Both packages use `bun build src/index.ts --outdir dist` which bundles everything into a single file. This means tree-shaking at the consumer level is limited. For a library package (`warcraft-core`), multiple entry points would be more optimal.

**Fix** (low priority): Consider using `tsc` for emit or `bun build` with multiple entry points for warcraft-core. Not critical at current scale.

---

## Priority 4 — Low (Nice-to-have Improvements)

### 4.1 Add a `CONTRIBUTING.md`

No contribution guide exists. For an open-source project, this is a gap.

### 4.2 Add npm badge that actually resolves

The root README has an npm badge for `opencode-warcraft` but the badge URL uses the package name `opencode-warcraft`. Verify it resolves correctly on npmjs.com.

### 4.3 Consider extracting the system prompt from `index.ts`

The 118-line `WARCRAFT_SYSTEM_PROMPT` string lives inline in `packages/opencode-warcraft/src/index.ts`. This could be a separate file for easier editing and testing.

### 4.4 Agent prompt files have no tests

All 6 agent prompt files (`khadgar.ts`, `mimiron.ts`, `saurfang.ts`, `brann.ts`, `mekkatorque.ts`, `algalon.ts`) lack individual test files. The shared `prompts.test.ts` and `permissions.test.ts` provide some coverage, but role-specific behavior is untested.

### 4.5 Schema validation not enforced at runtime

`packages/opencode-warcraft/schema/opencode_warcraft.schema.json` exists but there's no runtime validation using it. Invalid config silently produces unexpected behavior.

### 4.6 `release:check` script doesn't include `format:check`

`package.json` defines `format:check` but the `release:check` script only runs `install + build + test + lint`. Consider adding `format:check`.

---

## Priority 5 — Trivial (Housekeeping)

### 5.1 Remove stale `using-superpowers` skill directory
Empty placeholder with no content.

### 5.2 Remove `.test-tmp/` from opencode-warcraft package directory
Appears to be test artifacts that should be in `.gitignore` (it is, but the directory still exists).

### 5.3 Align root `package.json` name
Root `package.json` name is `@minhtri2710/opencode-warcraft` with a GitHub Packages `publishConfig`, but the actual published package is `opencode-warcraft` on npmjs. The root package.json shouldn't be published, so this is confusing.

### 5.4 `warcraft-core` dependency on `simple-git`
`simple-git` is listed as a production dependency but should be verified it's actually used. The `WorktreeService` appears to use `execFileSync` directly for git operations rather than `simple-git`.

---

## Recommended Execution Order

```
Phase 1 (Quick wins — 1-2 hours):
  1.1 Create LICENSE file
  1.2 Add node_modules to .gitignore
  1.3 Fix/remove ghost script references
  1.4 Clean up empty skill directory
  5.3 Fix root package.json name

Phase 2 (Quality — 1-2 days):
  2.2 Add tests for untested pure-function files
  2.1 Refactor top cognitive-complexity offenders
  3.2 Pin Bun version in CI

Phase 3 (Documentation — half day):
  2.3 Consolidate documentation, fix drift
  3.1 Create CHANGELOG.md
  4.1 Create CONTRIBUTING.md

Phase 4 (Polish — ongoing):
  3.3 Fix tsconfig rootDir
  4.3 Extract system prompt
  4.5 Add runtime config validation
  5.4 Audit simple-git dependency
```
