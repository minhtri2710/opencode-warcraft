# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural.
- `batchExecuteTool` TOCTOU window between task validation and dispatch. Low risk.

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- `configService.isStrictTaskTransitionsEnabled()` and `getStrictTaskTransitions()` are dead code — container hardcodes `strictTaskTransitions: true`, so the config option never takes effect. JSDoc says "defaults to false" but it's always true. Low-impact cosmetic issue.
- Look for potential edge cases in plan approval revocation when plan content has only whitespace changes
- Check if compaction hook advice ("Do NOT call warcraft_status") could be harmful when compaction drops task state changes made by concurrent workers
