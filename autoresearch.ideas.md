# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural.
- `batchExecuteTool` TOCTOU window between task validation and dispatch. Low risk.

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- ~~Audit generated skill registry content for outdated tool workflows (needs `bun run generate-skills` re-run)~~ DONE: run #80
- ~~ESM .js extension compliance in MCP module and test files~~ DONE: runs #78-79
- ~~Skill file stale wording (executing-plans, finishing-branch, parallel-exploration, docker-mastery, subagent-driven-development)~~ DONE: runs #76-77
- Look for potential edge cases in plan approval revocation when plan content has only whitespace changes
- Examine if `hasCompletionGateEvidence` regex is too permissive (matches "ok" in "not ok" — relies on FAIL_SIGNAL to reject)
- Check if compaction hook advice ("Do NOT call warcraft_status") could be harmful when compaction drops task state changes made by concurrent workers
