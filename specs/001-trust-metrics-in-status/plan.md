# Implementation Plan: Trust Metrics in warcraft_status

**Branch**: `001-trust-metrics-in-status` | **Date**: 2026-03-07 | **Spec**: `.specify/memory/weakness-analysis.md` (N1)  
**Input**: Weakness analysis — `computeTrustMetrics()` is dead code; operator has no visibility into system health.

## Summary

Wire the existing `computeTrustMetrics()` function into `warcraft_status` output so operators see system health (reopen rate, blocked MTTR, stale worktrees, stuck tasks) passively — no new dashboards, no auto-adaptive behavior.

## Technical Context

**Language/Version**: TypeScript (ES2022, Bun 1.3.9+)  
**Primary Dependencies**: `warcraft-core` (event-logger.ts), `opencode-warcraft` (context-tools.ts)  
**Storage**: `.beads/events.jsonl` (existing JSONL event log)  
**Testing**: `bun:test` with co-located `*.test.ts`  
**Project Type**: Library + plugin (monorepo)  
**Performance Goals**: Status tool must remain <200ms (metrics computation reads a single file)  
**Constraints**: Pure read-only — no behavioral changes to dispatch/execution

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Plan-First | ✅ This plan |
| II. Service-Layer | ✅ Uses existing `computeTrustMetrics` in warcraft-core |
| III. Agent Specialization | ✅ No agent boundary changes |
| IV. Test-First | ✅ Tests for new health section |
| V. Isolation | ✅ Read-only addition |
| VI. Simplicity | ✅ Wiring existing code, no new abstractions |

## Project Structure

### Source Code Changes

```text
packages/
├── warcraft-core/src/services/
│   └── event-logger.ts              # Existing — no changes needed
├── opencode-warcraft/src/tools/
│   └── context-tools.ts             # Modify: add health section to getStatusTool
└── opencode-warcraft/src/tools/
    └── context-tools.test.ts        # Create: test health section output
```

## Tasks

### 1. Add Health Section to warcraft_status Output

**Depends on**: none  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/context-tools.ts` (getStatusTool, ~line 219-266)  
- Modify: `packages/opencode-warcraft/src/container.ts` (pass projectRoot to ContextTools)

**What**: Import `computeTrustMetrics` from `warcraft-core`. In `getStatusTool.execute()`, call `computeTrustMetrics(projectRoot)` and append a `health` section to the response object:

```typescript
health: {
  reopenRate: metrics.reopenRate,
  totalCompleted: metrics.totalCompleted,
  reopenCount: metrics.reopenCount,
  blockedMttrMs: metrics.blockedMttrMs,
  staleWorktrees: staleWorktrees.length,
  stuckInProgress: inProgressTasks.filter(t => /* no recent heartbeat */).length,
}
```

**Must NOT**: Change any existing response fields. Add auto-adaptive behavior. Make health section computation blocking if events.jsonl is large.

**Verify**: `bun test packages/opencode-warcraft/src/tools/context-tools.test.ts` — health section present in status output.

### 2. Add Performance Guard for Large Event Logs

**Depends on**: 1  
**Files**:
- Modify: `packages/warcraft-core/src/services/event-logger.ts` (computeTrustMetrics)

**What**: Add a size guard — if `events.jsonl` exceeds 1MB, only read the last 1000 lines (tail-read). This prevents status tool slowdown on long-running projects. Use `fs.statSync` for size check, then `fs.readFileSync` with a byte-offset if needed.

**Must NOT**: Change the metrics computation logic. Break existing tests.

**Verify**: `bun test packages/warcraft-core/src/services/event-logger.test.ts` — all existing tests still pass.

### 3. Test Coverage for Health Section

**Depends on**: 1  
**Files**:
- Modify or create: `packages/opencode-warcraft/src/tools/context-tools.test.ts`

**What**: Add test cases:
1. Status output includes `health` section when events exist
2. Status output includes `health` section with zero values when no events.jsonl
3. Health values match expected computations from known event data

**Verify**: `bun test packages/opencode-warcraft/src/tools/context-tools.test.ts`

## Complexity Tracking

No constitution violations. Pure wiring of existing function into existing tool output.
