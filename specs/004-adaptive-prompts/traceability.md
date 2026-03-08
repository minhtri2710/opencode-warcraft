# Traceability: Runtime-Adaptive Agent Prompts

**Feature**: `004-adaptive-prompts`
**Date**: 2026-03-08

## Requirement-to-Test Mapping

### Functional Requirements

| Requirement | Description | Test File(s) | Test Name(s) |
|-------------|-------------|--------------|---------------|
| **FR-001** | Classify dispatch complexity into `trivial`, `standard`, or `complex` from runtime signals | `task-complexity.test.ts` | `returns "trivial" when all trivial conditions are met`, `returns "complex" when any complex condition is met`, `returns "standard" when neither trivial nor complex`, `returns one of the three valid TaskComplexity values` |
| **FR-002** | Treat task as `trivial` only when ALL trivial thresholds are met | `task-complexity.test.ts` | `is trivial at specLength=499`, `is NOT trivial at specLength=500`, `is trivial at fileCount=2`, `is NOT trivial at fileCount=3`, `is NOT trivial when dependencyCount=1`, `is NOT trivial when previousAttempts=1`, `is trivial at specLength=0 with all trivial conditions` |
| **FR-003** | Treat task as `complex` when ANY complex threshold is met | `task-complexity.test.ts` | `is complex at specLength=3001`, `is complex at fileCount=6`, `is complex at previousAttempts=2`, `is complex at featureReopenRate=0.21`, `is complex when only one complex condition triggers` |
| **FR-004** | Treat all remaining tasks as `standard` | `task-complexity.test.ts` | `returns standard for middle-of-range signals`, `returns standard at specLength=500`, `returns standard at specLength=3000`, `returns standard at fileCount=3 with all else trivial` |
| **FR-005** | Generate compact trivial-mode prompt omitting full execution-flow section | `prompts.test.ts` | `produces a shorter prompt than standard`, `uses a compact execution guidance`, `omits the full Execution Flow section`, `still contains core sections (Iron Laws, Completion Checklist)` |
| **FR-006** | Preserve existing standard-mode prompt behavior without semantic changes | `prompts.test.ts` | `standard complexity produces identical output to omitted complexity`, `standard complexity with best-effort produces identical output to omitted complexity`, `undefined complexity defaults to standard behavior` |
| **FR-007** | Append additional complex-mode guidance limited to concise verification instructions | `prompts.test.ts` | `produces a longer prompt than standard`, `contains stepwise verification guidance`, `contains intermediate progress guidance`, `preserves standard Execution Flow section`, `adds no more than approximately 10 extra lines beyond standard` |
| **FR-008** | Inject previous-attempt context block before execution flow when retries exist with prior summary | `prompts.test.ts` | `injects Previous Attempt Context block when failureContext provided`, `includes avoidance guidance`, `places failure context before Execution Flow`, `does NOT inject block when failureContext is undefined`, `does NOT inject block when failureContext is empty string` |
| **FR-009** | Use identical complexity and retry-context wiring for both dispatch paths | `dispatch-task.test.ts` | `produces same complexity classification via shared and non-shared dispatch`, `produces same retry context via shared and non-shared dispatch` |
| **FR-010** | Keep complexity classification pure and side-effect free | `task-complexity.test.ts` | `returns the same result for identical signals` (determinism test; function is stateless with no imports beyond types) |

### Non-Functional Requirements

| Requirement | Description | Verification Method | Evidence |
|-------------|-------------|-------------------|----------|
| **NFR-001** | Cross-model compatible prompts (no provider-specific syntax) | Code inspection | `mekkatorque.ts` uses only plain text sections; no structured output or function-calling directives |
| **NFR-002** | O(1) classification time | Code inspection | `classifyComplexity()` is a fixed set of comparisons over a 5-field struct; no loops, no history scanning |
| **NFR-003** | Complex-mode prompt limited to ~10 extra lines | `prompts.test.ts` | `adds no more than approximately 10 extra lines beyond standard` (asserts `complexLines - standardLines <= 15`) |
| **NFR-004** | Existing dispatch behavior unchanged apart from prompt content | `dispatch-task.test.ts` | All pre-existing dispatch tests continue to pass (25 tests unchanged); new tests only verify prompt content |
| **NFR-005** | Automated unit test coverage for all new logic | Test suite | 26 classifier tests + 24 prompt tests + 9 dispatch tests = 59 new tests |

### Success Criteria

