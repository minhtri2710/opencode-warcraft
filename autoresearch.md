# Autoresearch: Fresh-eyes bug hunt across opencode-warcraft

## Objective
Systematically explore the repository, trace execution flows across related imports/callers, and convert user-facing or workflow-affecting issues into regression tests and fixes. The focus is correctness and behavior fidelity, not benchmark gaming. The current audit workload targets fresh-eye bugs in the tool/workflow layer that have a high chance of misleading agents or causing incorrect orchestration behavior.

## Metrics
- **Primary**: audit_failures (count, lower is better)
- **Secondary**: audit_runtime_ms, lint_pass, full_test_pass

## How to Run
`./autoresearch.sh` — runs the current fresh-eye audit suite and outputs `METRIC audit_failures=<n>` and `METRIC audit_runtime_ms=<n>`.

## Files in Scope
- `packages/opencode-warcraft/src/tools/feature-tools.ts` — feature creation/completion tool surfaces and user-facing messaging
- `packages/opencode-warcraft/src/tools/worktree-tools.ts` — merge/commit/discard behavior and verification flow
- `packages/opencode-warcraft/src/services/dispatch-coordinator.ts` — single-task dispatch orchestration and lifecycle guarantees
- `packages/opencode-warcraft/src/tools/dispatch-task.ts` — compatibility wrapper around unified dispatch
- `packages/opencode-warcraft/src/tools/batch-tools.ts` — parallel dispatch orchestration
- `packages/opencode-warcraft/src/index.ts` — plugin wiring and tool registration
- `packages/opencode-warcraft/src/**/*.test.ts` — regression coverage for discovered issues
- `autoresearch.sh` / `autoresearch.checks.sh` / `autoresearch.md` — autoresearch harness and notes

## Off Limits
- Public API redesigns unrelated to discovered bugs
- Artificially weakening tests/checks to improve the metric
- Benchmark-specific hacks that do not improve real behavior
- Dependency changes unless absolutely required for a correctness fix

## Constraints
- Follow `AGENTS.md` code style and architecture rules
- Keep local ESM imports with `.js` extensions
- Use `bun:test` for regression coverage
- `bun run lint` and `bun run test` must pass before keeping a result
- Do not cheat on the benchmark; each improvement should reflect a real bug fix or stronger regression coverage

## What's Been Tried
- Fixed `warcraft_merge` verify-argument behavior so omitted `verify` correctly falls back to the verification model instead of being forced to `false` by the schema layer.
- Fixed `warcraft_feature_create` success messaging so it uses the canonical feature name returned by the service instead of the raw user input.
- Added regression coverage for both fixes.
- Fixed the misleading `FeatureTools.createFeatureTool()` claim that creation automatically makes the feature active. The tool metadata now describes the real behavior.
- Built a benchmark-only fresh-eye audit harness under `eval/` so newly discovered issues can drive the experiment metric without breaking the package test suites before the implementation exists.
- Fixed `DoctorTools` so per-feature worktree inspection failures degrade to a `stale_worktrees` warning instead of crashing the whole diagnostic tool.
- Extended the same fail-soft approach to feature enumeration failures, which now surface as a `feature_inventory` warning instead of aborting diagnostics.
- Added permanent package-level regression coverage for the DoctorTools degraded paths plus the benchmark-only evals that originally exposed them.
- Fixed `ContextTools` so `warcraft_status` degrades gracefully when worktree inventory fails, surfacing a `worktreeHygiene` warning instead of crashing status rendering.
- Extended the same fail-soft behavior to per-task worktree lookup while rendering task workspace summaries; failed lookups now yield `workspace: null` instead of aborting the whole status payload.
- Added package and benchmark-only regression coverage for the ContextTools degraded worktree-inventory and per-task worktree-lookup paths.
- Expanded the audit workload to cover the runtime system prompt's worktree delegation contract, exposing that `index.ts` still claimed `warcraft_worktree_create` auto-spawned workers even though the tool returns a `task()` payload that must be issued explicitly.
- Expanded the audit workload again to the Khadgar and Saurfang agent prompts, exposing the same stale delegation contract there: both prompts still implied `warcraft_worktree_create` directly launched Mekkatorque instead of returning a `task()` payload that the orchestrator must issue.
- Expanded the audit workload to the shared blocker-handling fragment and found the blocked-resume contract was still incomplete there: the fragment told orchestrators to call `warcraft_worktree_create(... continueFrom: "blocked" ...)` but never to issue the returned `task()` call that actually relaunches the worker.
- Expanded the audit workload to the top-level workflow summary in `index.ts`, which still said `warcraft_worktree_create(task) → work in worktree → warcraft_worktree_commit(...)` even after the more detailed delegation sections were fixed. That summary line also needs to show the explicit returned `task()` call so the quick-start workflow stays consistent with the real tool contract.
- Expanded the audit workload to Saurfang's descriptive metadata and found the same stale orchestration story persisted there too: exported agent metadata, the agent registry, and plugin-config registration still claimed Saurfang "spawns workers" directly instead of launching the returned `task()` payload from `warcraft_worktree_create`.
- Expanded the audit workload to Mekkatorque metadata and found it still claimed the worker always executes in isolated worktrees, even though direct mode is a supported runtime path. The worker-facing metadata should describe the assigned workspace generically instead of promising worktrees unconditionally.
- Expanded the audit workload into generated skill content and found the same stale workspace contract there too: `using-git-worktrees` still said `warcraft_worktree_create` always creates an isolated worktree, `warcraft` still said Mekkatorque executes tasks in worktrees, and the blocked-resume skill guidance still omitted the returned `task()` call after `warcraft_worktree_create(... continueFrom: "blocked" ...)`.
- Expanded the audit workload further across generated skills and found direct-mode compatibility drift in `dispatching-parallel-agents` and `subagent-driven-development` too: both still described Warcraft task execution as inherently isolated-worktree-only, instead of assigned-workspace execution driven by returned `task()` payloads.
- Expanded the audit workload again to the remaining workspace wording in generated skills and found two more stale phrases: the `warcraft` skill still said `[Mekkatorque implements in worktree]` in its single-task execution example, and `writing-plans` still told users to open the follow-on execution session specifically in a worktree instead of the appropriate Warcraft-managed workspace.
- Expanded the audit workload once more to the last remaining skill wording drift and found `warcraft` still described `warcraft_worktree_create` as creating the worktree in one section and as "Create worktree + delegation instructions" in its tool table, while `subagent-driven-development` still told users to set up an isolated workspace before starting. Those phrases also need to reflect Warcraft-managed assigned workspaces rather than unconditional worktrees.
