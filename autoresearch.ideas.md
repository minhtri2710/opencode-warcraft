# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural: sandboxing the project root would require a different approach.
- `batchExecuteTool` execute mode revalidates all tasks serially before dispatching — a TOCTOU window exists where task state could change between validation and dispatch. Low risk since human-initiated.

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- Audit generated skill registry for skills that reference stale tool names (main skills checked, generated content from `bun run generate-skills` hasn't been re-generated yet)
- The package README still has a large "Execution Walkthrough" section that may have more stale worktree-specific claims (lines ~465-560)
