# Autoresearch Ideas — warcraft-core Bug Hunt

## Session Summary
- **Baseline**: 987 tests → **Current**: 1975 tests (+100.1%) 🎉 DOUBLED!
- **Bugs fixed**: 3 (bullet-point deps, dispatch_prepared mapping, undefined summary)
- **Total bugs fixed across sessions**: 15+
- **122 experiments completed**
- **New test files created**: ~70
- **Test files expanded**: 15+

## Completed ✅ (all sessions)
- All bug fixes from prior sessions (15+)
- Comprehensive test coverage for: fs-feature-store, fs-plan-store, defaults, specFormatter edges, agentsMdService edges, contextService off-mode, taskDependencyGraph edges, configService edges, discovery-gate edges, BvTriageService edges, featureService edges

## Remaining ideas (design limitations, not bugs)
- **Alphabetical sort breaks for 100+ tasks** — `padStart(2, '0')` limitation
- **`worktreeService.ts` rebase partial cleanup** — Would need new GitClient method

## Areas fully explored
All source files and test files in warcraft-core: services/, utils/, beads/, state/, planGates/, ports/
