# Autoresearch Deferred Ideas

## Design-level concerns (not simple code fixes)
- Sandbox hook only applies to worktree paths — direct-mode bash commands bypass sandboxing entirely. This is architectural.
- `batchExecuteTool` TOCTOU window between task validation and dispatch. Low risk — mitigated by dispatch lock.
- `warcraft_feature_complete` doesn't check if all tasks are done before marking feature as completed. `syncCompletionFromTasks` would reopen it, creating a potential complete→reopen loop. By design, but could confuse agents.
- Cancelled task sync inconsistency: `occupiedFolder` check skips plan tasks matching cancelled tasks, but cleanup loop then removes the cancelled task. Net result: task disappears on first sync, reappears on second. Two-sync oscillation.
- `worktreeService.merge` rebase strategy: if a cherry-pick fails partway through, previously applied commits aren't rolled back (`git reset --hard beforeHead`). Would need adding a `reset` operation to the GitClient interface.
- `FilesystemTaskStore.writeArtifact` / `readArtifact` silently no-op when repository is absent (filesystem-only mode). Specs and worker prompts are computed but never persisted to disk. Workers get prompts in-memory but crash recovery can't read them back.
- `writeWorkerPromptFile` in `prompt-file.ts` is dead code — never called from anywhere.

## Dead code / cosmetic (low impact, not worth audit tests)
- `configService.isStrictTaskTransitionsEnabled()` and `getStrictTaskTransitions()` are dead code — container hardcodes `strictTaskTransitions: true`, so the config option never takes effect. JSDoc says "defaults to false" but it's always true.
- Unused infrastructure: `checkVerificationGates` structured path + `structuredVerificationMode` config. Not agent-facing.
- `worktree-response.ts` helpers are tested but never used by worktree-tools.ts (already has audit test to prevent accidental import of buggy helper).
- `computeRunnableStatus` in taskService double-computes effective dependencies: calls `buildEffectiveDependencies` then `computeRunnableAndBlocked` which calls it again internally. Not a bug, just redundant work.
