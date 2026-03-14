# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural: sandboxing the project root would require a different approach.
- `batchExecuteTool` execute mode revalidates all tasks serially before dispatching — a TOCTOU window exists where task state could change between validation and dispatch. Low risk since human-initiated.

## Verified as correct / intentional (no action needed)
- ~~`completeFeatureTool` allows marking a feature as complete even if tasks are still pending~~ — intentional (manual override); `syncCompletionFromTasks()` handles automatic completion
- ~~`resolveParallelPolicy` defaults to 'unbounded' but caps at 32~~ — only applies to 'bounded' strategy; 'unbounded' uses Promise.all
- ~~Hook cadence tracker eviction~~ — correct, evicts oldest when map exceeds 100 entries
- ~~dispatch-coordinator "No worktree found" error~~ — accurate, in worktree-specific code path
- ~~Prompt budgeting defaults~~ — sensible defaults, per-feature scaling would be premature

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- Audit the generated skill registry for skills that reference stale tool names or outdated workflows (partially done — main skills checked, but generated content from `bun run generate-skills` hasn't been re-generated)
