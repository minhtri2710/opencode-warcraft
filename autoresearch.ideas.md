# Autoresearch Ideas — warcraft-core Bug Hunt

## Session Summary
- **Baseline**: 987 tests → **Current**: 1106 tests (+12.1%)
- **Bugs fixed this session**: 3 (bullet-point deps, dispatch_prepared mapping, undefined summary)
- **Total bugs fixed across sessions**: 15+
- **New test files created**: 3 (beadsMode, bv-runner, factory)
- **Test files expanded**: 12

## Completed ✅ (all sessions)
- `slugifyTaskName` underscore handling, consecutive hyphens
- `containerName` trailing hyphen
- `listFeatureDirectories` phantom features
- `computeTrustMetrics` negative MTTR
- Unicode normalization in slug functions
- Long task name truncation
- BOM handling inconsistency
- `folderSource` missing in FilesystemTaskStore
- `configService.get()` cache on parse error
- Bullet-point dependency format in parseTasksFromPlan
- `getTaskBeadActions` missing dispatch_prepared
- `specFormatter` undefined summary in completed tasks
- Redundant double-slugification in parseTasksFromPlan
- Redundant buildEffectiveDependencies in computeRunnableStatus
- Undefined values in worktreeService conflict arrays
- FilesystemPlanStore guards for missing feature.json
- Bold-colon Depends on parsing
- WorktreeService merge SHA after partial cherry-pick
- TaskService.create order validation

## Remaining ideas (design limitations, not bugs)
- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` limitation
- **`worktreeService.ts` rebase partial cleanup** — Would need new GitClient method

## Areas fully explored
All source files and test files in warcraft-core: services/, utils/, beads/, state/, planGates/, ports/
