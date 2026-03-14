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

## Remaining ideas (lower priority / design changes)
- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` means task 100 sorts before 99. Edge case.
- **`parseTasksFromPlan` doesn't handle bullet-point dependency format** — `- Depends on: 1` not matched by regex.
- **`worktreeService.ts` rebase strategy partial cherry-pick cleanup** — Would need new GitClient `reset` method.

## Fresh angles to explore
- beadMapping.ts — mapping between bead statuses and task statuses, edge cases
- beadStatus.ts — status normalization logic
- bv-runner.ts — BV triage runner subprocess handling
- BvTriageService.ts — triage service integration
- discovery-gate.ts / plan-review-gate.ts / workflow-path.ts — plan gate logic
- transition-journal.ts — state transition journaling
- detection.ts — runtime detection utilities
- agentsMdService.ts — AGENTS.md generation
