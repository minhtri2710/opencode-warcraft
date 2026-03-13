# Autoresearch Deferred Ideas

## Deeper audit areas
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This could be a security gap if sandbox mode is meant to protect the host.
- worker-prompt.ts JSDoc (line 49) says "Assignment details (feature, task, worktree, branch)" — minor, should say "workspace"
- dispatch-coordinator JSDoc (line 134) says "single-task (worktree) and batch dispatch" — minor, could say "single-task (workspace)"

## Logic/behavior bugs to investigate
- `warcraft_worktree_discard` transitions through `cancelled` then `pending` — is double-transition safe in all task state machine edges?
- `completeFeatureTool` allows marking a feature as complete even if tasks are still pending/in_progress — should this validate all tasks are done?
- `batchExecuteTool` execute mode revalidates all tasks serially before dispatching — a TOCTOU window exists where task state could change between validation and dispatch
- `resolveParallelPolicy` defaults to 'unbounded' strategy but still caps maxConcurrency at 32 — is this consistent or should unbounded truly have no cap?
- Prompt budgeting in task-dispatch.ts uses `DEFAULT_BUDGET` for all features — no per-feature budget scaling based on task count or complexity
