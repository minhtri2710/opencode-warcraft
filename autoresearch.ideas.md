# Autoresearch Ideas — warcraft-core Bug Hunt

## Deferred optimizations & improvements

- ~~**`slugifyTaskName` could convert underscores to hyphens**~~ ✅ Fixed

- **`listFeatureDirectories` could validate directories contain feature.json** — Currently returns any non-dot directory in the warcraft path. Could filter to only directories containing feature.json for more accurate feature listing. Low priority since callers handle null from `get()`.

- **`computeRunnableAndBlocked` always calls `buildEffectiveDependencies`** — This function is called even when all tasks already have explicit `dependsOn`. Could add a fast path that skips the function when all deps are already resolved. Micro-optimization.

- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — When cherry-picks partially succeed then fail, the current code aborts the failed cherry-pick but doesn't reset to `beforeHead`. A proper fix would add a `reset` method to GitClient and call `git reset --hard ${beforeHead}` after abort. Current fix only corrects the returned `sha`.

- ~~**`configService.getAgentConfig` always combines default + user autoLoadSkills**~~ Not a bug — users use `disableSkills` to opt out. Design is intentional.

- **`writeJson`/`writeJsonAtomic` could add trailing newline** — Standard practice for text files. Would need to audit all content-hash comparisons to ensure no breakage.

- ~~**`containerName` in DockerSandboxService could trim trailing hyphens**~~ ✅ Fixed

- **`beads-task-store.ts` list() sorts by title then re-sorts by folder** — The initial title sort determines derived folder numbering for legacy tasks. Could be clearer with a comment explaining why both sorts exist.

- **`extractBeadContent` returns untrimmed content** — When payload is a string with whitespace-only content, check uses `.trim()` but returns original `payload`. By design (preserves markdown formatting), but slightly inconsistent.

- **`computeTrustMetrics` blockedMttrMs can include negative values** — If event timestamps are out of order (e.g., clock skew), `resolvedTime - blockedTime` could be negative. Could filter out negative values.

- **`readEvents` in event-logger.ts reads entire file for every `getLatestTraceContext` call** — Could optimize by reading from the end of the file. Low priority since event logs are typically small.
