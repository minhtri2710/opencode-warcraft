# Autoresearch Deferred Ideas

## Deeper audit areas
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This could be a security gap if sandbox mode is meant to protect the host.
- dispatch-coordinator.ts line 278: error message "No worktree found for blocked task" — accurate since it's in the worktree-specific code path, but could be more helpful

## Logic/behavior bugs to investigate
- `warcraft_worktree_discard` transitions through `cancelled` then `pending` — verified safe across all state machine edges
- `completeFeatureTool` allows marking a feature as complete even if tasks are still pending/in_progress — should this validate all tasks are done?
- `batchExecuteTool` execute mode revalidates all tasks serially before dispatching — a TOCTOU window exists where task state could change between validation and dispatch
- `resolveParallelPolicy` defaults to 'unbounded' strategy but still caps maxConcurrency at 32 — is this consistent or should unbounded truly have no cap?
- Prompt budgeting in task-dispatch.ts uses `DEFAULT_BUDGET` for all features — no per-feature budget scaling based on task count or complexity
- Hook cadence tracker evicts oldest entry when map exceeds MAX_HOOK_COUNTERS (100) — consider if this could lose critical hook state
