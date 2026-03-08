# Feature Specification: Runtime-Adaptive Agent Prompts

**Feature Branch**: `004-adaptive-prompts`  
**Created**: 2026-03-07  
**Status**: Draft  
**Input**: User description: "Improve worker prompt quality by adapting Mekkatorque prompts to task complexity and retry history at dispatch time"

## Overview

Current Mekkatorque prompts are static and do not adapt to task complexity, retry context, or feature health signals. This feature adds runtime prompt adaptation for Mekkatorque only, with no provider-specific prompt features and no behavior changes to other agents.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adaptive Complexity Prompting (Priority: P1)

As an operator, I want Mekkatorque to receive complexity-appropriate prompt instructions so simple work is handled with concise guidance and complex work gets extra stepwise verification guidance.

**Why this priority**: It directly improves baseline execution quality and reduces unnecessary prompt overhead on the highest-volume trivial tasks.

**Independent Test**: Trigger dispatch with controlled complexity signal inputs and verify that generated worker prompt mode is `trivial`, `standard`, or `complex` as expected.

**Acceptance Scenarios**:

1. **Given** a task with short spec text, minimal files, no dependencies, and no previous attempts, **When** dispatch prepares a worker prompt, **Then** the prompt uses trivial mode and a compact execution flow.
2. **Given** a task with long spec text or high retry/reopen signal, **When** dispatch prepares a worker prompt, **Then** the prompt uses complex mode and includes extra stepwise verification guidance.
3. **Given** a task with medium signals, **When** dispatch prepares a worker prompt, **Then** the prompt remains equivalent to current standard behavior.

---

### User Story 2 - Retry-Aware Failure Context (Priority: P2)

As an operator, I want retries to include concise prior-attempt context so workers avoid repeating failed approaches.

**Why this priority**: Retry loops are costly; preserving relevant previous attempt context increases successful completion probability.

**Independent Test**: Create a task status with `previousAttempts > 0` and prior summary text, then verify generated prompt includes a dedicated previous-attempt context section.

**Acceptance Scenarios**:

1. **Given** a task with at least one previous failed or blocked attempt and a stored summary, **When** dispatch prepares the prompt, **Then** a previous-attempt context block is injected before execution flow guidance.
2. **Given** a task with no previous attempts, **When** dispatch prepares the prompt, **Then** no previous-attempt context block is included.

---

### User Story 3 - Health-Signal-Informed Classification (Priority: P3)

As an operator, I want complexity classification to include feature-level reopen rate so prompts better reflect project stability conditions.

**Why this priority**: Reopen rate captures operational instability not visible from task-local fields alone.

**Independent Test**: Run classifier with fixed task-local signals and vary feature reopen rate around threshold boundary to verify classification changes predictably.

**Acceptance Scenarios**:

1. **Given** task-local signals that are otherwise standard and `featureReopenRate > 0.2`, **When** complexity is classified, **Then** the result is complex.
2. **Given** the same task-local signals and `featureReopenRate <= 0.2`, **When** complexity is classified, **Then** the result is not elevated to complex by reopen rate.

---

### Edge Cases

- How does classification behave when spec content is missing or empty?
- How does dispatch behave when task file references cannot be counted from malformed spec text?
- How is failure context handled when previous attempts exist but prior summaries are empty?
- How are threshold boundaries handled exactly at 500, 3000, 2 files, 5 files, and attempt count 2?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST classify dispatch complexity into `trivial`, `standard`, or `complex` using only provided runtime signals (`specLength`, `fileCount`, `dependencyCount`, `previousAttempts`, `featureReopenRate`).
- **FR-002**: System MUST treat a task as `trivial` only when all trivial thresholds are met.
- **FR-003**: System MUST treat a task as `complex` when any complex threshold is met.
- **FR-004**: System MUST treat all remaining tasks as `standard`.
- **FR-005**: System MUST generate a compact trivial-mode Mekkatorque prompt that omits the full execution-flow section.
- **FR-006**: System MUST preserve the existing standard-mode Mekkatorque prompt behavior without semantic changes.
- **FR-007**: System MUST append additional complex-mode guidance limited to concise incremental verification instructions.
- **FR-008**: System MUST inject a previous-attempt context block before execution flow when `previousAttempts > 0` and prior summary text exists.
- **FR-009**: System MUST use identical complexity and retry-context wiring for both single-task and batch dispatch paths.
- **FR-010**: System MUST keep complexity classification pure and side-effect free.

### Non-Functional Requirements

- **NFR-001**: Prompt generation MUST remain cross-model compatible and avoid provider-specific syntax or APIs.
- **NFR-002**: Complexity classification MUST execute in O(1) time relative to task history size.
- **NFR-003**: Added complex-mode prompt text SHOULD be limited to approximately 10 extra lines beyond standard mode.
- **NFR-004**: Existing worker dispatch behavior and state transitions MUST remain unchanged apart from prompt content selection and context injection.
- **NFR-005**: All new logic MUST include automated unit test coverage using `bun:test` with co-located `*.test.ts` files.

### Key Entities

- **ComplexitySignals**: Runtime signal object containing `specLength`, `fileCount`, `dependencyCount`, `previousAttempts`, and `featureReopenRate`.
- **TaskComplexity**: Enum-like union with values `trivial | standard | complex` used by prompt-builder mode selection.
- **MekkatorquePromptOptions**: Prompt-construction options including `verificationModel`, optional `complexity`, and optional `failureContext`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For classifier boundary test suite, 100% of threshold boundary cases pass deterministically.
- **SC-002**: Standard-mode regression tests show no output differences from current baseline for unchanged signal conditions.
- **SC-003**: Retry-context tests verify 100% inclusion when retries exist with prior summary and 0% inclusion when retries do not exist.
- **SC-004**: End-to-end dispatch tests verify both single-task and batch paths produce equivalent complexity mode selection for the same inputs.
