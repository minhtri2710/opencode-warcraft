# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural.
- `batchExecuteTool` TOCTOU window between task validation and dispatch. Low risk — mitigated by dispatch lock.

## Remaining audit angles
- Check e2e tests for stale assertions or missing coverage of direct-mode dispatch path
- `configService.isStrictTaskTransitionsEnabled()` and `getStrictTaskTransitions()` are dead code — container hardcodes `strictTaskTransitions: true`, so the config option never takes effect. JSDoc says "defaults to false" but it's always true. Low-impact cosmetic issue.
- Mekkatorque prompt tells workers to pass `verification` structured data to `warcraft_worktree_commit`, but the tool schema doesn't accept it — the data is silently dropped. Gate checking uses regex on summary only. The `checkVerificationGates` function in guards.ts supports structured data but isn't wired up. `structuredVerificationMode` is declared in WorktreeToolsDependencies but never read. (Actually verified: the prompt only tells workers to include evidence in summary text, not structured fields. The unused infrastructure is `checkVerificationGates` structured path + `structuredVerificationMode` config. Not agent-facing.)
- `worktree-response.ts` has helper functions (buildTerminalCommitResult, formatBlockedResponse, buildCommitReport, etc.) that are tested in isolation but never imported by the actual tool implementation in worktree-tools.ts. The tool has inline duplicated logic. Dead code from a runtime perspective — tests validate functions that aren't used.
- `warcraft_feature_complete` doesn't check if all tasks are done before marking feature as completed. `syncCompletionFromTasks` would reopen it, creating a potential complete→reopen loop. By design, but could confuse agents.
