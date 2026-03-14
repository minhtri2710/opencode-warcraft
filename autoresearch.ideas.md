# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural.
- `batchExecuteTool` TOCTOU window between task validation and dispatch. Low risk.

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- Audit generated skill registry content for outdated tool workflows (needs `bun run generate-skills` re-run)
