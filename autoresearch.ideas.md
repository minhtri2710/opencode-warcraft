# Autoresearch Ideas — warcraft-core Bug Hunt

## Deferred optimizations & improvements

- **`slugifyTaskName` could convert underscores to hyphens** — Currently `hello_world` → `helloworld` (underscores stripped). Could improve to `hello-world` by replacing `[^a-z0-9]+` with hyphens (like `slugifyIdentifierSegment` already does). Requires careful test migration.

- **`listFeatureDirectories` could validate directories contain feature.json** — Currently returns any non-dot directory in the warcraft path. Could filter to only directories containing feature.json for more accurate feature listing.

- **`computeRunnableAndBlocked` always calls `buildEffectiveDependencies`** — This function is called even when all tasks already have explicit `dependsOn`. Could add a fast path that skips the function when all deps are already resolved.

- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — When cherry-picks partially succeed then fail, the current code aborts the failed cherry-pick but doesn't reset to `beforeHead`. A proper fix would add a `reset` method to GitClient and call `git reset --hard ${beforeHead}` after abort. Current fix only corrects the returned `sha`.

- **`configService.getAgentConfig` always combines default + user autoLoadSkills** — Even if user explicitly sets `autoLoadSkills: []`, defaults are always prepended. Consider respecting explicit empty override.

- **`writeJson`/`writeJsonAtomic` could add trailing newline** — Standard practice for text files. Would need to audit all content-hash comparisons to ensure no breakage.

- **`containerName` in DockerSandboxService could trim trailing hyphens** — `full.slice(0, 55)` could leave a trailing hyphen when cutting mid-word. Minor aesthetic issue.

- **`beads-task-store.ts` list() sorts by title then re-sorts by folder** — The initial title sort determines derived folder numbering for legacy tasks. Could be clearer with a comment explaining why both sorts exist.
