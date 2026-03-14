# Autoresearch Ideas — warcraft-core Bug Hunt

## Completed ✅

- ~~`slugifyTaskName` could convert underscores to hyphens~~ ✅ Fixed
- ~~`containerName` in DockerSandboxService could trim trailing hyphens~~ ✅ Fixed
- ~~`configService.getAgentConfig` always combines default + user autoLoadSkills~~ Not a bug — `disableSkills` provides opt-out
- ~~`listFeatureDirectories` could validate directories contain feature.json~~ ✅ Fixed in FilesystemFeatureStore.list()
- ~~`computeTrustMetrics` negative MTTR values~~ ✅ Fixed
- ~~Unicode normalization in slug functions~~ ✅ Fixed via NFD decomposition

## Remaining ideas (lower priority)

- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — When cherry-picks partially succeed then fail, the current code aborts the failed cherry-pick but doesn't reset to `beforeHead`. A proper fix would add a `reset` method to GitClient and call `git reset --hard ${beforeHead}` after abort. Current fix only corrects the returned `sha`. Requires new GitClient method.

- **`writeJson`/`writeJsonAtomic` could add trailing newline** — Standard practice for text files. Would need to audit all content-hash comparisons to ensure no breakage. Risk of breaking plan approval hashes.

- **`beads-task-store.ts` list() sorts by title then re-sorts by folder** — The initial title sort determines derived folder numbering for legacy tasks. Could be clearer with a comment explaining why both sorts exist.

- **Task folder names can exceed filesystem path limits** — No length limit on slugified task names. Very long task names produce very long folder names that could exceed OS path limits (260 chars Windows). Would need truncation with hash suffix.

- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` means task 100 sorts before task 99 alphabetically (`'100-xxx' < '99-xxx'`). Would need `padStart(3, '0')` to support 100+ tasks. Edge case since features rarely have 100+ tasks.

- **`parseTasksFromPlan` doesn't handle bullet-point dependency format** — `- Depends on: 1` (with leading `- `) doesn't match the regex because `^\s*\*{0,2}` doesn't match markdown list markers. Only inline format is supported.
