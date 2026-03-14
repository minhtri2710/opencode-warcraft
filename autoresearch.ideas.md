# Autoresearch Ideas — warcraft-core Bug Hunt

## Completed ✅ (this session)

- ~~`slugifyTaskName` underscore handling~~ ✅ Converts underscores to hyphens
- ~~`containerName` trailing hyphen~~ ✅ Strips trailing hyphens after truncation
- ~~`listFeatureDirectories` phantom features~~ ✅ Filtered in FilesystemFeatureStore.list()
- ~~`computeTrustMetrics` negative MTTR~~ ✅ Filters negative durations from clock skew
- ~~Unicode normalization in slug functions~~ ✅ NFD decomposition for accented chars
- ~~Long task name truncation~~ ✅ 60-char limit with hash suffix
- ~~BOM handling inconsistency~~ ✅ Always strips BOM in stripRedundantLeadingHeading
- ~~`folderSource` missing in FilesystemTaskStore~~ ✅ Added explicit 'stored'

## Remaining ideas (lower priority / design changes)

- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — Would need new GitClient `reset` method. Current fix only corrects returned SHA.

- **`writeJson`/`writeJsonAtomic` could add trailing newline** — Would need to audit plan approval hashes.

- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` means task 100 sorts before 99. Edge case.

- **`parseTasksFromPlan` doesn't handle bullet-point dependency format** — `- Depends on: 1` not matched by regex.

- **`configService.get()` doesn't cache on parse error** — Repeated I/O on corrupt config file. May be intentional (allows recovery).

- **`FilesystemTaskStore.writeArtifact` silently drops content in off-mode** — No local file written when repository is absent. By design since artifacts are computed on-the-fly.
