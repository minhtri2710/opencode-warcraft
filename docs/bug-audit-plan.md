# Bug Audit & Code Review Plan

**Date:** 2026-03-10
**Scope:** Full codebase audit of `warcraft-core` and `opencode-warcraft` packages
**Method:** Deep trace of execution flows → "fresh eyes" critical analysis → systematic fix plan

---

## Files Investigated

### warcraft-core
- `src/types.ts` — Domain types
- `src/defaults.ts` — Default config
- `src/index.ts` — Export surface
- `src/utils/paths.ts` — Path helpers
- `src/utils/fs.ts` — Filesystem helpers
- `src/utils/slug.ts` — Slug/folder derivation
- `src/services/featureService.ts` — Feature lifecycle
- `src/services/planService.ts` — Plan lifecycle
- `src/services/taskService.ts` — Task lifecycle (full 1001 lines)
- `src/services/worktreeService.ts` — Git worktree management
- `src/services/taskDependencyGraph.ts` — Dependency resolution
- `src/services/task-state-machine.ts` — State transitions
- `src/services/outcomes.ts` — Outcome envelope
- `src/services/contextService.ts` — Context file management
- `src/services/configService.ts` — User config
- `src/services/event-logger.ts` — JSONL event log + trust metrics
- `src/services/trace-context.ts` — Trace/span context
- `src/services/specFormatter.ts` — Spec markdown generation
- `src/services/dockerSandboxService.ts` — Docker sandbox

### opencode-warcraft
- `src/container.ts` — DI composition root
- `src/guards.ts` — Validation/gate logic
- `src/types.ts` — Plugin types + toolSuccess/toolError
- `src/tools/feature-tools.ts` — Feature tools
- `src/tools/plan-tools.ts` — Plan tools
- `src/tools/task-tools.ts` — Task tools
- `src/tools/worktree-tools.ts` — Worktree tools (full 853 lines)
- `src/tools/batch-tools.ts` — Batch parallel dispatch
- `src/tools/context-tools.ts` — Context/status tools
- `src/tools/dispatch-task.ts` — Unified dispatch adapter
- `src/tools/task-dispatch.ts` — Prompt preparation
- `src/tools/tool-input.ts` — Input validation
- `src/tools/worktree-response.ts` — Response formatting
- `src/services/dispatch-coordinator.ts` — Dispatch orchestration
- `src/services/blocked-check.ts` — BLOCKED file check
- `src/services/feature-resolution.ts` — Feature resolver
- `src/services/dependency-check.ts` — Dependency validator
- `src/services/session-capture.ts` — Session persistence
- `src/utils/worker-prompt.ts` — Worker prompt builder
- `src/utils/prompt-budgeting.ts` — Budget/truncation
- `src/utils/prompt-observability.ts` — Size warnings
- `src/utils/runtime-commands.ts` — Runtime detection
- `src/utils/task-complexity.ts` — Complexity classifier
- `src/utils/format.ts` — Time formatting

---

## Bugs & Issues Found

### BUG-001: Extra closing brace in feature creation message (feature-tools.ts:42)
**Severity:** Low (cosmetic)
**File:** `packages/opencode-warcraft/src/tools/feature-tools.ts`, line 42
**Description:** There is an extra `}` in the template literal:
```ts
message: `Feature "${name}" created (epic: ${epicBeadId || 'unknown'}}).
```
The `'unknown'}})` has two closing braces — the first closes the ternary expression, and the second is a literal stray `}` character that will appear in the user-facing output.

**Fix:** Remove the extra `}`:
```ts
message: `Feature "${name}" created (epic: ${epicBeadId || 'unknown'}).
```

### BUG-002: `dispatch_prepared` status missing from `getRunnableTasksFromFilesystem` switch (taskService.ts:898)
**Severity:** Medium (functional gap)
**File:** `packages/warcraft-core/src/services/taskService.ts`, line 898
**Description:** The `switch (task.status)` in `getRunnableTasksFromFilesystem` handles `done`, `in_progress`, `pending`, `blocked`, `failed`, `cancelled`, and `partial` — but `dispatch_prepared` is a valid `TaskStatusType` and is not handled. Tasks in `dispatch_prepared` state will fall through the switch silently and not be categorized into any bucket (runnable, blocked, completed, or inProgress).

