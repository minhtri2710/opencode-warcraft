# Autoresearch: Warcraft instant workflow + beads-aligned task detail

## Objective
Improve the Warcraft workflow so trivial/simple work can execute immediately without creating a formal plan first, while preserving the traceability and self-documenting detail expected by the beads workflow.

The target behavior is:
- Simple work may skip `warcraft_plan_write` / `warcraft_plan_approve`
- Direct/manual tasks still carry enough background, reasoning, safety, verification, and rollback context to be useful to workers and future reviewers
- Status and prompts should steer agents toward the instant path when appropriate and the plan/beads path when work is larger or riskier
- Complex work should continue to use the existing plan-first path

## Metrics
- **Primary**: instant_workflow_score (unitless, higher is better)
- **Secondary**: targeted test pass/fail, runtime of benchmark/checks

## How to Run
`./autoresearch.sh`

The script prints:
- `METRIC instant_workflow_score=<number>`

## Files in Scope
- `packages/warcraft-core/src/types.ts` — core workflow/task metadata types
- `packages/warcraft-core/src/services/taskService.ts` — manual-task creation, spec generation, plan parsing/sync behavior
- `packages/warcraft-core/src/services/specFormatter.ts` — worker spec richness for instant/manual tasks
- `packages/opencode-warcraft/src/tools/task-tools.ts` — manual task UX and instant-path behavior
- `packages/opencode-warcraft/src/tools/context-tools.ts` — next-action/status guidance
- `packages/opencode-warcraft/src/tools/feature-tools.ts` — feature creation guidance
- `packages/opencode-warcraft/src/index.ts` — system workflow instructions
- `packages/opencode-warcraft/src/agents/*.ts` — planner/orchestrator prompts
- `packages/opencode-warcraft/src/**/tests` — targeted regression coverage
- `eval/instant-workflow-score.ts` — benchmark/eval harness for the new behavior
- `README.md`, `packages/opencode-warcraft/README.md`, `docs/plan-authoring.md` — workflow docs (if needed)

## Off Limits
- External dependencies
- Fake benchmark shortcuts that only satisfy string matching without improving runtime behavior
- Unrelated refactors

## Constraints
- Do not break the existing plan-first workflow for complex work
- Preserve lightweight path behavior for small but still planned work
- Keep tests meaningful; do not overfit purely to benchmark phrasing
- Prefer additive, low-risk changes with clear unit coverage

## Benchmark shape
The benchmark should reward real workflow improvements, not just prompt edits. It should check a representative mix of:
- tool/runtime behavior for instant/manual tasks
- richer self-documenting specs for direct execution
- status guidance for no-plan execution
- agent/system guidance for when to use instant vs plan-first paths
- beads-mode persistence so instant/manual task briefs survive the canonical beads-backed path too
- request analysis so the system can recommend instant vs lightweight vs standard before the user commits to a workflow
- status guidance that respects a stored workflow recommendation before any plan/tasks exist
- escalation guidance when an instant workflow grows beyond a single tiny task and should fall back to a lightweight plan
- creation-time warnings so `warcraft_task_create` nudges the user back toward a lightweight plan once a no-plan feature accumulates multiple pending manual tasks
- direct-task scope analysis so non-tiny manual briefs can immediately recommend lightweight/standard planning before dispatch
- fallback guidance that respects the lightweight path's own max-2-task constraint, escalating outgrown instant workflows to the standard path once they exceed that limit
- draft plan scaffolds in tool/status responses so agents can convert outgrown instant/manual work into reviewed plans without starting from a blank page
- ready-to-use `warcraft_plan_write` arguments alongside those scaffolds so agents can promote work into planning with minimal manual rewriting
- scaffold structure that remains beads-aligned by including planning guardrail sections such as `## Non-Goals` and `## Ghost Diffs`, not just Discovery + Tasks
- direct scaffold materialization through `warcraft_plan_write`, so agents can promote pending manual tasks into a real plan file without copy/pasting returned scaffold content
- end-to-end promotion from manual instant tasks into canonical planned tasks during `warcraft_tasks_sync`, avoiding duplicate task creation once scaffolded plans are approved
- action guidance that points agents at the actual low-friction promotion command (`warcraft_plan_write({ useScaffold: true })`) once scaffold-based fallback is available
- an actual `warcraft_task_expand` helper that writes the reviewed plan scaffold for pending manual tasks and previews the resulting promotion/reconciliation impact
- guidance that points agents at `warcraft_task_expand` once that helper exists, instead of continuing to surface only lower-level scaffold-writing commands
- ready-to-use `warcraft_task_expand` arguments in responses, analogous to `planWriteArgs`, so agents can invoke the higher-level promotion helper directly

## What's Been Tried
- Added an initial behavior-oriented eval harness and baseline targeted tests.
- Implemented an instant workflow path for tiny/no-plan tasks: `warcraft_task_create` accepts self-contained descriptions, no-plan features auto-promote to `workflowPath=instant`, specs fall back to the task brief, and prompts/docs/status explain the path.
- Fixed the beads-mode/manual-task gap by preserving `brief` through the task-state artifact encode/decode path and adding explicit artifact schema coverage.
- Added request analysis in `warcraft_feature_create` via `analyzeWorkflowRequest`, returning `recommendedWorkflowPath` + rationale for instant vs lightweight vs standard.
- Persisted `workflowRecommendation` on the feature so `warcraft_status` can guide the user toward the right next action (e.g. lightweight plan) even before a plan or task exists.
- Added scaffolded-plan fallbacks: `planScaffold`, `planWriteArgs`, beads-aligned scaffold sections, and `warcraft_plan_write({ useScaffold: true })` so pending manual tasks can be promoted into a real reviewed plan without copy/paste.
- Added an actual `warcraft_task_expand` helper that writes a scaffolded reviewed plan from pending manual tasks and previews how `warcraft_tasks_sync` will reconcile them.
- Added `warcraft_task_expand` plus guidance that steers agents toward it, and taught it to merge pending manual tasks into an existing draft plan instead of only no-plan features.
- Added `taskExpandArgs` in task/status responses so agents can call the higher-level promotion helper directly instead of reconstructing its arguments.
- Added follow-up args (`planApproveArgs`, `taskSyncArgs`) in scaffold-promotion responses so the post-expansion flow can be carried forward with less manual re-wrapping.
- Surfaced those follow-up args in `warcraft_status` too, so agents can recover the next exact approval/sync calls from status after promotion work has already started.
- Added ordered `promotionFlow` handoffs across direct-task fallback, `warcraft_status`, `warcraft_task_expand`, `warcraft_plan_write`, and `warcraft_plan_approve`, so agents get the reviewed promotion sequence in the right order instead of only isolated arg payloads.
- Taught draft-plan flows to keep steering unfinished manual work back through `warcraft_task_expand`: partial/manual subset promotion now returns `remainingManualTasks` + follow-up `taskExpandArgs`, and `warcraft_status` surfaces the same when a draft plan still leaves manual tasks outside the reviewed plan.
- Latest direction in progress: consider tightening the review gate itself so `warcraft_plan_approve` warns or blocks when draft plans still leave unmatched manual tasks outside the reviewed plan, but only if that proves valuable beyond the new status/follow-up guidance.
