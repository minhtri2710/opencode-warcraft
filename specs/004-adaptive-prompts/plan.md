# Implementation Plan: Runtime-Adaptive Agent Prompts

**Branch**: `004-adaptive-prompts` | **Date**: 2026-03-07 | **Spec**: `.specify/memory/weakness-analysis.md` (N4)  
**Input**: Weakness analysis — agent prompts are static strings built at import time; no adaptation for task complexity, failure history, or project type.

## Summary

Make Mekkatorque's worker prompt adapt to task signals at dispatch time: compact prompt for simple tasks, failure-context injection for retried tasks, and reopen-rate-triggered extra verification instructions. This builds on the existing `buildMekkatorquePrompt(options)` function without requiring a full prompt compiler (existing plan §4).

## Technical Context

**Language/Version**: TypeScript (ES2022, Bun 1.3.9+)  
**Primary Dependencies**: `warcraft-core` (taskService, event-logger), `opencode-warcraft` (agents/mekkatorque, task-dispatch, worker-prompt)  
**Storage**: Task status.json, .beads/events.jsonl  
**Testing**: `bun:test` with co-located `*.test.ts`  
**Project Type**: Library + plugin (monorepo)  
**Constraints**: Prompts must remain cross-model compatible (no provider-specific features). Changes only to Mekkatorque for now — other agents unchanged.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Plan-First | ✅ This plan |
| II. Service-Layer | ✅ Prompt builder in opencode-warcraft, data from warcraft-core |
| III. Agent Specialization | ✅ Only Mekkatorque prompt changes; role boundary preserved |
| IV. Test-First | ✅ Tests for prompt variants |
| V. Isolation | ✅ Prompt changes don't affect task isolation |
| VI. Simplicity | ⚠️ Justified: 3 signal inputs, no ML, no full prompt compiler |

## Project Structure

### Source Code Changes

```text
packages/
├── opencode-warcraft/src/
│   ├── agents/
│   │   └── mekkatorque.ts           # Modify: make buildMekkatorquePrompt accept complexity signals
│   ├── tools/
│   │   └── task-dispatch.ts         # Modify: compute task complexity, pass to prompt builder
│   └── utils/
│       └── task-complexity.ts       # Create: classify task complexity from spec/status signals
│       └── task-complexity.test.ts  # Create: test complexity classification
```

## Tasks

### 1. Create Task Complexity Classifier

**Depends on**: none  
**Files**:
- Create: `packages/opencode-warcraft/src/utils/task-complexity.ts`
- Create: `packages/opencode-warcraft/src/utils/task-complexity.test.ts`

**What**: A pure function that classifies task complexity from available signals:

```typescript
export type TaskComplexity = 'trivial' | 'standard' | 'complex';

export interface ComplexitySignals {
  specLength: number;         // chars in spec content
  fileCount: number;          // files mentioned in spec
  dependencyCount: number;    // number of dependsOn entries
  previousAttempts: number;   // number of prior failed/blocked attempts
  featureReopenRate: number;  // from trust metrics
}

export function classifyComplexity(signals: ComplexitySignals): TaskComplexity;
```

Thresholds (configurable constants):
- **trivial**: spec < 500 chars AND fileCount ≤ 2 AND dependencyCount === 0 AND previousAttempts === 0
- **complex**: spec > 3000 chars OR fileCount > 5 OR previousAttempts ≥ 2 OR featureReopenRate > 0.2
- **standard**: everything else

**Must NOT**: Call external services. Have side effects. Use anything beyond the signals struct.

**Verify**: `bun test packages/opencode-warcraft/src/utils/task-complexity.test.ts`

### 2. Extend Mekkatorque Prompt Builder With Complexity Modes

**Depends on**: 1  
**Files**:
- Modify: `packages/opencode-warcraft/src/agents/mekkatorque.ts` (buildMekkatorquePrompt)

**What**: Extend `MekkatorquePromptOptions` to accept complexity:

```typescript
export interface MekkatorquePromptOptions {
  verificationModel: 'tdd' | 'best-effort';
  complexity?: TaskComplexity;
  failureContext?: string;  // injected when previousAttempts > 0
}
```

Prompt adaptations by complexity:
- **trivial**: Skip the full "Execution Flow" section. Use a compact template: "Read spec → Implement → Verify → Commit. Follow references for patterns."
- **standard**: Current prompt (no change)
- **complex**: Append extra guidance: "This is a complex task. Break implementation into smaller verified steps. Commit intermediate progress if blocked."

When `failureContext` is provided, inject before the Execution Flow section:
```
## Previous Attempt Context
This task has been attempted before. Key context from the previous attempt:
{failureContext}
Avoid repeating the same approach if it led to the failure above.
```

**Must NOT**: Change the standard prompt at all. Make the complex prompt more than ~10 lines longer. Use provider-specific features.

**Verify**: `bun test packages/opencode-warcraft/src/agents/prompts.test.ts`

### 3. Wire Complexity Into Task Dispatch

**Depends on**: 1, 2  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/task-dispatch.ts` (prepareTaskDispatch, ~line 87-186)
- Modify: `packages/opencode-warcraft/src/tools/worktree-tools.ts` (createWorktreeTool, ~line 58-260)

**What**: In `prepareTaskDispatch`, after building the spec:

1. Count files mentioned in specContent (simple regex: count `file:` or path-like references)
2. Get attempt count from `rawStatus.workerSession?.attempt ?? 0`
3. Get feature reopen rate from `computeTrustMetrics(projectRoot)` (now wired per feature 001)
4. Call `classifyComplexity(signals)`
5. Pass complexity + failureContext to `buildMekkatorquePrompt` when constructing the worker prompt

For `failureContext`: when `previousAttempts > 0`, read the previous attempt's summary from task status and include it.

**Must NOT**: Make the dispatch path slower (complexity classification is O(1)). Change the dispatch flow logic. Affect batch dispatch differently from single dispatch.

**Verify**: `bun test packages/opencode-warcraft/src/tools/dispatch-task.test.ts`

### 4. Test Coverage for Adaptive Prompts

**Depends on**: 2, 3  
**Files**:
- Modify: `packages/opencode-warcraft/src/agents/prompts.test.ts`
- Modify: `packages/opencode-warcraft/src/tools/dispatch-task.test.ts`

**What**: Add test cases:
1. Trivial task produces shorter prompt than standard
2. Complex task produces prompt with extra guidance
3. Task with previousAttempts > 0 includes failure context
4. Standard complexity produces identical prompt to current behavior (regression)
5. Complexity classification boundaries (edge cases at thresholds)

**Verify**: `bun run test --filter opencode-warcraft`

## Complexity Tracking

| Concern | Justification | Simpler Alternative Rejected |
|---------|---------------|------------------------------|
| 3 complexity levels | Covers the meaningful spectrum | Binary (simple/complex) misses the trivial case which is the highest-frequency prompt savings |
| Failure context injection | Workers demonstrably repeat predecessors' mistakes | Relying on terse summaries alone (status quo) loses critical context |
