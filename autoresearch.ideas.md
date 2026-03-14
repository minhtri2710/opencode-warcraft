# Autoresearch Ideas — warcraft-core Bug Hunt

## Completed ✅
- `slugifyTaskName` underscore handling ✅
- `containerName` trailing hyphen ✅
- `listFeatureDirectories` phantom features ✅
- `computeTrustMetrics` negative MTTR ✅
- Unicode normalization in slug functions ✅
- Long task name truncation ✅
- BOM handling inconsistency ✅
- `folderSource` missing in FilesystemTaskStore ✅
- `configService.get()` cache on parse error ✅
- Bullet-point dependency format in parseTasksFromPlan ✅
- `getTaskBeadActions` missing dispatch_prepared ✅
- `specFormatter` undefined summary in completed tasks ✅

## Remaining ideas (design limitations, not bugs)
- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` limitation. Would require breaking folder name changes.
- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — Would need new GitClient `reset` method.

## Areas fully explored
- All 45 test files, all source files in services/, utils/, beads/
- State stores (fs-*, beads-*), factory, transitions
- Plan gates (discovery, review, workflow-path)
- Context markdown, spec formatter, agents.md service
- Docker sandbox service, config service
- Event logger, trace context, outcomes
- Slug utils, path utils, shell utils, fs utils, detection
- Task dependency graph, task state machine
