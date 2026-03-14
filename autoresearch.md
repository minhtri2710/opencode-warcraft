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

## What's Been Tried
- Added an initial behavior-oriented eval harness and baseline targeted tests.
- Implemented an instant workflow path for tiny/no-plan tasks: `warcraft_task_create` accepts self-contained descriptions, no-plan features auto-promote to `workflowPath=instant`, specs fall back to the task brief, and prompts/docs/status explain the path.
- Current gap to investigate: beads-backed/manual task state may still drop the instant-task brief because the bead artifact schema and decode path were originally plan-centric.
