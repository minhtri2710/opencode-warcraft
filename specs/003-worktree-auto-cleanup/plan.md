# Implementation Plan: Worktree Auto-Cleanup After Merge

**Branch**: `003-worktree-auto-cleanup` | **Date**: 2026-03-07 | **Spec**: `.specify/memory/weakness-analysis.md` (N5)  
**Input**: Weakness analysis — worktrees persist after merge with no cleanup automation; stale worktrees accumulate silently.

## Summary

Add optional `cleanup` parameter to `warcraft_merge` that removes the worktree after successful merge. Enhance `warcraft_status` with a worktree age warning when worktrees exceed a staleness threshold. No auto-deletion without user intent.

## Technical Context

**Language/Version**: TypeScript (ES2022, Bun 1.3.9+)  
**Primary Dependencies**: `warcraft-core` (worktreeService), `opencode-warcraft` (worktree-tools, context-tools)  
**Storage**: Git worktrees on filesystem  
**Testing**: `bun:test` with co-located `*.test.ts`  
**Project Type**: Library + plugin (monorepo)  
**Constraints**: Never auto-delete without explicit `cleanup: true`. Default must be safe (no deletion).

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Plan-First | ✅ This plan |
| II. Service-Layer | ✅ Uses existing worktreeService.remove() |
| III. Agent Specialization | ✅ No agent boundary changes |
| IV. Test-First | ✅ Tests for cleanup flow |
| V. Isolation | ✅ Cleanup only after merge confirms success |
| VI. Simplicity | ✅ One new optional parameter, one age check |

## Project Structure

### Source Code Changes

```text
packages/opencode-warcraft/src/tools/
├── worktree-tools.ts                # Modify: add cleanup param to mergeTaskTool
└── worktree-tools.test.ts           # Modify: test cleanup flow
```

## Tasks

### 1. Add `cleanup` Parameter to warcraft_merge

**Depends on**: none  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/worktree-tools.ts` (mergeTaskTool, ~line 543-623)

**What**: Add optional `cleanup` parameter:

```typescript
cleanup: tool.schema.boolean().optional().default(false)
  .describe('Remove worktree after successful merge (default: false)')
```

After a successful merge (`result.success === true`), if `cleanup` is true, call `worktreeService.remove(feature, task)`. Include cleanup status in the response:

```typescript
return toolSuccess({
  ...mergeResult,
  cleanup: cleanup ? { removed: true, path: worktree?.path } : { removed: false },
});
```

If cleanup fails (e.g., filesystem error), still return success for the merge but note cleanup failure:

```typescript
cleanup: { removed: false, error: 'Failed to remove worktree: ...' }
```

**Must NOT**: Auto-cleanup when `cleanup` is not explicitly `true`. Fail the merge if cleanup fails. Delete the branch (only the worktree directory).

**Verify**: `bun test packages/opencode-warcraft/src/tools/worktree-tools.test.ts`

### 2. Enhance Stale Worktree Warning in warcraft_status

**Depends on**: none  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/context-tools.ts` (getStatusTool, ~line 127-140)

**What**: The stale worktree detection already exists (`worktreeService.listAll` + `isStale` filter, lines 127-140). Enhance the `staleWarning` message to include worktree age and a cleanup suggestion:

```typescript
worktrees: staleWorktrees.map((wt: StaleWorktreeInfo) => ({
  feature: wt.feature,
  step: wt.step,
  path: wt.path,
  ageInDays: wt.lastCommitAge !== null ? Math.floor(wt.lastCommitAge / 86400) : null,
})),
message: `${staleWorktrees.length} stale worktree(s) detected (oldest: ${maxAge}d). ` +
  `Run warcraft_worktree_prune or warcraft_merge with cleanup: true.`,
```

**Must NOT**: Auto-delete stale worktrees. Change the staleness threshold (already defined in worktreeService).

**Verify**: `bun test packages/opencode-warcraft/src/tools/context-tools.test.ts`

### 3. Test Coverage

**Depends on**: 1, 2  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/worktree-tools.test.ts`

**What**: Add test cases:
1. Merge with `cleanup: true` removes worktree after success
2. Merge with `cleanup: false` (default) preserves worktree
3. Merge failure does not attempt cleanup even with `cleanup: true`
4. Cleanup failure does not fail the merge response

**Verify**: `bun run test --filter opencode-warcraft`

## Complexity Tracking

No constitution violations. Minimal change — one optional parameter, one enhanced message.