| Criterion | Description | Verification | Status |
|-----------|-------------|-------------|--------|
| **SC-001** | 100% of threshold boundary cases pass deterministically | `bun test task-complexity.test.ts` | 26/26 pass |
| **SC-002** | Standard-mode regression shows no output differences | `bun test prompts.test.ts` | 3 regression tests pass (TDD + best-effort + undefined) |
| **SC-003** | Retry-context: 100% inclusion when retries exist with summary, 0% when not | `bun test prompts.test.ts`, `bun test dispatch-task.test.ts` | 7 inclusion/omission tests pass |
| **SC-004** | Both dispatch paths produce equivalent complexity mode selection | `bun test dispatch-task.test.ts` | 2 parity tests pass (complexity + retry context) |

### User Story to Test Mapping

| User Story | Acceptance Scenario | Test File | Test Name(s) |
|------------|-------------------|-----------|---------------|
| **US1** (Adaptive Complexity) | Trivial task → compact prompt | `prompts.test.ts`, `dispatch-task.test.ts` | `uses a compact execution guidance`, `includes compact guidance for trivial tasks` |
| **US1** | Complex task → extra guidance | `prompts.test.ts`, `dispatch-task.test.ts` | `contains stepwise verification guidance`, `includes complex task guidance when spec is large` |
| **US1** | Standard task → unchanged prompt | `prompts.test.ts`, `dispatch-task.test.ts` | `standard complexity produces identical output`, `does NOT include complex guidance for standard tasks` |
| **US2** (Retry Context) | Retried task with summary → context block injected | `prompts.test.ts`, `dispatch-task.test.ts` | `injects Previous Attempt Context block`, `includes previous attempt context when previousAttempts > 0 and summary exists` |
| **US2** | No retries → no context block | `prompts.test.ts`, `dispatch-task.test.ts` | `does NOT inject block when failureContext is undefined`, `does NOT include previous attempt context when previousAttempts is 0` |
| **US3** (Health Signal) | High reopen rate → complex | `task-complexity.test.ts` | `is complex at featureReopenRate=0.21` |
| **US3** | Normal reopen rate → not elevated | `task-complexity.test.ts` | `is NOT complex at featureReopenRate=0.2` |

### Edge Case Coverage

| Edge Case (from spec.md) | Test Location | Test Name |
|---------------------------|--------------|-----------|
| Missing/empty spec content | `task-complexity.test.ts` | `is trivial at specLength=0 with all trivial conditions` |
| Empty failure context string | `prompts.test.ts` | `does NOT inject block when failureContext is empty string` |
| Exact threshold at 500 (specLength) | `task-complexity.test.ts` | `is NOT trivial at specLength=500`, `returns standard at specLength=500` |
| Exact threshold at 3000 (specLength) | `task-complexity.test.ts` | `is NOT complex at specLength=3000`, `returns standard at specLength=3000` |
| Exact threshold at fileCount=2 | `task-complexity.test.ts` | `is trivial at fileCount=2` |
| Exact threshold at fileCount=5 | `task-complexity.test.ts` | `is NOT complex at fileCount=5` |
| Exact threshold at previousAttempts=2 | `task-complexity.test.ts` | `is complex at previousAttempts=2` |
| Complex overrides trivial | `task-complexity.test.ts` | `complex wins when both trivial and complex conditions could apply` |
| Failure context with trivial mode | `prompts.test.ts` | `failure context with trivial mode still injects the block` |
| Retries with no summary | `dispatch-task.test.ts` | `does NOT include previous attempt context when summary is missing` |

## Test File Summary

| Test File | Total Tests | New (Adaptive) | Existing (Pre-Feature) |
|-----------|-------------|----------------|----------------------|
| `task-complexity.test.ts` | 26 | 26 | 0 (new file) |
| `prompts.test.ts` | 114 | 24 | 90 |
| `dispatch-task.test.ts` | 34 | 9 | 25 |
| **Total** | **174** | **59** | **115** |

## Improvement Plan Alignment

This feature contributes to the Prompt Intelligence direction from `docs/improvement-plan.md` while preserving the design principles (line 446):

| Principle | How This Feature Complies |
|-----------|--------------------------|
| **One path, one truth** | Both dispatch paths use `prepareTaskDispatch()` — no duplicated logic |
| **State derives behavior** | Prompts derive from runtime signals, not hardcoded conditions |
| **Fail loud, recover gracefully** | Retry context surfaces previous failures explicitly |
| **Observe everything, alarm on anomalies** | Feature reopen rate from trust metrics feeds classification |
| **Human UX preserved** | Plan markdown and spec unchanged; adaptation is internal |
