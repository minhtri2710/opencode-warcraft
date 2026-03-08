# Quickstart: Runtime-Adaptive Agent Prompts

**Feature**: `004-adaptive-prompts`
**Date**: 2026-03-08

## Overview

This feature makes Mekkatorque worker prompts adapt to task complexity and retry history at dispatch time. Three prompt modes (`trivial`, `standard`, `complex`) are selected automatically from runtime signals, and retried tasks receive prior-attempt context to avoid repeating failed approaches.

## Executable Scenarios

### Scenario 1: Trivial Task — Compact Prompt

**Setup**: A task with a short spec, minimal files, no dependencies, and no prior attempts.

```typescript
import { classifyComplexity } from './packages/opencode-warcraft/src/utils/task-complexity.js';

const signals = {
  specLength: 200,    // < 500 threshold
  fileCount: 1,       // <= 2 threshold
  dependencyCount: 0, // === 0 required
  previousAttempts: 0, // === 0 required
  featureReopenRate: 0,
};

classifyComplexity(signals); // => 'trivial'
```

**Expected prompt behavior**: The worker receives a compact execution flow (`Read spec -> Implement -> Verify -> Commit`) instead of the full multi-section prompt. The prompt does NOT contain the verbose "Execution Flow" section.

**Verification**:
```bash
bun test packages/opencode-warcraft/src/utils/task-complexity.test.ts
bun test packages/opencode-warcraft/src/agents/prompts.test.ts
```

---

### Scenario 2: Complex Task — Extra Verification Guidance

**Setup**: A task with a large spec, many files, retries, or high reopen rate.

```typescript
import { classifyComplexity } from './packages/opencode-warcraft/src/utils/task-complexity.js';

// Any ONE of these conditions triggers complex:
const signals = {
  specLength: 4000,       // > 3000 threshold
  fileCount: 8,           // > 5 threshold
  dependencyCount: 3,
  previousAttempts: 2,    // >= 2 threshold
  featureReopenRate: 0.3, // > 0.2 threshold
};

classifyComplexity(signals); // => 'complex'
```

**Expected prompt behavior**: The worker receives the standard prompt PLUS a "Complex Task Guidance" section with concise stepwise verification instructions (~7 extra lines).

**Verification**:
```bash
bun test packages/opencode-warcraft/src/agents/prompts.test.ts
```

---

### Scenario 3: Standard Task — Unchanged Behavior

**Setup**: A task with moderate signals that fall between trivial and complex thresholds.

```typescript
import { classifyComplexity } from './packages/opencode-warcraft/src/utils/task-complexity.js';

const signals = {
  specLength: 1500,
  fileCount: 3,
  dependencyCount: 1,
  previousAttempts: 0,
  featureReopenRate: 0.1,
};

classifyComplexity(signals); // => 'standard'
```

**Expected prompt behavior**: The prompt output is byte-for-byte identical to the pre-feature baseline. No additions, no removals.

**Verification**:
```bash
bun test packages/opencode-warcraft/src/agents/prompts.test.ts
# Regression tests: "standard complexity produces identical output to omitted complexity"
```

---

### Scenario 4: Retry With Failure Context

**Setup**: A task that has been attempted before with a stored summary.

**Expected prompt behavior**: A `## Previous Attempt Context` block is injected before the execution flow section, containing the prior attempt's summary. The block is positioned so the worker sees failure context before receiving execution instructions.

**Verification**:
```bash
bun test packages/opencode-warcraft/src/agents/prompts.test.ts
# Tests: "injects Previous Attempt Context block when failureContext provided"
# Tests: "failure context appears before execution flow"
```

---

### Scenario 5: Retry Without Summary — No Injection

**Setup**: A task with `previousAttempts > 0` but no stored summary text.

**Expected prompt behavior**: No `Previous Attempt Context` block is injected. The prompt renders as if no retries occurred.

**Verification**:
```bash
bun test packages/opencode-warcraft/src/tools/dispatch-task.test.ts
# Tests: "does NOT include previous attempt context when summary is missing"
```

---

### Scenario 6: Batch vs Single-Task Parity

**Setup**: The same task dispatched through both the single-task path and the batch path.

**Expected prompt behavior**: Both paths produce the same complexity classification and the same retry context injection for identical inputs.

**Verification**:
```bash
bun test packages/opencode-warcraft/src/tools/dispatch-task.test.ts
# Tests: "produces same complexity classification via shared and non-shared dispatch"
# Tests: "produces same retry context via shared and non-shared dispatch"
```

---

## Running All Feature Tests

```bash
# Classifier tests (26 tests)
bun test packages/opencode-warcraft/src/utils/task-complexity.test.ts

# Prompt rendering tests (114 tests, includes 24 adaptive prompt tests)
bun test packages/opencode-warcraft/src/agents/prompts.test.ts

# Dispatch wiring tests (34 tests, includes 9 adaptive dispatch tests)
bun test packages/opencode-warcraft/src/tools/dispatch-task.test.ts

# Full package suite
bun run test --filter opencode-warcraft
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/opencode-warcraft/src/utils/task-complexity.ts` | Complexity classifier: `classifyComplexity(signals)` |
| `packages/opencode-warcraft/src/utils/task-complexity.test.ts` | 26 boundary + determinism tests |
| `packages/opencode-warcraft/src/agents/mekkatorque.ts` | Prompt builder with complexity modes |
| `packages/opencode-warcraft/src/agents/prompts.test.ts` | 114 prompt tests (24 new for adaptive) |
| `packages/opencode-warcraft/src/tools/task-dispatch.ts` | Signal extraction + dispatch wiring |
| `packages/opencode-warcraft/src/tools/dispatch-task.test.ts` | 34 dispatch tests (9 new for adaptive) |
