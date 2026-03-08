# Tasks: Runtime-Adaptive Agent Prompts

**Input**: Design documents from `/Users/beowulf/Work/personal/opencode-warcraft/specs/004-adaptive-prompts/`
**Prerequisites**: `plan.md` (required), `spec.md` (required); optional docs not present (`data-model.md`, `contracts/`, `research.md`, `quickstart.md`)

**Tests**: This feature explicitly requires test coverage in `spec.md` (NFR-005), so test tasks are included and sequenced before implementation within each user story.

**Organization**: Tasks are grouped by user story to allow independent implementation and validation for each story.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create feature-local scaffolding and test harness support used by all stories.

- [ ] T001 Create complexity classifier module scaffold in `packages/opencode-warcraft/src/utils/task-complexity.ts`
- [ ] T002 Create classifier test file scaffold in `packages/opencode-warcraft/src/utils/task-complexity.test.ts`
- [ ] T003 [P] Add prompt test fixture helpers for complexity options in `packages/opencode-warcraft/src/agents/prompts.test.ts`
- [ ] T004 [P] Add dispatch test fixture helpers for retry/reopen signals in `packages/opencode-warcraft/src/tools/dispatch-task.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Put shared prompt and dispatch wiring contracts in place before story-specific behavior.

**⚠️ CRITICAL**: No user story implementation should start until this phase is complete.

- [ ] T005 Extend `MekkatorquePromptOptions` with `complexity` and `failureContext` in `packages/opencode-warcraft/src/agents/mekkatorque.ts`
- [ ] T006 Add shared complexity-signal extraction helper in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T007 Add shared previous-attempt context extraction helper in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T008 Wire foundational prompt-option pass-through for single-task dispatch in `packages/opencode-warcraft/src/tools/worktree-tools.ts`
- [ ] T009 Add baseline standard-prompt regression assertion scaffold in `packages/opencode-warcraft/src/agents/prompts.test.ts`

**Checkpoint**: Foundation ready; user stories can now be implemented with stable interfaces.

---

## Phase 3: User Story 1 - Adaptive Complexity Prompting (Priority: P1) 🎯 MVP

**Goal**: Dispatch chooses `trivial`, `standard`, or `complex` prompt mode from runtime signals and keeps standard behavior unchanged.

**Independent Test**: Run classifier and prompt tests with controlled signals and verify mode selection plus standard-prompt regression behavior.

### Tests for User Story 1

- [ ] T010 [P] [US1] Add classifier threshold tests for trivial/standard/complex outcomes in `packages/opencode-warcraft/src/utils/task-complexity.test.ts`
- [ ] T011 [P] [US1] Add prompt-mode tests for trivial compact flow and complex extra guidance in `packages/opencode-warcraft/src/agents/prompts.test.ts`

### Implementation for User Story 1

- [ ] T012 [US1] Implement `TaskComplexity`, `ComplexitySignals`, and `classifyComplexity()` thresholds in `packages/opencode-warcraft/src/utils/task-complexity.ts`
- [ ] T013 [US1] Implement complexity-mode prompt branching with unchanged standard mode in `packages/opencode-warcraft/src/agents/mekkatorque.ts`
- [ ] T014 [US1] Integrate complexity classification into batch dispatch prompt construction in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T015 [US1] Integrate complexity classification into single-task dispatch prompt construction in `packages/opencode-warcraft/src/tools/worktree-tools.ts`

**Checkpoint**: User Story 1 delivers adaptive complexity prompting and is independently testable.

---

## Phase 4: User Story 2 - Retry-Aware Failure Context (Priority: P2)

**Goal**: Retry attempts include concise previous-attempt context before execution guidance.

**Independent Test**: Verify prompt output includes previous-attempt context when retries exist with summary text and omits it otherwise.

### Tests for User Story 2

- [ ] T016 [P] [US2] Add prompt tests for failure-context inclusion and omission behavior in `packages/opencode-warcraft/src/agents/prompts.test.ts`
- [ ] T017 [P] [US2] Add dispatch tests for previous-attempt summary extraction and forwarding in `packages/opencode-warcraft/src/tools/dispatch-task.test.ts`

### Implementation for User Story 2

- [ ] T018 [US2] Inject `Previous Attempt Context` section before execution flow when context is present in `packages/opencode-warcraft/src/agents/mekkatorque.ts`
- [ ] T019 [US2] Build retry-aware `failureContext` from task status summaries in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T020 [US2] Ensure single-task and batch dispatch both pass identical `failureContext` behavior in `packages/opencode-warcraft/src/tools/worktree-tools.ts`

**Checkpoint**: User Story 2 delivers retry-aware prompt context and is independently testable.

---

## Phase 5: User Story 3 - Health-Signal-Informed Classification (Priority: P3)

**Goal**: Classification incorporates feature reopen rate to elevate complexity when operational instability is high.

**Independent Test**: Hold task-local signals constant and vary reopen-rate around `0.2` boundary; verify deterministic classification changes and dispatch parity.

### Tests for User Story 3

- [ ] T021 [P] [US3] Add reopen-rate boundary tests (`>0.2` vs `<=0.2`) in `packages/opencode-warcraft/src/utils/task-complexity.test.ts`
- [ ] T022 [P] [US3] Add single-vs-batch dispatch parity tests using reopen-rate inputs in `packages/opencode-warcraft/src/tools/dispatch-task.test.ts`

### Implementation for User Story 3

- [ ] T023 [US3] Wire feature reopen-rate signal from trust metrics into dispatch complexity signals in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T024 [US3] Normalize missing/invalid reopen-rate values with deterministic fallback in `packages/opencode-warcraft/src/tools/task-dispatch.ts`
- [ ] T025 [US3] Enforce O(1) classification path without task-history scanning in `packages/opencode-warcraft/src/tools/task-dispatch.ts`

**Checkpoint**: User Story 3 delivers health-signal classification and parity validation.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize docs and traceability for safe implementation and handoff.

- [ ] T026 Create executable scenario validation guide in `specs/004-adaptive-prompts/quickstart.md`
- [ ] T027 [P] Document final complexity thresholds and prompt-mode contract in `specs/004-adaptive-prompts/research.md`
- [ ] T028 [P] Add requirement-to-test traceability matrix in `specs/004-adaptive-prompts/traceability.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: depends on Phase 1; blocks all user stories
- **Phase 3 (US1)**: depends on Phase 2
- **Phase 4 (US2)**: depends on Phase 2 (recommended after US1 for easier regression confidence)
- **Phase 5 (US3)**: depends on Phase 2 (recommended after US1 for complexity baseline reuse)
- **Phase 6 (Polish)**: depends on all completed user stories

### User Story Dependency Graph

- Preferred completion order: **US1 -> US2 -> US3**
- Parallel-capable after Foundational: US2 and US3 can proceed independently if team capacity allows

### Within Each User Story

- Write tests first and confirm failing expectations
- Implement behavior changes
- Re-run story tests and dispatch parity tests

---

## Parallel Execution Examples

### User Story 1

Run in parallel after T009:

- T010 and T011 (test authoring on separate files)

### User Story 2

Run in parallel after T015:

- T016 and T017 (test authoring on separate files)

### User Story 3

Run in parallel after T020:

- T021 and T022 (test authoring on separate files)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2
2. Deliver Phase 3 (US1)
3. Validate classifier + prompt mode behavior before expanding scope

### Incremental Delivery

1. Add US2 retry-aware failure context with dedicated tests
2. Add US3 reopen-rate signal integration with boundary and parity tests
3. Complete documentation and traceability polish

### Parallel Team Strategy

1. Engineer A: `task-complexity.ts` and tests
2. Engineer B: prompt builder changes and prompt tests
3. Engineer C: dispatch wiring and dispatch parity tests
