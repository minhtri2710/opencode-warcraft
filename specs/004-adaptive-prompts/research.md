# Research: Runtime-Adaptive Agent Prompts

**Feature**: `004-adaptive-prompts`
**Date**: 2026-03-08

## Threshold Rationale

### Three-Level Classification

The classifier uses three complexity levels instead of a binary split:

| Level | When | Prompt Adaptation |
|-------|------|-------------------|
| **trivial** | Small spec, few files, no deps, no retries | Compact execution guidance — reduces prompt overhead |
| **standard** | Everything else | Unchanged baseline behavior — zero regression risk |
| **complex** | Large spec, many files, retries, or high reopen rate | Extra stepwise verification guidance — reduces rework |

**Why not binary (simple/complex)?** Binary classification misses the highest-frequency case: trivial tasks. Most Warcraft tasks are small, focused edits. The trivial mode saves ~60% of prompt text for these cases, reducing token usage without sacrificing worker quality.

**Why not more levels (e.g., 5)?** The prompt builder has only three meaningfully different rendering modes. More levels would add classification complexity without corresponding prompt differentiation.

### Threshold Values

#### Trivial Thresholds (ALL must hold)

| Signal | Threshold | Rationale |
|--------|-----------|-----------|
| `specLength < 500` | Strict less-than | 500 chars is roughly a 5-line spec section. Tasks this short are typically single-file edits. |
| `fileCount <= 2` | Inclusive | Tasks touching 1-2 files are inherently limited in scope. |
| `dependencyCount === 0` | Exact zero | Any dependency implies coordination, which disqualifies trivial. |
| `previousAttempts === 0` | Exact zero | Any retry history means the task has proven non-trivial. |

**AND logic**: All conditions must hold simultaneously. A task with a tiny spec but dependencies is NOT trivial — the dependencies signal coordination complexity.

#### Complex Thresholds (ANY triggers)

| Signal | Threshold | Rationale |
|--------|-----------|-----------|
| `specLength > 3000` | Strict greater-than | 3000 chars is roughly a 30-line spec section with multiple requirements. |
| `fileCount > 5` | Strict greater-than | Touching 6+ files indicates cross-cutting changes needing verification. |
| `previousAttempts >= 2` | Inclusive | Two or more failed attempts means the task has systemic difficulty. |
| `featureReopenRate > 0.2` | Strict greater-than | 20%+ reopen rate signals operational instability in the feature. |

**OR logic**: Any single condition triggers complex classification. This ensures that high-risk signals (retries, instability) always escalate, even when the spec is small.

### Evaluation Order: Complex Before Trivial

The classifier evaluates complex conditions FIRST:

```
1. Check complex (any condition) → return 'complex'
2. Check trivial (all conditions) → return 'trivial'
3. Default → return 'standard'
```

**Why?** Consider a task with `specLength=100` (trivial-range) but `previousAttempts=3` (complex trigger). This task MUST be complex — retries signal systemic difficulty that outweighs spec size. Evaluating complex first ensures retries always escalate.

### Standard Gap

The "standard" zone between trivial and complex is intentionally wide:

- `specLength` gap: 500–3000 (2500 chars)
- `fileCount` gap: 3–5 (3 values)

This ensures that borderline tasks default to the known-good baseline prompt rather than risk misclassification.

## Constraints

### O(1) Classification (NFR-002)

The classifier is a pure function over a fixed-size struct with no loops, no history scanning, and no external calls. Classification time is constant regardless of project size.

### Cross-Model Compatibility (NFR-001)

Prompt adaptations use only plain text sections. No provider-specific syntax, no structured output formats, no function-calling directives. The same prompt works across all LLM providers.

### Standard-Mode Semantic Preservation (FR-006)

When `complexity` is `'standard'` or `undefined`, the prompt output is byte-for-byte identical to the pre-feature baseline. This is enforced by regression tests that compare explicit standard-mode output against omitted-complexity output.

### Complex-Mode Size Limit (NFR-003)

The complex-mode addition is limited to ~7 lines of concise stepwise verification guidance. This keeps the prompt within reasonable token budgets and avoids overwhelming the worker with instructions.

### Dispatch Parity (FR-009)

Both single-task and batch dispatch paths converge through `prepareTaskDispatch()`, which computes complexity signals and builds failure context identically. This is verified by parity tests that dispatch the same task through both paths and assert identical prompt content.

## Design Decisions

### Failure Context Positioning

The `## Previous Attempt Context` block is injected BEFORE the execution flow section. This ensures the worker reads failure context before receiving execution instructions, reducing the chance of repeating failed approaches.

### Empty Failure Context Guard

When `failureContext` is `undefined` or an empty string, no block is injected. The falsy check `(!failureContext)` handles both cases without a separate guard. This keeps the standard-mode prompt clean for first-attempt tasks.

### Feature Reopen Rate Normalization

Missing or invalid `featureReopenRate` values are normalized to `0` via `normalizeReopenRate()`. This ensures the classifier always receives valid numeric input and defaults to non-elevated classification when trust metrics are unavailable.

### No Changes to Worker Dispatch Flow

The dispatch state machine, lock management, and worktree creation logic are completely unchanged. Only the prompt content varies based on complexity classification. This minimizes blast radius and simplifies rollback if needed.

## Rejected Alternatives

| Alternative | Why Rejected |
|-------------|--------------|
| Binary classifier (simple/complex) | Misses high-frequency trivial tasks; no prompt savings for the most common case |
| ML-based classifier | Violates O(1) constraint; requires training data not yet available; overkill for 5 numeric signals |
| Full prompt compiler | Out of scope for this feature; adds complexity without proportional benefit |
| Provider-specific prompt syntax | Breaks cross-model compatibility; creates maintenance burden per provider |
| Configurable thresholds at runtime | YAGNI; thresholds are compile-time constants that can be adjusted in future iterations |
| Per-agent adaptation (all agents) | Only Mekkatorque dispatches workers; other agents have no complexity-varying prompt needs |