**Fix:** Add `dispatch_prepared` to the switch — treat it the same as `in_progress` (it's a transient pre-execution state):
```ts
case 'dispatch_prepared':
case 'in_progress':
  inProgress.push(runnableTask);
  break;
```

### BUG-003: `worktree-response.ts` `buildTerminalCommitResult` uses `workspacePath` for both modes (line 333)
**Severity:** Low (inconsistency)
**File:** `packages/opencode-warcraft/src/tools/worktree-response.ts`, line 333
**Description:** The code reads:
```ts
workspacePath: workspaceMode === 'direct' ? workspacePath : workspacePath,
```
This is a no-op ternary — both branches return `workspacePath`. Looking at the equivalent code in `worktree-tools.ts` line 584, the actual tool uses:
```ts
workspacePath: workspaceMode === 'direct' ? workspacePath : workspace?.path,
```
The response helper is intended to be used in place of the inline code but doesn't replicate the correct behavior. In worktree mode, it should use the worktree's path (passed in as a parameter), not the raw `workspacePath`.

**Fix:** The function signature already takes `workspacePath` as input, so the ternary should just be removed (always use the provided value), OR the function should accept separate parameters for direct vs worktree paths to match the tool's actual logic. Given the current signature, simplify to:
```ts
workspacePath,
```

### BUG-004: Duplicate `sanitizeLearnings` function across two files
**Severity:** Low (code duplication, not a bug)
**File:** `packages/opencode-warcraft/src/tools/worktree-tools.ts` (line 45) AND `packages/opencode-warcraft/src/tools/task-dispatch.ts` (line 65)
**Description:** The identical `sanitizeLearnings` function is defined in both files. While not a runtime bug, this violates DRY and risks divergence if one copy is updated but not the other. Since both are in the same package, one should import from the other or it should be extracted to a shared utility.

**Fix:** Extract to a shared location (e.g., `src/utils/sanitize.ts` or add to `src/types.ts`) and import from both files.

### BUG-005: `worktree-response.ts` `TruncationEventLike` has wrong type for `affected`
**Severity:** Low (type mismatch)
**File:** `packages/opencode-warcraft/src/tools/worktree-response.ts`, line 17
**Description:** `TruncationEventLike.affected` is typed as `string`, but the actual `TruncationEvent` in `prompt-budgeting.ts` has `affected?: string[]` (array). The `BudgetWarning` type also has `affected?: string` (singular). This means when consuming actual truncation events that have `string[]` affected, the type mismatch is silently widened by structural typing, but any code that relies on `BudgetWarning.affected` being a string will be incorrect.

**Fix:** Change `affected` to `string[]` in both `TruncationEventLike` and `BudgetWarning`:
```ts
affected?: string[];
```

### BUG-006: `configService.ts` — `set()` doesn't update cache with merged result
**Severity:** Low (wasteful, not broken)
**File:** `packages/warcraft-core/src/services/configService.ts`, line 134
**Description:** After `set()` writes the merged config to disk, it sets `this.cachedConfig = null` to invalidate the cache. The next `get()` will re-read from disk and re-parse JSON. Since we already have the merged result in memory, it would be more efficient and consistent to set `this.cachedConfig = merged` instead. Currently this is not a bug — it's a minor inefficiency — but the docstring says "The cache is invalidated only after `set()` writes new values" which implies it should be updated, not cleared.

**No fix needed** — this is a minor optimization opportunity, not a bug.

### BUG-007: `worktreeService.ts` — `getStepStatusPath` returns `null` for beads mode but callers don't check
**Severity:** Low (currently safe)
**File:** `packages/warcraft-core/src/services/worktreeService.ts`, line 113-118
**Description:** `getStepStatusPath` returns `null` when `beadsMode === 'on'`, and the only caller (`getDiff`) does check for this with `statusPath` truthiness. This is currently safe but worth noting as a latent risk if new callers are added.

**No fix needed** — current usage is safe.

### BUG-008: `worktreeService.ts` — `commitChanges` checks `not_added` for hasChanges but also ran `git add .`
**Severity:** Low (benign race window)
**File:** `packages/warcraft-core/src/services/worktreeService.ts`, line 645-648
**Description:** After running `git add ['.', '--', ':!*.patch']` to stage everything, the code checks `status.not_added.length > 0` as part of `hasChanges`. Since `git add .` was just called, `not_added` should typically be empty (everything is staged). This isn't a bug per se, but `not_added` after `git add .` would only be non-empty for files that git cannot add (e.g., ignored files). The check is harmless but misleading.

**No fix needed** — defensive and harmless.

---

## Summary of Actionable Fixes

| ID | Severity | File | Description |
|----|----------|------|-------------|
| BUG-001 | Low | `feature-tools.ts:42` | Extra `}` in template literal |
| BUG-002 | Medium | `taskService.ts:898` | Missing `dispatch_prepared` in switch |
| BUG-003 | Low | `worktree-response.ts:333` | No-op ternary for `workspacePath` |
| BUG-004 | Low | `worktree-tools.ts` / `task-dispatch.ts` | Duplicate `sanitizeLearnings` function |
| BUG-005 | Low | `worktree-response.ts:17` | `affected` typed as `string` not `string[]` |

## Fix Plan

1. **BUG-001** — Single character deletion. Safe, no test impact.
2. **BUG-002** — Add `dispatch_prepared` case to switch. Should verify with existing tests.
3. **BUG-003** — Remove no-op ternary. Safe refactor.
4. **BUG-004** — Extract shared `sanitizeLearnings` to utility, update imports in both files.
5. **BUG-005** — Fix type from `string` to `string[]` for `affected` fields.

All fixes will be followed by: `bun run build && bun run test && bun run lint`
