# Feature Specs — New Capability Roadmap

Generated from `.specify/memory/weakness-analysis.md` via speckit.plan.  
Complements existing `docs/improvement-plan.md` (10 items, foundation/reliability focus).

## Features

| # | Feature | Effort | Phase | Dependencies | Status |
|---|---------|--------|-------|--------------|--------|
| 001 | [Trust Metrics in Status](./001-trust-metrics-in-status/plan.md) | S (½ day) | 1 | None | Draft |
| 002 | [Cross-Task Learning](./002-cross-task-learning/plan.md) | S-M (1 day) | 2 | None | Draft |
| 003 | [Worktree Auto-Cleanup](./003-worktree-auto-cleanup/plan.md) | S (few hrs) | 3 | None | Draft |
| 004 | [Adaptive Prompts](./004-adaptive-prompts/plan.md) | M (1-2 days) | 3 | 001 (for reopen rate) | Draft |

## Execution Order

```
001 Trust Metrics ──────────────────┐
                                    ├──▶ 004 Adaptive Prompts
002 Cross-Task Learning (parallel)  │
003 Worktree Cleanup (parallel) ────┘
```

- **001** first: lowest effort, unblocks 004, immediate operator value
- **002** and **003** are independent — can run in parallel with each other and after 001
- **004** last: depends on 001 for reopen rate data, highest effort

## Relationship to Existing Plan

These 4 features fill gaps **not covered** by `docs/improvement-plan.md`:
- 001 complements §6 (Observability) — §6 builds infra, 001 builds user-facing view
- 002 is net-new (no existing plan item)
- 003 is net-new (no existing plan item)
- 004 extends §4 (Prompt Compiler) — §4 is structural, 004 is data-driven
