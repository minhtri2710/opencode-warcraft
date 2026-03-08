# Implementation Plan: Cross-Task Learning via Enriched Summaries

**Branch**: `002-cross-task-learning` | **Date**: 2026-03-07 | **Spec**: `.specify/memory/weakness-analysis.md` (N2)  
**Input**: Weakness analysis — workers get terse 1-line predecessor summaries; critical discoveries are lost between tasks.

## Summary

Enrich the task completion summary format to capture structured learnings (key discoveries, gotchas for downstream tasks) alongside the existing summary. Pass these enriched summaries to subsequent workers via `prepareTaskDispatch`, so Mekkatorque workers inherit predecessors' hard-won knowledge without needing a separate learning system.

## Technical Context

**Language/Version**: TypeScript (ES2022, Bun 1.3.9+)  
**Primary Dependencies**: `warcraft-core` (taskService, types), `opencode-warcraft` (worktree-tools, task-dispatch, worker-prompt)  
**Storage**: Task status.json files (existing), task artifacts (existing spec/report/worker_prompt)  
**Testing**: `bun:test` with co-located `*.test.ts`  
**Project Type**: Library + plugin (monorepo)  
**Constraints**: Must not break existing `warcraft_worktree_commit` callers. Summary stays a string — structured data is additive via a new optional field.

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Plan-First | ✅ This plan |
| II. Service-Layer | ✅ Extends TaskStatus type in warcraft-core, consumed in plugin |
| III. Agent Specialization | ✅ Mekkatorque produces learnings, Khadgar/Saurfang don't |
| IV. Test-First | ✅ Tests for enriched summary flow |
| V. Isolation | ✅ Workers still isolated; learnings flow through status.json |
| VI. Simplicity | ✅ Extends existing types, no new service or tool |

## Project Structure

### Source Code Changes

```text
packages/
├── warcraft-core/src/
│   ├── types.ts                     # Modify: add learnings field to TaskStatus
│   └── services/
│       └── taskService.ts           # Modify: persist/retrieve learnings
├── opencode-warcraft/src/
│   ├── tools/
│   │   └── worktree-tools.ts        # Modify: accept learnings in commit tool
│   ├── tools/
│   │   └── task-dispatch.ts         # Modify: include learnings in worker context
│   ├── utils/
│   │   └── worker-prompt.ts         # Modify: render learnings in worker prompt
│   └── agents/
│       └── mekkatorque.ts           # Modify: instruct workers to report learnings
```

## Tasks

### 1. Add Learnings Field to TaskStatus Type

**Depends on**: none  
**Files**:
- Modify: `packages/warcraft-core/src/types.ts` (TaskStatus interface, ~line 44-70)

**What**: Add an optional `learnings` field to `TaskStatus`:

```typescript
export interface TaskStatus {
  // ... existing fields ...
  /** Key discoveries and gotchas for downstream tasks */
  learnings?: string[];
}
```

Array of strings, each a discrete finding. Optional for backward compatibility — existing status.json files without `learnings` continue to work.

**Must NOT**: Change the shape of any existing field. Make the field required.

**Verify**: `bun run lint` — no type errors across the monorepo.

### 2. Accept and Persist Learnings in worktree_commit

**Depends on**: 1  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/worktree-tools.ts` (commitWorktreeTool, ~line 280-470)

**What**: Add an optional `learnings` parameter to the commit tool args:

```typescript
learnings: tool.schema.array(tool.schema.string()).optional()
  .describe('Key discoveries and gotchas for downstream tasks')
```

When present, persist to task status alongside existing fields:

```typescript
taskService.update(feature, task, {
  status: validateTaskStatus(finalStatus),
  summary,
  learnings: learnings ?? undefined,
});
```

**Must NOT**: Make learnings required. Change behavior when learnings is omitted. Break existing commit callers.

**Verify**: `bun test packages/opencode-warcraft/src/tools/worktree-tools.test.ts`

### 3. Include Learnings in Worker Prompt for Subsequent Tasks

**Depends on**: 1  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/task-dispatch.ts` (prepareTaskDispatch, ~line 87-186)
- Modify: `packages/opencode-warcraft/src/utils/worker-prompt.ts` (buildWorkerPrompt)

**What**: In `fetchSharedDispatchData`, extend `rawPreviousTasks` to include learnings from status:

```typescript
const rawPreviousTasks = allTasks
  .filter(t => t.status === 'done' && t.summary)
  .map(t => {
    const raw = services.taskService.getRawStatus(feature, t.folder);
    return {
      name: t.folder,
      summary: t.summary!,
      learnings: raw?.learnings ?? [],
    };
  });
```

In `buildWorkerPrompt`, render learnings below each completed task:

```
- **01-setup**: Set up project structure. Tests pass.
  - 💡 Test runner requires --experimental-vm-modules flag
  - 💡 API v2 returns paginated results (not documented)
```

**Must NOT**: Include learnings from the current task. Break prompt budgeting (learnings are subject to existing truncation).

**Verify**: `bun test packages/opencode-warcraft/src/utils/prompt-budgeting.test.ts` — truncation still works.

### 4. Update Mekkatorque Prompt to Encourage Learnings

**Depends on**: 2  
**Files**:
- Modify: `packages/opencode-warcraft/src/agents/mekkatorque.ts` (Report section, ~line 139-173)

**What**: In the `### 5. Report` section, update the success example to include learnings:

```
warcraft_worktree_commit({
  task: "current-task",
  summary: "Implemented X. Tests pass. build: exit 0, test: exit 0",
  status: "completed",
  learnings: ["Discovered Y requires Z flag", "API endpoint returns paginated results"],
  verification: { ... }
})
```

Add a brief instruction: "Include `learnings` for any non-obvious discoveries that downstream tasks would benefit from."

**Must NOT**: Make the prompt significantly longer. Add mandatory requirements — learnings are encouraged, not enforced.

**Verify**: `bun test packages/opencode-warcraft/src/agents/prompts.test.ts` — prompt content tests pass.

### 5. Test Coverage for Learnings Flow

**Depends on**: 2, 3  
**Files**:
- Modify: `packages/opencode-warcraft/src/tools/worktree-commit-contract.test.ts`
- Modify: `packages/opencode-warcraft/src/tools/worktree-tools.test.ts`

**What**: Add test cases:
1. Commit with learnings persists them to task status
2. Commit without learnings works unchanged (backward compat)
3. Worker prompt for task N includes learnings from completed task N-1
4. Empty learnings array is handled gracefully

**Verify**: `bun run test --filter opencode-warcraft`

## Complexity Tracking

No constitution violations. Extends existing types and flows — no new abstractions.
